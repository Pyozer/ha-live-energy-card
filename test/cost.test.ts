import { describe, expect, it } from 'vitest';
import { computeFlows } from '../src/compute';
import {
  computeStats,
  dailyAmounts,
  formatCarbonRate,
  formatMoney,
  formatMoneyRate,
  readMoney,
  readPrice,
} from '../src/cost';
import { configFromEnergyPrefs } from '../src/energy';
import { energyStatistics } from '../src/energy-today';
import { buildModel } from '../src/model';
import { validateConfig, watchedEntities } from '../src/config';
import type { HassEntity, HomeAssistant } from '../src/types';

const ent = (entity_id: string, state: number | string, unit?: string): HassEntity => ({
  entity_id,
  state: String(state),
  attributes: unit ? { unit_of_measurement: unit } : {},
});
const hass = (...states: HassEntity[]): HomeAssistant => ({
  states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
  config: { currency: 'EUR' },
});

describe('prices', () => {
  it('reads the currency and normalizes to a price per kWh', () => {
    expect(readPrice(ent('sensor.p', 0.25, 'EUR/kWh'))).toEqual({ value: 0.25, currency: 'EUR' });
    expect(readPrice(ent('sensor.p', 120, '€/MWh'))?.value).toBeCloseTo(0.12);
    expect(readPrice(ent('sensor.p', 'unknown', 'EUR/kWh'))).toBeNull();
    expect(readPrice(undefined)).toBeNull();
  });
});

describe('computeStats', () => {
  const importing = computeFlows({ solar: 1000, gridImport: 2000, home: 3000 });
  const exporting = computeFlows({ solar: 3000, gridExport: 2000 });

  it('cost and solar savings per hour', () => {
    const stats = computeStats(importing, hass(), { price: 0.2 }, undefined)!;
    expect(stats.cost).toBeCloseTo(0.4);
    expect(stats.savings).toBeCloseTo(0.2);
    expect(stats.currency).toBe('EUR');
    expect(stats.carbon).toBeNull();
  });

  it('export is earned only with an export price', () => {
    expect(computeStats(exporting, hass(), { price: 0.2 }, undefined)!.cost).toBe(0);
    expect(computeStats(exporting, hass(), { price: 0.2, export_price: 0.1 }, undefined)!.cost).toBeCloseTo(
      -0.2,
    );
  });

  describe('total of the day', () => {
    const day = { price: 0.2, export_price: 0.1, period: 'day' as const };
    const today = new Map<string, number | null>([
      ['grid', 6],
      ['grid_export', 4],
      ['solar', 14],
    ]);

    it('prices the energy of the day, ignoring the current power', () => {
      const stats = computeStats(importing, hass(), day, undefined, today)!;
      expect(stats.period).toBe('day');
      // 6 kWh × 0.2 − 4 kWh × 0.1
      expect(stats.cost).toBeCloseTo(0.8);
      // (14 − 4) kWh of solar used on site × 0.2
      expect(stats.savings).toBeCloseTo(2);
    });

    it('does not count the export without an export price', () => {
      const stats = computeStats(importing, hass(), { price: 0.2, period: 'day' }, undefined, today)!;
      expect(stats.cost).toBeCloseTo(1.2);
    });

    it('is empty while a counter is missing, instead of being wrong', () => {
      const prices = { value: 0.2 };
      const noExport = new Map<string, number | null>([
        ['grid', 6],
        ['solar', 14],
      ]);
      const partial = dailyAmounts(noExport, prices, null);
      expect(partial.importCost).toBeCloseTo(1.2);
      expect(partial.earnings).toBe(0);
      expect(partial.savings).toBeNull();
      // An export price needs the exported energy.
      expect(dailyAmounts(noExport, prices, { value: 0.1 }).earnings).toBeNull();
      expect(dailyAmounts(new Map([['grid', null]]), prices, null).importCost).toBeNull();
      expect(dailyAmounts(new Map(), prices, null)).toEqual({ importCost: null, earnings: 0, savings: null });
      expect(dailyAmounts(today, null, null).importCost).toBeNull();
    });

    it('never gives negative savings', () => {
      const odd = new Map([
        ['solar', 2],
        ['grid_export', 5],
      ]);
      expect(dailyAmounts(odd, { value: 0.2 }, null).savings).toBe(0);
    });

    it('an unknown period falls back to the hourly rate', () => {
      const config = validateConfig({
        type: 'x',
        grid: { entity: 'g' },
        cost: { price: 0.2, period: 'week' },
      } as never);
      expect(config.cost?.period).toBeUndefined();
    });
  });

  describe('ready-made cost entities', () => {
    const states = [ent('sensor.cost_rate', 0.5, '€/h'), ent('sensor.earn_rate', 0.1, '€/h')];

    it('hourly: the state of the entity replaces the price', () => {
      const stats = computeStats(
        importing,
        hass(...states),
        { cost_entity: 'sensor.cost_rate', earnings_entity: 'sensor.earn_rate' },
        undefined,
      )!;
      expect(stats.period).toBe('hour');
      expect(stats.cost).toBeCloseTo(0.4);
      expect(stats.currency).toBe('€');
      // Savings need a price, not a ready-made cost.
      expect(stats.savings).toBeNull();
    });

    it('can be mixed with a price on the other side', () => {
      // Import priced from the power, earnings from an entity.
      const stats = computeStats(
        importing,
        hass(...states),
        { price: 0.2, earnings_entity: 'sensor.earn_rate' },
        undefined,
      )!;
      expect(stats.cost).toBeCloseTo(0.4 - 0.1);
      expect(stats.savings).toBeCloseTo(0.2);
    });

    it('is empty when the entity is unavailable', () => {
      const stats = computeStats(
        importing,
        hass(ent('sensor.cost_rate', 'unavailable', '€/h')),
        { cost_entity: 'sensor.cost_rate' },
        undefined,
      )!;
      expect(stats.cost).toBeNull();
    });

    it("daily: today's change from the statistics, the state when there are none", () => {
      const cost = { cost_entity: 'sensor.cost_day', period: 'day' as const };
      const day = hass(ent('sensor.cost_day', 120, 'EUR'));
      // A cumulative counter: only today's change counts.
      expect(computeStats(importing, day, cost, undefined, new Map([['cost', 1.3]]))!.cost).toBeCloseTo(1.3);
      // No statistics: the entity is already a total of the day.
      expect(computeStats(importing, day, cost, undefined, new Map([['cost', null]]))!.cost).toBe(120);
      // Not loaded yet: nothing, rather than a cumulative total.
      expect(computeStats(importing, day, cost, undefined, new Map())!.cost).toBeNull();
      expect(computeStats(importing, day, cost, undefined)!.currency).toBe('EUR');
    });

    it('reads a monetary entity, its currency being the unit before the slash', () => {
      expect(readMoney(ent('sensor.a', 1.5, '€/h'))).toEqual({ value: 1.5, currency: '€' });
      expect(readMoney(ent('sensor.a', 2, 'EUR'))).toEqual({ value: 2, currency: 'EUR' });
      expect(readMoney(ent('sensor.a', 'unknown'))).toBeNull();
      expect(readMoney(undefined)).toBeNull();
    });

    it('the entities are watched, and statistics are fetched only in daily mode', () => {
      const cost = { cost_entity: 'sensor.cost_rate', earnings_entity: 'sensor.earn_rate' };
      const cfg = validateConfig({ type: 'x', grid: { entity: 'g' }, cost } as never);
      expect(watchedEntities(cfg)).toEqual(expect.arrayContaining(['sensor.cost_rate', 'sensor.earn_rate']));
      expect(energyStatistics(cfg).has('cost')).toBe(false);
      const day = validateConfig({
        type: 'x',
        grid: { entity: 'g' },
        cost: { ...cost, period: 'day' },
      } as never);
      expect([...energyStatistics(day)]).toEqual([
        ['cost', ['sensor.cost_rate']],
        ['earnings', ['sensor.earn_rate']],
      ]);
    });
  });

  describe('ready-made savings entity', () => {
    it('hourly: the state of the entity replaces the calculation', () => {
      const stats = computeStats(
        importing,
        hass(ent('sensor.savings_rate', 0.7, '€/h')),
        { price: 0.2, savings_entity: 'sensor.savings_rate' },
        undefined,
      )!;
      expect(stats.savings).toBeCloseTo(0.7);
      // The cost is still computed from the price.
      expect(stats.cost).toBeCloseTo(0.4);
    });

    it('works with a ready-made cost and no price, which alone gives no savings', () => {
      const states = hass(ent('sensor.cost_rate', 0.5, '€/h'), ent('sensor.savings_rate', 0.7, '€/h'));
      const cost = { cost_entity: 'sensor.cost_rate' };
      expect(computeStats(importing, states, cost, undefined)!.savings).toBeNull();
      const stats = computeStats(
        importing,
        states,
        { ...cost, savings_entity: 'sensor.savings_rate' },
        undefined,
      )!;
      expect(stats.savings).toBeCloseTo(0.7);
      expect(stats.cost).toBeCloseTo(0.5);
    });

    it("daily: today's change from the statistics, the state when there are none", () => {
      const cost = { savings_entity: 'sensor.savings_day', period: 'day' as const };
      const day = hass(ent('sensor.savings_day', 143.7, 'EUR'));
      expect(
        computeStats(importing, day, cost, undefined, new Map([['savings', 0.13]]))!.savings,
      ).toBeCloseTo(0.13);
      expect(computeStats(importing, day, cost, undefined, new Map([['savings', null]]))!.savings).toBe(
        143.7,
      );
      // Not loaded yet: nothing, rather than a cumulative total.
      expect(computeStats(importing, day, cost, undefined, new Map())!.savings).toBeNull();
    });

    it('is empty when the entity is unavailable, and its currency is used when none is set', () => {
      const cost = { savings_entity: 'sensor.s' };
      expect(
        computeStats(importing, hass(ent('sensor.s', 'unavailable', '€/h')), cost, undefined)!.savings,
      ).toBeNull();
      expect(computeStats(importing, hass(ent('sensor.s', 1, 'CHF/h')), cost, undefined)!.currency).toBe(
        'CHF',
      );
    });

    it('is watched, and its statistics are fetched only in daily mode', () => {
      const cost = { savings_entity: 'sensor.s' };
      const cfg = validateConfig({ type: 'x', grid: { entity: 'g' }, cost } as never);
      expect(watchedEntities(cfg)).toContain('sensor.s');
      expect(energyStatistics(cfg).has('savings')).toBe(false);
      const day = validateConfig({
        type: 'x',
        grid: { entity: 'g' },
        cost: { ...cost, period: 'day' },
      } as never);
      expect([...energyStatistics(day)]).toEqual([['savings', ['sensor.s']]]);
    });
  });

  it('price entity and currency from its unit', () => {
    const stats = computeStats(
      importing,
      hass(ent('sensor.price', 0.3, 'CHF/kWh')),
      { price_entity: 'sensor.price' },
      undefined,
    )!;
    expect(stats.cost).toBeCloseTo(0.6);
    expect(stats.currency).toBe('CHF');
  });

  it('carbon from the grid intensity, never negative', () => {
    expect(
      computeStats(importing, hass(ent('sensor.co2', 50, 'gCO2eq/kWh')), undefined, 'sensor.co2')!.carbon,
    ).toBe(100);
    expect(computeStats(exporting, hass(ent('sensor.co2', 50)), undefined, 'sensor.co2')!.carbon).toBe(0);
    expect(
      computeStats(importing, hass(ent('sensor.co2', 'unavailable')), undefined, 'sensor.co2')!.carbon,
    ).toBeNull();
  });

  it('nothing configured: no stats', () => {
    expect(computeStats(importing, hass(), undefined, undefined)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats a total without the per hour suffix', () => {
    expect(formatMoney(1.84, 'EUR', 'en')).toBe('€1.84');
    expect(formatMoney(1.84, undefined, 'en')).toBe('1.84');
    expect(formatMoney(1.84, '$$', 'en')).toBe('1.84 $$');
    expect(formatMoneyRate(1.84, 'EUR', 'en')).toBe('€1.84/h');
  });

  it('money and carbon rates', () => {
    expect(formatMoneyRate(0.4, 'EUR', 'en')).toBe('€0.40/h');
    expect(formatMoneyRate(0.4, '€', 'en')).toBe('0.40 €/h');
    expect(formatMoneyRate(12.34, undefined, 'en')).toBe('12.3/h');
    expect(formatCarbonRate(120, 'en')).toBe('120 g/h');
    expect(formatCarbonRate(1500, 'en')).toBe('1.5 kg/h');
  });
});

describe('cost configuration', () => {
  it('buildModel exposes the stats; prices are watched and coerced', () => {
    const config = validateConfig({
      type: 'x',
      grid: { entity: 'sensor.grid' },
      cost: { price: '0.2', export_price_entity: 'sensor.export' },
      carbon: { intensity_entity: 'sensor.co2' },
    });
    expect(config.cost?.price).toBe(0.2);
    expect(watchedEntities(config)).toEqual(expect.arrayContaining(['sensor.export', 'sensor.co2']));
    const model = buildModel(config, hass(ent('sensor.grid', 1000, 'W'), ent('sensor.co2', 40)));
    expect(model.stats?.cost).toBeCloseTo(0.2);
    expect(model.stats?.carbon).toBe(40);
    expect(() => validateConfig({ type: 'x', grid: { entity: 'g' }, cost: { price: 'abc' } })).toThrow();
  });

  it('Energy dashboard: a single tariff is imported, several are left to the user', () => {
    const single = configFromEnergyPrefs({
      energy_sources: [
        { type: 'grid', stat_energy_from: 'e.in', entity_energy_price: 'sensor.price' },
        { type: 'grid', stat_energy_to: 'e.out', number_energy_price_export: 0.1 },
      ],
    });
    expect(single.cost).toEqual({ price_entity: 'sensor.price', export_price: 0.1 });
    const tariffs = configFromEnergyPrefs({
      energy_sources: [
        { type: 'grid', stat_energy_from: 'e.peak', entity_energy_price: 'input_number.peak' },
        { type: 'grid', stat_energy_from: 'e.off', entity_energy_price: 'input_number.off_peak' },
      ],
    });
    expect(tariffs.cost).toBeUndefined();
  });
});
