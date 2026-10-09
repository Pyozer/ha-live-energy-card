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

  it('rejects a capacity that is not a number, in a unit', () => {
    expect(() =>
      validateConfig({ ...base, battery: { units: [{ entity: 'sensor.b', capacity: 'big' }] } }),
    ).toThrow(/capacity/);
  });

  it('watches the entities of the units, and the custom line of the node', () => {
    const config = validateConfig({
      type: 'x',
      solar: { secondary_entity: 'sensor.day', units: [{ entity: 'sensor.a' }] },
      battery: {
        units: [
          { entity: 'sensor.b', soc_entity: 'sensor.s' },
          { charge_entity: 'sensor.c', discharge_entity: 'sensor.d' },
        ],
      },
    });
    expect(new Set(watchedEntities(config))).toEqual(
      new Set(['sensor.day', 'sensor.a', 'sensor.b', 'sensor.s', 'sensor.c', 'sensor.d']),
    );
  });
});
