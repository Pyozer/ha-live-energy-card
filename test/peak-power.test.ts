import { describe, expect, it } from 'vitest';
import { validateConfig, watchedEntities } from '../src/config';
import { entityIssues } from '../src/editor/validation';
import { buildModel, ringValue, type NodeModel } from '../src/model';
import type { HassEntity, HomeAssistant, LiveEnergyCardConfig } from '../src/types';
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

describe('peak power of the solar panels', () => {
  const hass = (production = 3000, extra: HassEntity[] = []) =>
    hassWith([state('sensor.roof', production), state('sensor.garage', 1000), ...extra]);

  it('shows no ring without a peak power', () => {
    const solar = nodes({ type: 'x', solar: { units: [{ entity: 'sensor.roof' }] } }, hass()).solar;
    expect(solar.peakRatio).toBeUndefined();
    expect(solar.status).toBeUndefined();
    expect(ringValue(solar)).toBeUndefined();
  });

  it('fills the ring with the share of the fixed peak power that is produced', () => {
    const solar = nodes(
      { type: 'x', solar: { units: [{ entity: 'sensor.roof', peak_power: 6000 }] } },
      hass(),
    ).solar;
    expect(solar.peakRatio).toBeCloseTo(0.5);
    expect(ringValue(solar)).toBeCloseTo(50);
    expect(solar.status).toBe('50 % of peak power');
  });

  it('never goes past a full ring when the production exceeds the peak', () => {
    const solar = nodes(
      { type: 'x', solar: { units: [{ entity: 'sensor.roof', peak_power: 2000 }] } },
      hass(),
    ).solar;
    expect(solar.peakRatio).toBe(1);
  });

  it('reads the peak power from an entity, in W, kW or kWc', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', peak_power_entity: 'sensor.peak' }] },
    };
    for (const [value, unit] of [
      [6000, 'W'],
      [6, 'kW'],
      [6, 'kWc'],
      [6000, 'Wc'],
    ] as const) {
      expect(nodes(config, hass(3000, [state('sensor.peak', value, unit)])).solar.peakRatio).toBeCloseTo(0.5);
    }
    expect(readPower(state('sensor.peak', 6, 'kWp')).value).toBe(6000);
  });

  it('falls back to the fixed value while the entity is unreadable', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', peak_power: 6000, peak_power_entity: 'sensor.peak' }] },
    };
    expect(nodes(config, hass(3000, [state('sensor.peak', 'unavailable')])).solar.peakRatio).toBeCloseTo(0.5);
    // A readable entity wins over the fixed value.
    expect(nodes(config, hass(3000, [state('sensor.peak', 12000)])).solar.peakRatio).toBeCloseTo(0.25);
  });

  it('has no ring when the peak power is zero or negative', () => {
    for (const peak_power of [0, -100]) {
      const config: LiveEnergyCardConfig = {
        type: 'x',
        solar: { units: [{ entity: 'sensor.roof', peak_power }] },
      };
      expect(nodes(config, hass()).solar.peakRatio).toBeUndefined();
    }
  });

  it('a single bubble adds the peaks of its units up', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: {
        units: [
          { entity: 'sensor.roof', peak_power: 3000 },
          { entity: 'sensor.garage', peak_power: 1000 },
        ],
      },
    };
    // 4000 W produced out of 4000 Wc.
    expect(nodes(config, hass()).solar.peakRatio).toBe(1);
    expect(nodes(config, hass(1000)).solar.peakRatio).toBeCloseTo(0.5);
  });

  it('a single bubble has no ring as soon as one unit has no peak: a partial sum would mislead', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', peak_power: 3000 }, { entity: 'sensor.garage' }] },
    };
    expect(nodes(config, hass()).solar.peakRatio).toBeUndefined();
  });

  it('a bubble per unit shows its own ring, and no ring on a unit without a peak', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: {
        separate: true,
        units: [{ entity: 'sensor.roof', peak_power: 6000 }, { entity: 'sensor.garage' }],
      },
    };
    const model = nodes(config, hass());
    expect(model['solar:0'].peakRatio).toBeCloseTo(0.5);
    expect(model['solar:1'].peakRatio).toBeUndefined();
    // The hub is not drawn.
    expect(model.solar.peakRatio).toBeUndefined();
  });

  it('an unavailable bubble keeps an empty ring', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', peak_power: 6000 }] },
    };
    const solar = nodes(config, hassWith([state('sensor.roof', 'unavailable')])).solar;
    expect(solar.peakRatio).toBeNull();
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

  it('validateConfig coerces a peak power typed as text, and drops an empty one', () => {
    const units = (peak_power: unknown) =>
      validateConfig({ type: 'x', solar: { units: [{ entity: 'sensor.roof', peak_power }] } }).solar!
        .units![0];
    expect(units('6000').peak_power).toBe(6000);
    expect('peak_power' in units('')).toBe(false);
    expect(() => units('abc')).toThrow();
  });

  it('watches the peak power entity, and the editor checks its kind', () => {
    const config: LiveEnergyCardConfig = {
      type: 'x',
      solar: { units: [{ entity: 'sensor.roof', peak_power_entity: 'sensor.peak' }] },
    };
    expect(watchedEntities(config)).toContain('sensor.peak');
    const issues = entityIssues(config, hassWith([state('sensor.roof', 1), state('sensor.peak', 5, 'kWh')]));
    expect(issues).toMatchObject([{ field: 'peak_power_entity', problem: 'kind', expected: 'power' }]);
  });
});
