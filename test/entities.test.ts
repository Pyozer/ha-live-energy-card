import { describe, expect, it } from 'vitest';
import { entitiesOfKind, entitySelector, matchesKind } from '../src/entities';
import type { HassEntity } from '../src/types';

const ent = (entity_id: string, unit?: string, device_class?: string): HassEntity => ({
  entity_id,
  state: '1',
  attributes: { unit_of_measurement: unit, ...(device_class ? { device_class } : {}) },
});

const states: Record<string, HassEntity> = Object.fromEntries(
  [
    ent('sensor.solar_power', 'W', 'power'),
    ent('sensor.template_power', 'kW'),
    ent('sensor.milli', 'mW'),
    ent('sensor.solar_energy', 'kWh', 'energy'),
    ent('sensor.battery_level', '%', 'battery'),
    ent('sensor.temperature', '°C', 'temperature'),
    ent('sensor.price', 'EUR/kWh'),
    ent('sensor.cost_rate', '€/h'),
    ent('sensor.cost_day', 'EUR'),
    ent('sensor.bill', 'USD', 'monetary'),
    ent('sensor.grid_co2', 'gCO2eq/kWh'),
    ent('input_number.fake_power', 'W'),
    ent('light.kitchen', 'W'),
  ].map((e) => [e.entity_id, e]),
);

describe('entity kinds', () => {
  it('power fields only list power entities', () => {
    expect(entitiesOfKind({ states }, 'power')).toEqual([
      'input_number.fake_power',
      'sensor.milli',
      'sensor.solar_power',
      'sensor.template_power',
    ]);
  });

  it('energy, percent, price and carbon kinds', () => {
    expect(entitiesOfKind({ states }, 'energy')).toEqual(['sensor.solar_energy']);
    expect(entitiesOfKind({ states }, 'percent')).toEqual(['sensor.battery_level']);
    // A monetary value also counts as a price.
    expect(entitiesOfKind({ states }, 'price')).toEqual(['sensor.bill', 'sensor.price']);
    // A ready-made cost: a currency, possibly per hour (not a price per kWh).
    expect(entitiesOfKind({ states }, 'money')).toEqual([
      'sensor.bill',
      'sensor.cost_day',
      'sensor.cost_rate',
    ]);
    expect(entitiesOfKind({ states }, 'carbon')).toEqual(['sensor.grid_co2']);
  });

  it('rejects other domains and missing entities', () => {
    expect(matchesKind(states['light.kitchen'], 'power')).toBe(false);
    expect(matchesKind(undefined, 'power')).toBe(false);
  });

  it('keeps the current value selectable even when it does not match', () => {
    const sel = entitySelector({ states }, 'power', 'sensor.temperature');
    expect(sel.entity.include_entities).toContain('sensor.temperature');
    expect(entitySelector({ states }, 'power', 'sensor.solar_power').entity.include_entities).toHaveLength(4);
  });

  it('without hass the list is empty', () => {
    expect(entitiesOfKind(undefined, 'power')).toEqual([]);
  });
});

describe('carbon picker', () => {
  const carbon = (...list: HassEntity[]) =>
    entitiesOfKind({ states: Object.fromEntries(list.map((e) => [e.entity_id, e])) }, 'carbon');

  it('only lists intensities in grams per kWh', () => {
    expect(
      carbon(
        ent('sensor.a', 'gCO2eq/kWh'),
        ent('sensor.b', 'gCO2/kWh'),
        ent('sensor.c', 'g/kWh'),
        ent('sensor.d', 'g CO2eq / kWh'),
        ent('sensor.e', 'GCO2EQ/KWH'),
      ),
    ).toEqual(['sensor.a', 'sensor.b', 'sensor.c', 'sensor.d', 'sensor.e']);
  });

  it('skips indoor CO2 and the fossil fuel percentage, whatever their id', () => {
    expect(
      carbon(
        ent('sensor.living_room_co2', 'ppm', 'carbon_dioxide'),
        ent('sensor.grid_fossil_fuel_percentage', '%'),
        ent('sensor.carbon_footprint', 'kg'),
        ent('sensor.co2_intensity_no_unit'),
      ),
    ).toEqual([]);
  });

  it('keeps carbon intensities out of the price picker', () => {
    expect(entitiesOfKind({ states: { 'sensor.c': ent('sensor.c', 'g/kWh') } }, 'price')).toEqual([]);
  });
});

describe('power picker', () => {
  const power = (...list: HassEntity[]) =>
    entitiesOfKind({ states: Object.fromEntries(list.map((e) => [e.entity_id, e])) }, 'power');

  it('accepts apparent power, the live reading of many Linky meters', () => {
    expect(power(ent('sensor.linky', 'VA', 'apparent_power'), ent('sensor.kva', 'kVA'))).toEqual([
      'sensor.kva',
      'sensor.linky',
    ]);
    expect(power(ent('sensor.no_unit', undefined, 'apparent_power'))).toEqual(['sensor.no_unit']);
  });

  it('accepts the lowercase w and kw units', () => {
    expect(power(ent('sensor.a', 'w'), ent('sensor.b', 'kw'))).toEqual(['sensor.a', 'sensor.b']);
  });
});

describe('money picker', () => {
  const money = (...units: string[]) =>
    entitiesOfKind(
      { states: Object.fromEntries(units.map((u, i) => [`sensor.m${i}`, ent(`sensor.m${i}`, u)])) },
      'money',
    ).length;

  it('accepts local currency symbols, possibly per hour', () => {
    expect(money('kr', 'zł', 'EUR/hour', 'kr/h', 'Fr.', 'EUR / h', '€/hour')).toBe(7);
  });

  it('still rejects what is not a currency', () => {
    expect(money('kWh', 'W', '%', '°C', 'kW', 'Wh', 'EUR/kWh', 'ppm1', '', 'kr per day', 'gCO2eq/kWh')).toBe(
      0,
    );
  });
});
