import { describe, expect, it } from 'vitest';
import {
  deviceFormData,
  deviceFromForm,
  fromFormData,
  priceMode,
  priceModesOf,
  savingsMode,
  toFormData,
  unitFormData,
  unitFromForm,
} from '../src/editor/form';
import { addUnit, dropUnit, removeUnit, shiftUnit, unitsOf, updateUnit } from '../src/editor/unit-list';
import { EditorSchema, fieldHelper, fieldLabel, formLabel, type Schema } from '../src/editor/schema';
import { localize, SUPPORTED_LANGUAGES } from '../src/localize/localize';
import type { HassEntity, HomeAssistant, LiveEnergyCardConfig } from '../src/types';
import { describeIssue, deviceIssues, entityIssues, unitIssues } from '../src/editor/validation';

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
    const config: LiveEnergyCardConfig = { ...base, grid: { entity: 'sensor.g' }, devices: [] };
    expect(roundTrip(config)).toEqual({ ...base, grid: { entity: 'sensor.g' }, devices: [] });
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
    expect('compact' in roundTrip(base)).toBe(false);
    expect(roundTrip(base, (d) => (d.compact = true)).compact).toBe(true);
    expect('small_bubbles' in roundTrip(base)).toBe(false);
    expect(roundTrip(base, (d) => (d.small_bubbles = true)).small_bubbles).toBe(true);
  });

  it('writes the glow when turned on, although its default is false', () => {
    const next = roundTrip(base, (d) => {
      (d.animation as Record<string, boolean>).glow = true;
    });
    expect(next.animation).toEqual({ glow: true });
  });

  it('keeps an explicit hide_when_zero equal to the default', () => {
    const config: LiveEnergyCardConfig = { ...base, grid: { entity: 'sensor.g', hide_when_zero: false } };
    expect(roundTrip(config).grid?.hide_when_zero).toBe(false);
    const solar: LiveEnergyCardConfig = { ...base, solar: { hide_when_zero: true } };
    expect(roundTrip(solar).solar?.hide_when_zero).toBe(true);
    const implicit: LiveEnergyCardConfig = { ...base, solar: { name: 'PV' } };
    expect('hide_when_zero' in roundTrip(implicit).solar!).toBe(false);
  });

  it('stores one entity as a string and several as a list', () => {
    const next = roundTrip(base, (d) => {
      (d.home as Record<string, unknown>).entity = ['sensor.a'];
      (d.grid as Record<string, unknown>).entity = ['sensor.p1', 'sensor.p2'];
    });
    expect(next.home?.entity).toBe('sensor.a');
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

  it('keeps the actions of the indicators, and drops the unset ones', () => {
    const tap = { action: 'navigate', navigation_path: '/energy' };
    const next = roundTrip(base, (d) => {
      d.cost = { cost_actions: { tap_action: tap, hold_action: undefined }, savings_actions: {} };
      d.carbon = { actions: { double_tap_action: tap } };
    });
    expect(next.cost).toEqual({ cost_actions: { tap_action: tap } });
    expect(next.carbon).toEqual({ actions: { double_tap_action: tap } });
  });

  it('has an actions group for each indicator, nested under its own key', () => {
    const t = (key: Parameters<typeof localize>[1]) => localize('en', key);
    const sections = new EditorSchema(t, undefined).card(base) as Schema[];
    const groupsOf = (name: string) =>
      ((sections.find((s) => s.name === name)?.schema ?? []) as Schema[])
        .filter((s) => s.type === 'expandable')
        .map((s) => s.name);
    expect(groupsOf('cost')).toEqual(['cost_actions', 'savings_actions']);
    expect(groupsOf('carbon')).toEqual(['actions']);
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

describe('editor solar savings source', () => {
  const t = (key: Parameters<typeof localize>[1]) => localize('en', key);
  const schema = new EditorSchema(t, undefined);
  const names = (config: LiveEnergyCardConfig, modes = {}) =>
    fieldNames(schema.card(config, modes)).filter((n) => n.startsWith('savings'));

  it('derives the source from the entity, the choice only applying while it is empty', () => {
    expect(savingsMode(undefined)).toBe('calculated');
    expect(savingsMode({ savings_entity: 'sensor.s' })).toBe('savings');
    expect(savingsMode(undefined, 'savings')).toBe('savings');
    expect(savingsMode({ savings_entity: 'sensor.s' }, 'calculated')).toBe('savings');
  });

  it('is independent of the import source', () => {
    expect(priceMode({ savings_entity: 'sensor.s' }, 'price')).toBe('none');
    const config: LiveEnergyCardConfig = {
      ...base,
      cost: { cost_entity: 'sensor.c', savings_entity: 'sensor.s' },
    };
    expect(roundTrip(config).cost).toEqual({ cost_entity: 'sensor.c', savings_entity: 'sensor.s' });
  });

  it('shows the entity field only for the savings entity source', () => {
    expect(names(base)).toEqual(['savings_mode']);
    expect(names(base, { savings: 'savings' })).toEqual(['savings_mode', 'savings_entity']);
    expect(names({ ...base, cost: { savings_entity: 'sensor.s' } })).toEqual([
      'savings_mode',
      'savings_entity',
    ]);
  });

  it('keeps the entity only with its source, and keeps the mode out of the config', () => {
    const config: LiveEnergyCardConfig = { ...base, cost: { price: 0.2, savings_entity: 'sensor.s' } };
    const calculated = roundTrip(
      config,
      (d) => ((d.cost as Record<string, unknown>).savings_mode = 'calculated'),
    );
    expect(calculated.cost).toEqual({ price: 0.2 });
    expect(JSON.stringify(roundTrip(config))).not.toContain('savings_mode');
    expect(priceModesOf({ cost: { savings_mode: 'savings' } })).toEqual({ savings: 'savings' });
    expect(priceModesOf({ cost: { savings_mode: 'entity' } })).toEqual({});
  });

  it('has no label above the entity picker, a helper and a check of its unit', () => {
    const hass: HomeAssistant = { states: {}, language: 'en' };
    expect(formLabel(t, 'savings_entity')).toBe('');
    expect(formLabel(t, 'savings_mode')).toBe('Solar savings');
    expect(fieldHelper(t, 'savings_entity')).toContain('€/h');
    expect(entityIssues({ ...base, cost: { savings_entity: 'sensor.gone' } }, hass)).toEqual([
      { where: 'cost', field: 'savings_entity', entity: 'sensor.gone', problem: 'missing' },
    ]);
  });
});

describe('editor ready-made cost', () => {
  const t = (key: Parameters<typeof localize>[1]) => localize('en', key);
  const schema = new EditorSchema(t, undefined);
  const names = (config: LiveEnergyCardConfig, modes = {}) =>
    fieldNames(schema.card(config, modes)).filter((n) => /price|cost|earnings/.test(n));

  it('derives the source, the ready-made amount winning', () => {
    expect(priceMode({ cost_entity: 'sensor.c', price_entity: 'sensor.p' }, 'price')).toBe('cost');
    expect(priceMode({ earnings_entity: 'sensor.e' }, 'export_price')).toBe('earnings');
    // The earnings entity is the export side's: it does not change the import source.
    expect(priceMode({ earnings_entity: 'sensor.e' }, 'price')).toBe('none');
  });

  it('shows the entity field of the chosen source only', () => {
    expect(names({ ...base, cost: { cost_entity: 'sensor.c' } })).toEqual([
      'price_mode',
      'cost_entity',
      'export_price_mode',
    ]);
    expect(names(base, { export_price: 'earnings' })).toEqual([
      'price_mode',
      'export_price_mode',
      'earnings_entity',
    ]);
  });

  it('keeps only the field of the chosen source', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      cost: { price: 0.2, price_entity: 'sensor.p', cost_entity: 'sensor.c' },
    };
    expect(roundTrip(config).cost).toEqual({ cost_entity: 'sensor.c' });
    expect(
      roundTrip(config, (d) => ((d.cost as Record<string, unknown>).price_mode = 'entity')).cost,
    ).toEqual({
      price_entity: 'sensor.p',
    });
    const earnings = roundTrip(base, (d) =>
      Object.assign(d.cost as object, {
        export_price_mode: 'earnings',
        earnings_entity: 'sensor.e',
        price_entity: 'sensor.p',
      }),
    );
    expect(earnings.cost).toEqual({ earnings_entity: 'sensor.e' });
  });

  it('reads the ready-made sources picked in the form', () => {
    expect(priceModesOf({ cost: { price_mode: 'cost', export_price_mode: 'earnings' } })).toEqual({
      price: 'cost',
      export_price: 'earnings',
    });
    // `earnings` is not a source of the import price.
    expect(priceModesOf({ cost: { price_mode: 'earnings' } })).toEqual({});
  });

  it('shows no label above the entity pickers of a price source, but keeps it elsewhere', () => {
    expect(formLabel(t, 'price_entity')).toBe('');
    expect(formLabel(t, 'cost_entity')).toBe('');
    expect(formLabel(t, 'price_mode')).toBe('Import price');
    expect(formLabel(t, 'export_price_mode')).toBe('Export price');
    // The issue list still names the field.
    expect(fieldLabel(t, 'price_entity')).toBe('Import price entity');
  });

  it('explains the ready-made fields, and only them', () => {
    expect(fieldHelper(t, 'cost_entity')).toContain('€/h');
    expect(fieldHelper(t, 'earnings_entity')).toContain('€/h');
    expect(fieldHelper(t, 'price_entity')).toBe('');
  });
});

describe('editor cost period', () => {
  const t = (key: Parameters<typeof localize>[1]) => localize('en', key);
  const schema = new EditorSchema(t, undefined);

  it('only writes the daily period, the hourly rate being the default', () => {
    expect(toFormData(base).cost).toMatchObject({ period: 'hour' });
    expect('cost' in roundTrip(base)).toBe(false);
    expect(roundTrip(base, (d) => ((d.cost as Record<string, unknown>).period = 'day')).cost).toEqual({
      period: 'day',
    });
    const day: LiveEnergyCardConfig = { ...base, cost: { period: 'day', price: 0.2 } };
    expect(roundTrip(day).cost).toEqual({ period: 'day', price: 0.2 });
  });

  it('always asks for the exported energy of the grid: the bubble shows it, the daily cost needs it', () => {
    const grid = (config: LiveEnergyCardConfig) =>
      fieldNames(schema.node('grid', config)).includes('export_energy_entity');
    expect(grid(base)).toBe(true);
    expect(grid({ ...base, cost: { period: 'day' } })).toBe(true);
    expect(grid({ ...base, cost: { period: 'hour' } })).toBe(true);
    const solar = fieldNames(schema.node('solar', { ...base, cost: { period: 'day' } }));
    expect(solar).not.toContain('export_energy_entity');
  });

  it('keeps the exported energy counters when the mode is switched back', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      grid: { entity: 'sensor.g', export_energy_entity: ['sensor.a', 'sensor.b'] },
    };
    expect(roundTrip(config).grid?.export_energy_entity).toEqual(['sensor.a', 'sensor.b']);
    expect(
      roundTrip({ ...config, grid: { entity: 'sensor.g', export_energy_entity: 'sensor.a' } }).grid,
    ).toEqual({
      entity: 'sensor.g',
      export_energy_entity: 'sensor.a',
    });
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
        ...fieldNames(schema.card({ ...base, cost: { period: 'day' } })),
        ...fieldNames(schema.card(base, { price: 'cost', export_price: 'earnings' })),
        ...fieldNames(schema.card(base, { price: 'fixed', export_price: 'entity' })),
        ...fieldNames(schema.card(base, { price: 'entity', export_price: 'fixed' })),
        ...fieldNames(schema.device({ entity: 'sensor.x' })),
        ...fieldNames(schema.device(group)),
        ...fieldNames(schema.card({ ...base, solar: { separate: true }, battery: { separate: true } })),
        ...[false, true].flatMap((separate) => [
          ...fieldNames(schema.unit('solar', { entity: 'sensor.x' }, separate)),
          ...fieldNames(schema.unit('battery', { entity: 'sensor.x' }, separate)),
        ]),
      ];
      const missing = [...new Set(names)].filter((n) => fieldLabel(t, n) === n);
      expect(missing).toEqual([]);
    });
  }
});

describe('editor units', () => {
  const t = (key: Parameters<typeof localize>[1]) => localize('en', key);
  const schema = new EditorSchema(t, undefined);
  const names = (list: Schema[]) => [...new Set(fieldNames(list))];
  const withUnits: LiveEnergyCardConfig = {
    ...base,
    solar: { name: 'PV', units: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }] },
  };

  it('the node of a source has the switch and its single bubble, nothing it reads', () => {
    for (const kind of ['solar', 'battery'] as const) {
      const fields = names(schema.node(kind, base));
      expect(fields[0]).toBe('separate');
      expect(fields).toEqual(
        expect.arrayContaining(['name', 'icon', 'color', 'hide_when_zero', 'secondary_entity']),
      );
      for (const read of ['entity', 'soc_entity', 'energy_entity', 'invert', 'capacity'])
        expect(fields).not.toContain(read);
    }
    expect(names(schema.node('battery', base))).toContain('charge_color');
    expect(names(schema.node('solar', base))).not.toContain('charge_color');
  });

  it('with a bubble per unit, the node only has the switch: the bubbles are set on the units', () => {
    expect(names(schema.node('solar', { ...base, solar: { separate: true } }))).toEqual(['separate']);
    expect(names(schema.node('battery', { ...base, battery: { separate: true } }))).toEqual(['separate']);
  });

  it('the other nodes keep their entities, and have no switch', () => {
    expect(names(schema.node('grid', base))).toEqual(expect.arrayContaining(['entity', 'import_entity']));
    for (const kind of ['grid', 'home'] as const)
      expect(names(schema.node(kind, base))).not.toContain('separate');
  });

  it('a unit reads one entity, and has a bubble only when it is shown on its own', () => {
    const single = names(schema.unit('solar', {}, false));
    expect(single).toEqual(['entity', 'peak_power', 'peak_power_entity', 'invert', 'energy_entity']);
    expect(names(schema.unit('solar', {}, true))).toEqual(
      expect.arrayContaining([...single, 'name', 'icon', 'color', 'hide_when_zero', 'secondary_entity']),
    );
    const battery = names(schema.unit('battery', {}, false));
    expect(battery).toEqual(
      expect.arrayContaining([
        'entity',
        'charge_entity',
        'discharge_entity',
        'grid_charge_entity',
        'soc_entity',
        'capacity',
        'min_soc',
      ]),
    );
    expect(battery).not.toContain('name');
    expect(names(schema.unit('battery', {}, true))).toContain('charge_color');
    // One entity, not a list: several make several units.
    const entity = schema.unit('solar', {}, false)[0] as { selector: { entity: { multiple?: boolean } } };
    expect(entity.selector.entity.multiple).toBeUndefined();
  });

  it('explains the switch', () => {
    expect(fieldHelper(t, 'separate')).toContain('One bubble per unit');
  });

  it('puts the switch in the form data, without the units, and drops it when it is off', () => {
    const data = toFormData({ ...withUnits, solar: { ...withUnits.solar, separate: true } });
    expect(data.solar).toMatchObject({ separate: true, name: 'PV' });
    expect('units' in (data.solar as object)).toBe(false);
    expect(toFormData(base).solar).toMatchObject({ separate: false });
    expect(roundTrip(base).solar).toBeUndefined();
    const off = roundTrip({ ...withUnits, solar: { ...withUnits.solar, separate: true } }, (d) => {
      (d.solar as Record<string, unknown>).separate = false;
    });
    expect('separate' in off.solar!).toBe(false);
  });

  it('keeps the units through the form of the node, and drops an empty list', () => {
    const next = roundTrip(withUnits, (d) => ((d.solar as Record<string, unknown>).color = 'teal'));
    expect(next.solar).toEqual({ ...withUnits.solar, color: 'teal' });
    expect('units' in roundTrip({ ...base, solar: { name: 'PV', units: [] } }).solar!).toBe(false);
  });

  it('adds an empty unit at the end', () => {
    expect(addUnit({ name: 'PV' }).units).toEqual([{}]);
    expect(addUnit({ units: [{ entity: 'sensor.a' }] })).toEqual({ units: [{ entity: 'sensor.a' }, {}] });
  });

  it('updates a unit, or appends it when it is the one shown while the list is empty', () => {
    const node = { units: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }] };
    expect(updateUnit(node, 1, { entity: 'sensor.c' }).units).toEqual([
      { entity: 'sensor.a' },
      { entity: 'sensor.c' },
    ]);
    expect(updateUnit({}, 0, { entity: 'sensor.a' }).units).toEqual([{ entity: 'sensor.a' }]);
    expect(updateUnit(node, 5, { entity: 'sensor.c' }).units).toEqual(node.units);
  });

  it('removes a unit and keeps the list', () => {
    const node = { separate: true, units: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }] };
    expect(removeUnit(node, 0)).toEqual({ separate: true, units: [{ entity: 'sensor.b' }] });
    expect(removeUnit({ units: [{ entity: 'sensor.a' }] }, 0).units).toEqual([]);
    expect(unitsOf(undefined)).toEqual([]);
  });

  describe('reordering', () => {
    const node = { units: ['a', 'b', 'c', 'd'].map((id) => ({ entity: `sensor.${id}` })) };
    const order = (n: { units?: { entity?: string }[] }) => n.units!.map((u) => u.entity!.slice(-1)).join('');

    it('moves a unit by one position with the keyboard, where it can', () => {
      expect(order(shiftUnit(node, 1, 1)!.node)).toBe('acbd');
      expect(shiftUnit(node, 1, 1)!.index).toBe(2);
      expect(order(shiftUnit(node, 1, -1)!.node)).toBe('bacd');
      expect(shiftUnit(node, 0, -1)).toBeNull();
      expect(shiftUnit(node, 3, 1)).toBeNull();
    });

    it('drops a unit before or after another one', () => {
      const drop = (from: number, at: number, position: 'before' | 'after') =>
        dropUnit(node, from, { path: [at], position });
      expect(order(drop(0, 2, 'before')!.node)).toBe('bacd');
      expect(order(drop(0, 2, 'after')!.node)).toBe('bcad');
      expect(drop(0, 2, 'after')!.index).toBe(2);
      expect(order(drop(3, 0, 'before')!.node)).toBe('dabc');
      expect(order(drop(3, 1, 'after')!.node)).toBe('abdc');
    });

    it('does nothing when the unit would stay where it is', () => {
      expect(dropUnit(node, 1, { path: [1], position: 'before' })).toBeNull();
      expect(dropUnit(node, 1, { path: [1], position: 'after' })).toBeNull();
      expect(dropUnit(node, 1, { path: [0], position: 'after' })).toBeNull();
      expect(dropUnit(node, 1, { path: [2], position: 'before' })).toBeNull();
    });

    it('does not mutate the node', () => {
      shiftUnit(node, 1, 1);
      dropUnit(node, 0, { path: [3], position: 'after' });
      expect(order(node)).toBe('abcd');
    });
  });

  it('unit form: shows the hide_when_zero of the card, and writes only what differs', () => {
    expect(unitFormData('solar', { entity: 'sensor.a' }, true).hide_when_zero).toBe(true);
    expect(unitFormData('solar', { entity: 'sensor.a' }, false).hide_when_zero).toBe(false);
    expect(unitFormData('solar', { hide_when_zero: false }, true).hide_when_zero).toBe(false);

    expect(
      unitFromForm('solar', { entity: 'sensor.a', hide_when_zero: true, invert: false }, {}, true),
    ).toEqual({
      entity: 'sensor.a',
    });
    expect(
      unitFromForm('solar', { entity: 'sensor.a', hide_when_zero: false, name: 'Roof' }, {}, true),
    ).toEqual({
      entity: 'sensor.a',
      hide_when_zero: false,
      name: 'Roof',
    });
    // An explicit value stays, even when it equals the default.
    expect(unitFromForm('solar', { hide_when_zero: true }, { hide_when_zero: true }, true)).toEqual({
      hide_when_zero: true,
    });
    expect(unitFromForm('battery', { entity: '', soc_entity: 'sensor.s', invert: true }, {}, true)).toEqual({
      soc_entity: 'sensor.s',
      invert: true,
    });
  });
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
      solar: { secondary_entity: 'sensor.solar_day', units: [{ entity: 'sensor.solar' }] },
      battery: { units: [{ entity: 'sensor.solar', soc_entity: 'sensor.soc' }] },
      cost: { price_entity: 'sensor.price' },
      devices: [{ entity: 'sensor.tv' }],
    };
    expect(entityIssues(config, hass)).toEqual([]);
  });

  it('flags missing entities and entities of the wrong kind', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      solar: { units: [{ entity: 'sensor.solar' }, { entity: 'sensor.solar_day' }] },
      battery: { units: [{ entity: 'sensor.solar', soc_entity: 'sensor.solar' }] },
      devices: [{ name: 'IT', devices: [{ entity: 'sensor.gone' }] }],
    };
    expect(entityIssues(config, hass)).toEqual([
      {
        where: { group: 'solar', index: 1 },
        field: 'entity',
        entity: 'sensor.solar_day',
        problem: 'kind',
        expected: 'power',
      },
      {
        where: { group: 'battery', index: 0 },
        field: 'soc_entity',
        entity: 'sensor.solar',
        problem: 'kind',
        expected: 'percent',
      },
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
        separate: true,
        units: [
          {
            entity: 'sensor.solar',
            energy_entity: 'sensor.solar_day',
            secondary_entity: 'sensor.solar_day',
          },
        ],
      },
    };
    const issues = entityIssues(config, hass);
    expect(issues).toEqual([
      {
        where: { group: 'solar', index: 0 },
        field: 'energy_entity',
        entity: 'sensor.solar_day',
        problem: 'ignored',
      },
    ]);
    expect(describeIssue(issues[0], config, hass, t).problem).toContain('replaces');
  });

  it('flags the weaker price sources, ready-made amount first', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      cost: { price: 0.25, price_entity: 'sensor.price', cost_entity: 'sensor.gone' },
    };
    expect(entityIssues(config, hass)).toEqual([
      { where: 'cost', field: 'price_entity', entity: 'sensor.price', problem: 'ignored_price' },
      { where: 'cost', field: 'price', entity: '0.25', problem: 'ignored_price' },
      { where: 'cost', field: 'cost_entity', entity: 'sensor.gone', problem: 'missing' },
    ]);
  });

  it('warns when a ready-made cost leaves the solar savings nothing to be calculated from', () => {
    const solar = { units: [{ entity: 'sensor.s' }] };
    const noPrice = (config: LiveEnergyCardConfig) =>
      entityIssues(config, hass).filter((i) => i.problem === 'no_price');
    const config: LiveEnergyCardConfig = { ...base, solar, cost: { cost_entity: 'sensor.gone' } };
    expect(noPrice(config)).toEqual([
      { where: 'cost', field: 'cost_entity', entity: 'sensor.gone', problem: 'no_price' },
    ]);
    expect(describeIssue(noPrice(config)[0], config, hass, t).problem).toContain('savings entity');
    // A price, a savings entity or no solar: nothing to flag.
    expect(noPrice({ ...config, cost: { cost_entity: 'sensor.gone', price: 0.2 } })).toEqual([]);
    expect(noPrice({ ...config, cost: { cost_entity: 'sensor.gone', savings_entity: 'sensor.x' } })).toEqual(
      [],
    );
    expect(noPrice({ ...config, solar: undefined })).toEqual([]);
  });

  it('warns when a price entity hides the fixed price', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      cost: { price: 0.25, price_entity: 'sensor.price', export_price: 0.1 },
    };
    const issues = entityIssues(config, hass);
    expect(issues).toEqual([{ where: 'cost', field: 'price', entity: '0.25', problem: 'ignored_price' }]);
    expect(describeIssue(issues[0], config, hass, t).problem).toContain('another price source');
  });

  it('names an unnamed device by its position', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      devices: [{ entity: 'sensor.tv' }, { entity: 'sensor.gone' }],
    };
    const [issue] = entityIssues(config, hass);
    expect(describeIssue(issue, config, hass, t).where).toBe('Device 2');
  });

  it('checks the entities of the units, and tells them apart from the devices', () => {
    const config: LiveEnergyCardConfig = {
      ...base,
      solar: { separate: true, units: [{ entity: 'sensor.solar' }, { name: 'Shed', entity: 'sensor.gone' }] },
      battery: { separate: true, units: [{ entity: 'sensor.solar', soc_entity: 'sensor.solar' }] },
      devices: [{ entity: 'sensor.tv' }],
    };
    const issues = entityIssues(config, hass);
    expect(issues.map((i) => [i.where, i.field, i.problem])).toEqual([
      [{ group: 'solar', index: 1 }, 'entity', 'missing'],
      [{ group: 'battery', index: 0 }, 'soc_entity', 'kind'],
    ]);
    expect(unitIssues(issues, 'solar', 1)).toHaveLength(1);
    expect(unitIssues(issues, 'solar', 0)).toEqual([]);
    expect(unitIssues(issues, 'battery', 1)).toEqual([]);
    expect(deviceIssues(issues, [0])).toEqual([]);
    expect(describeIssue(issues[0], config, hass, t).where).toBe('Solar › Shed');
    expect(describeIssue(issues[1], config, hass, t)).toMatchObject({ where: 'Battery › Unit 1' });
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
