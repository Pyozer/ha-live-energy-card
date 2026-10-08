import { describe, expect, it } from 'vitest';
import { deviceFormData, deviceFromForm, fromFormData, toFormData } from '../src/editor/form';
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
