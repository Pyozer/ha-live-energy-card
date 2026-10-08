import { describe, expect, it } from 'vitest';
import { computeFlows } from '../src/compute';
import { computeStats, formatCarbonRate, formatMoneyRate, readPrice } from '../src/cost';
import { configFromEnergyPrefs } from '../src/energy';
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
