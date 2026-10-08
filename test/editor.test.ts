import { describe, expect, it } from 'vitest';
import { deviceFormData, deviceFromForm, fromFormData, toFormData } from '../src/editor/form';
import { EditorSchema, fieldLabel, type Schema } from '../src/editor/schema';
import { localize, SUPPORTED_LANGUAGES } from '../src/localize/localize';
import type { LiveEnergyCardConfig } from '../src/types';

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
