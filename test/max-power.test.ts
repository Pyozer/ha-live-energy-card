import { describe, expect, it } from 'vitest';
import { validateConfig, watchedEntities } from '../src/config';
import { fieldHelper } from '../src/editor/schema';
import { entityIssues } from '../src/editor/validation';
import { buildModel, ringValue, type NodeModel } from '../src/model';
import type { HassEntity, HomeAssistant, LiveEnergyCardConfig } from '../src/types';
import { localize } from '../src/localize/localize';
import { readPower } from '../src/units';

const state = (id: string, value: string | number, unit = 'W'): HassEntity => ({
  entity_id: id,
  state: String(value),
  attributes: { unit_of_measurement: unit },
});

const hassWith = (states: HassEntity[]): HomeAssistant => ({
  states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
  language: 'en',
  locale: { language: 'en' },
});

const nodes = (config: LiveEnergyCardConfig, hass: HomeAssistant): Record<string, NodeModel> =>
  Object.fromEntries(buildModel(config, hass).nodes.map((n) => [n.id, n]));

describe('maximum power of a solar unit', () => {
  const hass = (production = 3000, extra: HassEntity[] = []) =>
    hassWith([state('sensor.roof', production), state('sensor.garage', 1000), ...extra]);

  it('shows no ring without a maximum power', () => {
    const solar = nodes({ type: 'x', solar: { units: [{ entity: 'sensor.roof' }] } }, hass()).solar;
    expect(solar.powerRatio).toBeUndefined();
    expect(solar.status).toBeUndefined();
    expect(ringValue(solar)).toBeUndefined();
  });

  it('fills the ring with the share of the fixed maximum power that is produced', () => {
    const solar = nodes(
      { type: 'x', solar: { units: [{ entity: 'sensor.roof', max_power: 6000 }] } },
      hass(),
    ).solar;
    expect(solar.powerRatio).toBeCloseTo(0.5);
    expect(ringValue(solar)).toBeCloseTo(50);
    expect(solar.status).toBe('50 % of maximum power');
  });

  it('never goes past a full ring when the production exceeds the maximum', () => {
    const solar = nodes(
      { type: 'x', solar: { units: [{ entity: 'sensor.roof', max_power: 2000 }] } },
      hass(),
    ).solar;
    expect(solar.powerRatio).toBe(1);
  });

  it('reads the maximum power from an entity, in W, kW or kWc', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', max_power_entity: 'sensor.max' }] },
    };
    for (const [value, unit] of [
      [6000, 'W'],
      [6, 'kW'],
      [6, 'kWc'],
      [6000, 'Wc'],
    ] as const) {
      expect(nodes(config, hass(3000, [state('sensor.max', value, unit)])).solar.powerRatio).toBeCloseTo(0.5);
    }
    expect(readPower(state('sensor.max', 6, 'kWp')).value).toBe(6000);
  });

  it('falls back to the fixed value while the entity is unreadable', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', max_power: 6000, max_power_entity: 'sensor.max' }] },
    };
    expect(nodes(config, hass(3000, [state('sensor.max', 'unavailable')])).solar.powerRatio).toBeCloseTo(0.5);
    // A readable entity wins over the fixed value.
    expect(nodes(config, hass(3000, [state('sensor.max', 12000)])).solar.powerRatio).toBeCloseTo(0.25);
  });

  it('has no ring when the maximum power is zero or negative', () => {
    for (const max_power of [0, -100]) {
      const config: LiveEnergyCardConfig = {
        type: 'x',
        solar: { units: [{ entity: 'sensor.roof', max_power }] },
      };
      expect(nodes(config, hass()).solar.powerRatio).toBeUndefined();
    }
  });

  it('a single bubble adds the maximums of its units up', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: {
        units: [
          { entity: 'sensor.roof', max_power: 3000 },
          { entity: 'sensor.garage', max_power: 1000 },
        ],
      },
    };
    // 4000 W produced out of 4000 Wc.
    expect(nodes(config, hass()).solar.powerRatio).toBe(1);
    expect(nodes(config, hass(1000)).solar.powerRatio).toBeCloseTo(0.5);
  });

  it('a single bubble has no ring as soon as one unit has no maximum: a partial sum would mislead', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', max_power: 3000 }, { entity: 'sensor.garage' }] },
    };
    expect(nodes(config, hass()).solar.powerRatio).toBeUndefined();
  });

  it('a bubble per unit shows its own ring, and no ring on a unit without a maximum', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: {
        separate: true,
        units: [{ entity: 'sensor.roof', max_power: 6000 }, { entity: 'sensor.garage' }],
      },
    };
    const model = nodes(config, hass());
    expect(model['solar:0'].powerRatio).toBeCloseTo(0.5);
    expect(model['solar:1'].powerRatio).toBeUndefined();
    // The hub is not drawn.
    expect(model.solar.powerRatio).toBeUndefined();
  });

  it('an unavailable bubble keeps an empty ring', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', max_power: 6000 }] },
    };
    const solar = nodes(config, hassWith([state('sensor.roof', 'unavailable')])).solar;
    expect(solar.powerRatio).toBeNull();
    expect(ringValue(solar)).toBeNull();
    expect(solar.status).toBeUndefined();
  });

  it('the battery ring still follows its charge level', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      battery: { units: [{ entity: 'sensor.b', soc_entity: 'sensor.s' }] },
    };
    const battery = nodes(config, hassWith([state('sensor.b', 100), state('sensor.s', 40, '%')])).battery;
    expect(ringValue(battery)).toBe(40);
  });

  it('validateConfig coerces a maximum power typed as text, and drops an empty one', () => {
    const units = (max_power: unknown) =>
      validateConfig({ type: 'x', solar: { units: [{ entity: 'sensor.roof', max_power }] } }).solar!
        .units![0];
    expect(units('6000').max_power).toBe(6000);
    expect('max_power' in units('')).toBe(false);
    expect(() => units('abc')).toThrow();
  });

  it('watches the maximum power entity, and the editor checks its kind', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', max_power_entity: 'sensor.max' }] },
    };
    expect(watchedEntities(config)).toContain('sensor.max');
    const issues = entityIssues(config, hassWith([state('sensor.roof', 1), state('sensor.max', 5, 'kWh')]));
    expect(issues).toMatchObject([{ field: 'max_power_entity', problem: 'kind', expected: 'power' }]);
  });

  it('fills up at the inverter limit when it is lower than the panels', () => {
    // Two 435 Wc panels on an 800 W micro-inverter: the gauge is full at 800 W.
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', max_power: 800 }] },
    };
    expect(nodes(config, hass(800)).solar.powerRatio).toBe(1);
    expect(nodes(config, hass(400)).solar.powerRatio).toBeCloseTo(0.5);
  });

  it('still accepts the former peak_power options, the new ones winning', () => {
    const unit = (extra: object) =>
      validateConfig({ type: 'x', solar: { units: [{ entity: 'sensor.roof', ...extra }] } }).solar!.units![0];
    expect(unit({ peak_power: '6000', peak_power_entity: 'sensor.max' })).toEqual({
      entity: 'sensor.roof',
      max_power: 6000,
      max_power_entity: 'sensor.max',
    });
    expect(unit({ peak_power: 6000, max_power: 800 })).toMatchObject({ max_power: 800 });
    expect(
      nodes(
        validateConfig({ type: 'x', solar: { units: [{ entity: 'sensor.roof', peak_power: 6000 }] } }),
        hass(),
      ).solar.powerRatio,
    ).toBeCloseTo(0.5);
  });

  it('has short labels and no helper text: the fields speak for themselves', () => {
    for (const lang of ['en', 'fr']) {
      const t = (key: Parameters<typeof localize>[1]) => localize(lang, key);
      for (const field of ['max_power', 'max_power_entity']) {
        expect(fieldHelper(t, field), `${lang} ${field}`).toBe('');
        expect(localize(lang, `editor.field.${field}` as Parameters<typeof localize>[1]).length).toBeLessThan(
          40,
        );
      }
    }
  });
});

describe('maximum power of a device', () => {
  const hass = (watts: number, extra: HassEntity[] = []) =>
    hassWith([state('sensor.heater', watts), state('sensor.a', 200), state('sensor.b', 400), ...extra]);
  const device = (config: LiveEnergyCardConfig, h: HomeAssistant) => nodes(config, h)['device:0'];

  it('shows a gauge with the share of its maximum power, and says it in its status', () => {
    const heater = device({ type: 'x', devices: [{ entity: 'sensor.heater', max_power: 3000 }] }, hass(1500));
    expect(heater.powerRatio).toBeCloseTo(0.5);
    expect(heater.status).toBe('50 % of maximum power');
  });

  it('has no gauge without a maximum power', () => {
    const heater = device({ type: 'x', devices: [{ entity: 'sensor.heater' }] }, hass(1500));
    expect(heater.powerRatio).toBeUndefined();
    expect(heater.status).toBeUndefined();
  });

  it('stays full above the maximum, empty at zero, and empty when unavailable', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      hide_when_zero: false,
      devices: [{ entity: 'sensor.heater', max_power: 3000 }],
    };
    expect(device(config, hass(5000)).powerRatio).toBe(1);
    expect(device(config, hass(0)).powerRatio).toBe(0);
    expect(device(config, hassWith([state('sensor.heater', 'unavailable')])).powerRatio).toBeNull();
  });

  it('reads the maximum power from an entity while it is readable, like a solar unit', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      devices: [{ entity: 'sensor.heater', max_power: 3000, max_power_entity: 'sensor.rating' }],
    };
    expect(device(config, hass(1500, [state('sensor.rating', 6, 'kW')])).powerRatio).toBeCloseTo(0.25);
    expect(device(config, hass(1500, [state('sensor.rating', 'unknown')])).powerRatio).toBeCloseTo(0.5);
  });

  it('ignores a maximum power that is not a positive number', () => {
    for (const max_power of [0, -5, 'abc' as unknown as number]) {
      const config: LiveEnergyCardConfig = { type: 'x', devices: [{ entity: 'sensor.heater', max_power }] };
      expect(device(config, hass(1500)).powerRatio).toBeUndefined();
    }
  });

  it('gives a group a gauge of its own, over the sum of its members', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      devices: [{ max_power: 1200, devices: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }] }],
    };
    const model = nodes(config, hass(0));
    expect(model['device:0'].powerRatio).toBeCloseTo(0.5);
    expect(model['device:0:0'].powerRatio).toBeUndefined();
  });

  it('watches the maximum power entity, and the editor checks its kind', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      devices: [{ entity: 'sensor.heater', max_power_entity: 'sensor.rating' }],
    };
    expect(watchedEntities(config)).toContain('sensor.rating');
    const issues = entityIssues(config, hass(1, [state('sensor.rating', 5, 'kWh')]));
    expect(issues).toMatchObject([{ field: 'max_power_entity', problem: 'kind', expected: 'power' }]);
  });
});

describe('battery under its reserve', () => {
  const battery = (soc: number, min_soc?: number) =>
    nodes(
      {
        type: 'x',
        battery: { units: [{ entity: 'sensor.b', soc_entity: 'sensor.s', capacity: 10, min_soc }] },
      },
      hassWith([state('sensor.b', 500), state('sensor.s', soc, '%')]),
    ).battery;

  it('flags the battery at or under its reserve, which turns its ring to the alert color', () => {
    expect(battery(10, 10).low).toBe(true);
    expect(battery(5, 10).low).toBe(true);
    expect(battery(11, 10).low).toBe(false);
  });

  it('has no alert without a reserve', () => {
    expect(battery(0).low).toBe(false);
  });
});
