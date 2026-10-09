import { describe, expect, it } from 'vitest';
import {
  deviceFormData,
  deviceFromForm,
  fromFormData,
  priceMode,
  priceModesOf,
  toFormData,
} from '../src/editor/form';
import { EditorSchema, fieldLabel, type Schema } from '../src/editor/schema';
import { localize, SUPPORTED_LANGUAGES } from '../src/localize/localize';
import type { HassEntity, HomeAssistant, LiveEnergyCardConfig } from '../src/types';
import { describeIssue, deviceIssues, entityIssues } from '../src/editor/validation';

const base: LiveEnergyCardConfig = { type: 'custom:live-energy-card' };

/** Round trip through the form, with an optional edit of the form data. */
const roundTrip = (
  config: LiveEnergyCardConfig,
  edit: (data: Record<string, unknown>) => void = () => {},
): LiveEnergyCardConfig => {
  const data = structuredClone(toFormData(config));
  edit(data);
  return fromFormData(data, config);
};

describe('editor form', () => {
  it('a round trip without edits keeps a minimal config unchanged', () => {
    const config: LiveEnergyCardConfig = { ...base, solar: { entity: 'sensor.s' }, devices: [] };
    expect(roundTrip(config)).toEqual({ ...base, solar: { entity: 'sensor.s' }, devices: [] });
  });

  it('only writes options that differ from the defaults', () => {
    const next = roundTrip(base, (d) => {
      d.max_power = 8000;
      d.line_style = 'rounded';
    });
    expect(next.max_power).toBe(8000);
    expect('line_style' in next).toBe(false);
    expect('animation' in next).toBe(false);
  });

  it('writes boolean options only when turned on', () => {
    expect('transparent' in roundTrip(base)).toBe(false);
    expect(roundTrip(base, (d) => (d.transparent = true)).transparent).toBe(true);
  });

  it('writes the glow when turned on, although its default is false', () => {
    const next = roundTrip(base, (d) => {
      (d.animation as Record<string, boolean>).glow = true;
    });
    expect(next.animation).toEqual({ glow: true });
  });

  it('keeps an explicit hide_when_zero equal to the default', () => {
    const config: LiveEnergyCardConfig = { ...base, solar: { entity: 'sensor.s', hide_when_zero: true } };
    expect(roundTrip(config).solar?.hide_when_zero).toBe(true);
    const implicit: LiveEnergyCardConfig = { ...base, solar: { entity: 'sensor.s' } };
    expect('hide_when_zero' in roundTrip(implicit).solar!).toBe(false);
  });

  it('stores one entity as a string and several as a list', () => {
    const next = roundTrip(base, (d) => {
      (d.solar as Record<string, unknown>).entity = ['sensor.a'];
      (d.grid as Record<string, unknown>).entity = ['sensor.p1', 'sensor.p2'];
    });
    expect(next.solar?.entity).toBe('sensor.a');
    expect(next.grid?.entity).toEqual(['sensor.p1', 'sensor.p2']);
  });

  it('drops empty cost and carbon sections', () => {
    const next = roundTrip(base, (d) => {
      d.cost = { price: undefined, currency: '' };
      d.carbon = {};
    });
    expect('cost' in next).toBe(false);
    expect('carbon' in next).toBe(false);
  });
});

describe('editor price source', () => {
  const costOf = (config: LiveEnergyCardConfig) => (toFormData(config).cost ?? {}) as Record<string, unknown>;

  it('derives the source from the field that is set, the entity first', () => {
    expect(priceMode(undefined, 'price')).toBe('none');
    expect(priceMode({ price: 0.2 }, 'price')).toBe('fixed');
    expect(priceMode({ price_entity: 'sensor.p' }, 'price')).toBe('entity');
    expect(priceMode({ price: 0.2, price_entity: 'sensor.p' }, 'price')).toBe('entity');
    expect(priceMode({ export_price: 0.1 }, 'export_price')).toBe('fixed');
    // The choice made in the editor only applies while the price has no value.
    expect(priceMode(undefined, 'price', 'entity')).toBe('entity');
    expect(priceMode({ price: 0.2 }, 'price', 'entity')).toBe('fixed');
  });

  it('puts the sources in the form data and keeps them out of the config', () => {
    const config: LiveEnergyCardConfig = { ...base, cost: { price: 0.25, export_price_entity: 'sensor.e' } };
    expect(costOf(config)).toMatchObject({ price_mode: 'fixed', export_price_mode: 'entity' });
    expect(roundTrip(config).cost).toEqual({ price: 0.25, export_price_entity: 'sensor.e' });
  });

  it('keeps only the field of the chosen source', () => {
    const both: LiveEnergyCardConfig = { ...base, cost: { price: 0.25, price_entity: 'sensor.p' } };
    expect(roundTrip(both, (d) => ((d.cost as Record<string, unknown>).price_mode = 'fixed')).cost).toEqual({
      price: 0.25,
    });
    expect(roundTrip(both).cost).toEqual({ price_entity: 'sensor.p' });
    const none = roundTrip(both, (d) => ((d.cost as Record<string, unknown>).price_mode = 'none'));
    expect('cost' in none).toBe(false);
  });

  it('reads the sources picked in the form', () => {
    expect(priceModesOf({ cost: { price_mode: 'entity', export_price_mode: 'none', price: 1 } })).toEqual({
      price: 'entity',
      export_price: 'none',
    });
    expect(priceModesOf({})).toEqual({});
  });

  it('shows only the field of the source in the schema', () => {
    const t = (key: Parameters<typeof localize>[1]) => localize('en', key);
    const schema = new EditorSchema(t, undefined);
    const names = (config: LiveEnergyCardConfig) =>
      fieldNames(schema.card(config)).filter((n) => n.includes('price'));
    expect(names(base)).toEqual(['price_mode', 'export_price_mode']);
    expect(names({ ...base, cost: { price: 0.2, export_price_entity: 'sensor.e' } })).toEqual([
      'price_mode',
      'price',
      'export_price_mode',
      'export_price_entity',
    ]);
    expect(fieldNames(schema.card(base, { price: 'entity', export_price: 'fixed' }))).toEqual(
      expect.arrayContaining(['price_entity', 'export_price']),
    );
  });
});

describe('editor device form', () => {
  const group = { name: 'IT', entity: 'sensor.circuit', devices: [{ entity: 'sensor.nas' }] };

  it('shows a group entity under its own field and keeps the members', () => {
    const data = deviceFormData(group, undefined);
    expect(data.group_entity).toEqual(['sensor.circuit']);
    expect(data.entity).toBe('sensor.circuit');
    const next = deviceFromForm({ ...data, group_entity: [], name: 'Network' }, group, undefined);
    expect(next).toEqual({ name: 'Network', devices: group.devices });
  });

  it('drops false flags and a default hide_when_zero', () => {
    const dev = { entity: 'sensor.tv' };
    const data = { ...deviceFormData(dev, undefined), invert: false, exclude_from_untracked: false };
    expect(deviceFromForm(data, dev, undefined)).toEqual({ entity: 'sensor.tv' });
  });
});

/** Every named field in a schema, nested ones included. */
function fieldNames(schema: Schema[]): string[] {
  return schema.flatMap((s) => [
    ...(typeof s.name === 'string' && s.name && !Array.isArray(s.schema) ? [s.name] : []),
    ...(Array.isArray(s.schema) ? fieldNames(s.schema as Schema[]) : []),
  ]);
}

describe('editor schema', () => {
  const group = { name: 'G', devices: [] };
  for (const lang of SUPPORTED_LANGUAGES) {
    it(`every field has a ${lang} label`, () => {
      const t = (key: Parameters<typeof localize>[1]) => localize(lang, key);
      const schema = new EditorSchema(t, undefined);
      const names = [
        ...fieldNames(schema.card(base)),
        ...fieldNames(schema.card(base, { price: 'fixed', export_price: 'entity' })),
        ...fieldNames(schema.card(base, { price: 'entity', export_price: 'fixed' })),
        ...fieldNames(schema.device({ entity: 'sensor.x' })),
        ...fieldNames(schema.device(group)),
      ];
      const missing = [...new Set(names)].filter((n) => fieldLabel(t, n) === n);
      expect(missing).toEqual([]);
    });
  }
});

describe('entity issues', () => {
  const st = (id: string, unit: string, extra: Record<string, unknown> = {}): HassEntity => ({
    entity_id: id,
    state: '1',
    attributes: { unit_of_measurement: unit, ...extra },
  });
  const hass: HomeAssistant = {
    language: 'en',
    states: Object.fromEntries(
      [
        st('sensor.solar', 'W'),
        st('sensor.solar_day', 'kWh'),
        st('sensor.soc', '%'),
        st('sensor.price', 'EUR/kWh'),
        st('sensor.tv', 'W', { friendly_name: 'TV' }),
      ].map((s) => [s.entity_id, s]),
    ),
  };
  const t = (key: Parameters<typeof localize>[1], vars?: Record<string, string>) => localize('en', key, vars);

  it('accepts a valid configuration', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      solar: { entity: 'sensor.solar', secondary_entity: 'sensor.solar_day' },
      battery: { entity: 'sensor.solar', soc_entity: 'sensor.soc' },
      cost: { price_entity: 'sensor.price' },
      devices: [{ entity: 'sensor.tv' }],
    };
    expect(entityIssues(config, hass)).toEqual([]);
  });

  it('flags missing entities and entities of the wrong kind', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      solar: { entity: ['sensor.solar', 'sensor.solar_day'] },
      battery: { entity: 'sensor.solar', soc_entity: 'sensor.solar' },
      devices: [{ name: 'IT', devices: [{ entity: 'sensor.gone' }] }],
    };
    expect(entityIssues(config, hass)).toEqual([
      { where: 'solar', field: 'entity', entity: 'sensor.solar_day', problem: 'kind', expected: 'power' },
      { where: 'battery', field: 'soc_entity', entity: 'sensor.solar', problem: 'kind', expected: 'percent' },
      { where: [0, 0], field: 'entity', entity: 'sensor.gone', problem: 'missing' },
    ]);
  });

  it('only checks that a secondary entity exists', () => {
    const config: LiveEnergyCardConfig = { ...base, home: { secondary_entity: 'sensor.price' } };
    expect(entityIssues(config, hass)).toEqual([]);
  });

  it('warns when a secondary entity hides the energy counters', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      solar: {
        entity: 'sensor.solar',
        energy_entity: ['sensor.solar_day'],
        secondary_entity: 'sensor.solar_day',
      },
    };
    const issues = entityIssues(config, hass);
    expect(issues).toEqual([
      { where: 'solar', field: 'energy_entity', entity: 'sensor.solar_day', problem: 'ignored' },
    ]);
    expect(describeIssue(issues[0], config, hass, t).problem).toContain('replaces');
  });

  it('warns when a price entity hides the fixed price', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      cost: { price: 0.25, price_entity: 'sensor.price', export_price: 0.1 },
    };
    const issues = entityIssues(config, hass);
    expect(issues).toEqual([{ where: 'cost', field: 'price', entity: '0.25', problem: 'ignored_price' }]);
    expect(describeIssue(issues[0], config, hass, t).problem).toContain('price entity');
  });

  it('names an unnamed device by its position', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      devices: [{ entity: 'sensor.tv' }, { entity: 'sensor.gone' }],
    };
    const [issue] = entityIssues(config, hass);
    expect(describeIssue(issue, config, hass, t).where).toBe('Device 2');
  });

  it('matches device issues by exact path', () => {
    const issues = entityIssues(
      { ...base, devices: [{ name: 'G', devices: [{ entity: 'sensor.x' }] }] },
      hass,
    );
    expect(deviceIssues(issues, [0])).toEqual([]);
    expect(deviceIssues(issues, [0, 0])).toHaveLength(1);
  });

  it('describes where an issue is, in readable terms', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      devices: [{ name: 'IT', entity: 'sensor.gone', devices: [{ entity: 'sensor.tv' }] }],
    };
    const [issue] = entityIssues(config, hass);
    expect(describeIssue(issue, config, hass, t)).toEqual({
      where: 'IT',
      field: t('editor.field.group_entity'),
      problem: 'not found',
    });
    const member = {
      where: [0, 0],
      field: 'entity',
      entity: 'sensor.tv',
      problem: 'kind',
      expected: 'power',
    } as const;
    expect(describeIssue({ ...member, where: [0, 0] }, config, hass, t).where).toBe('IT › TV');
  });
});
