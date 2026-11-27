import { describe, expect, it } from 'vitest';
import { validateConfig, watchedEntities } from '../src/config';

const base = { type: 'custom:live-energy-card', grid: { entity: 'sensor.g' } };

describe('validateConfig numbers', () => {
  it('coerces nested numbers given as strings, and drops empty ones', () => {
    const config = validateConfig({
      ...base,
      grid: { entity: 'sensor.g', max_import: '6000' },
      cost: { price: '0.25', export_price: '' },
    });
    expect(config.grid?.max_import).toBe(6000);
    expect(config.cost).toEqual({ price: 0.25 });
  });

  it('rejects a value that is not a number, naming the field', () => {
    expect(() => validateConfig({ ...base, grid: { entity: 'sensor.g', max_import: 'lots' } })).toThrow(
      /max_import/,
    );
  });

  it('keeps devices_columns only as a whole number of at least 1, else automatic', () => {
    const columns = (devices_columns: unknown) =>
      validateConfig({ type: 'x', grid: { entity: 'sensor.g' }, devices_columns }).devices_columns;
    expect(columns(0)).toBeUndefined();
    expect(columns(-2)).toBeUndefined();
    expect(columns('many')).toBeUndefined();
    expect(columns('')).toBeUndefined();
    expect(columns(Infinity)).toBeUndefined();
    expect(columns('3')).toBe(3);
    expect(columns(2.7)).toBe(2);
    expect(columns(1)).toBe(1);
  });

  it('rounds decimals and kilo_decimals and keeps them within 0..6', () => {
    const config = (decimals: unknown, kilo_decimals: unknown) =>
      validateConfig({ ...base, decimals, kilo_decimals });
    expect(config(-1, 200)).toMatchObject({ decimals: 0, kilo_decimals: 6 });
    expect(config('1.6', 2.2)).toMatchObject({ decimals: 2, kilo_decimals: 2 });
    expect(config(3, 0)).toMatchObject({ decimals: 3, kilo_decimals: 0 });
  });

  it('does not modify the given configuration', () => {
    const input = { ...base, grid: { entity: 'sensor.g', max_import: '6000' } };
    validateConfig(input);
    expect(input.grid.max_import).toBe('6000');
  });
});

describe('validateConfig units', () => {
  it('a config made only of units is valid', () => {
    expect(() => validateConfig({ type: 'x', solar: { units: [{ entity: 'sensor.a' }] } })).not.toThrow();
    expect(() =>
      validateConfig({ type: 'x', battery: { units: [{ charge_entity: 'sensor.c' }] } }),
    ).not.toThrow();
    // Units that read nothing are not an entity.
    expect(() => validateConfig({ type: 'x', solar: { units: [{ name: 'Roof' }] } })).toThrow();
  });

  it('refuses an option that moved to the units, naming where it goes', () => {
    expect(() => validateConfig({ ...base, solar: { entity: 'sensor.a' } })).toThrow(
      /solar\.entity.*solar\.units/,
    );
    expect(() => validateConfig({ ...base, battery: { soc_entity: 'sensor.s' } })).toThrow(
      /battery\.soc_entity/,
    );
    expect(() => validateConfig({ ...base, battery: { capacity: 5 } })).toThrow(/battery\.capacity/);
    // What stays on the node is accepted.
    expect(() =>
      validateConfig({ ...base, solar: { name: 'PV', color: 'amber', hide_when_zero: false } }),
    ).not.toThrow();
  });

  it('units must be a list, without empty rows', () => {
    expect(() => validateConfig({ ...base, solar: { units: 'sensor.a' } })).toThrow(/solar\.units/);
    const config = validateConfig({
      ...base,
      battery: { units: [null, { entity: 'sensor.b', capacity: '5' }, 3] },
    });
    expect(config.battery?.units).toEqual([{ entity: 'sensor.b', capacity: 5 }]);
  });

  it('keeps the reserve of a battery unit within 0..100', () => {
    const minSoc = (min_soc: unknown) =>
      validateConfig({ ...base, battery: { units: [{ entity: 'sensor.b', min_soc }] } }).battery?.units?.[0]
        .min_soc;
    expect(minSoc(-10)).toBe(0);
    expect(minSoc('150')).toBe(100);
    expect(minSoc(20)).toBe(20);
    expect(minSoc(undefined)).toBeUndefined();
  });

  it('accepts a unit written as a bare entity id', () => {
    const config = validateConfig({
      type: 'x',
      solar: { units: ['sensor.pv', '', null] },
      battery: { units: ['sensor.bat'] },
    });
    expect(config.solar?.units).toEqual([{ entity: 'sensor.pv' }]);
    expect(config.battery?.units).toEqual([{ entity: 'sensor.bat' }]);
  });

  it('rejects a capacity that is not a number, in a unit', () => {
    expect(() =>
      validateConfig({ ...base, battery: { units: [{ entity: 'sensor.b', capacity: 'big' }] } }),
    ).toThrow(/capacity/);
  });

  it('refuses group members that are not a list, with a readable error', () => {
    for (const config of [{ ...base }, { type: 'x' }])
      expect(() => validateConfig({ ...config, devices: [{ name: 'G', devices: 'sensor.a' }] })).toThrow(
        'devices must be a list.',
      );
  });

  it('rejects non-object configs and non-array devices', () => {
    expect(() => validateConfig(null)).toThrow('Invalid configuration');
    expect(() => validateConfig('bad')).toThrow('Invalid configuration');
    expect(() => validateConfig({ ...base, devices: 'sensor.a' })).toThrow('devices must be a list.');
  });

  it('accepts a device or a group member written as a bare entity id', () => {
    const config = validateConfig({
      type: 'x',
      devices: [
        'sensor.tv',
        null,
        3,
        { name: 'G', devices: ['sensor.oven', null, 4, { entity: 'sensor.hob' }] },
      ],
    });
    expect(config.devices).toEqual([
      { entity: 'sensor.tv' },
      { name: 'G', devices: [{ entity: 'sensor.oven' }, { entity: 'sensor.hob' }] },
    ]);
  });

  it('coerces the maximum power of devices and group members', () => {
    const config = validateConfig({
      ...base,
      devices: [
        { entity: 'sensor.a', max_power: '2000', devices: [{ entity: 'sensor.b', max_power: '500' }] },
      ],
    });
    expect(config.devices?.[0].max_power).toBe(2000);
    expect(config.devices?.[0].devices?.[0].max_power).toBe(500);
    expect(() => validateConfig({ ...base, devices: [{ entity: 'sensor.a', max_power: 'big' }] })).toThrow(
      /max_power/,
    );
  });

  it('watches the entities of the units, and the custom line of the node', () => {
    const config = validateConfig({
      type: 'x',
      solar: { secondary_entity: 'sensor.day', units: [{ entity: 'sensor.a' }] },
      battery: {
        units: [
          { entity: 'sensor.b', soc_entity: 'sensor.s', grid_charge_entity: 'sensor.gc' },
          { charge_entity: 'sensor.c', discharge_entity: 'sensor.d' },
        ],
      },
    });
    expect(new Set(watchedEntities(config))).toEqual(
      new Set(['sensor.day', 'sensor.a', 'sensor.b', 'sensor.s', 'sensor.gc', 'sensor.c', 'sensor.d']),
    );
  });
});
