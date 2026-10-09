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
