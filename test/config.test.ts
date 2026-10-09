import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config';

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
