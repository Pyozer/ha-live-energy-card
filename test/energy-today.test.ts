import { describe, expect, it, vi } from 'vitest';
import { energyStatistics, fetchToday, formatEnergy, todayByNode } from '../src/energy-today';
import type { HomeAssistant, LiveEnergyCardConfig } from '../src/types';

const config: LiveEnergyCardConfig = {
  type: 'x',
  solar: {
    units: [
      { entity: 'sensor.s1', energy_entity: 'sensor.pv1_kwh' },
      { entity: 'sensor.s2', energy_entity: 'sensor.pv2_kwh' },
    ],
  },
  grid: { entity: 'sensor.g', energy_entity: 'sensor.grid_kwh' },
  devices: [
    { entity: 'sensor.tv' },
    {
      name: 'IT',
      energy_entity: 'sensor.it_kwh',
      devices: [{ entity: 'sensor.nas', energy_entity: 'sensor.nas_kwh' }],
    },
  ],
};

describe('energyStatistics', () => {
  it('lists the energy counters of each node, by node id', () => {
    expect(Object.fromEntries(energyStatistics(config))).toEqual({
      solar: ['sensor.pv1_kwh', 'sensor.pv2_kwh'],
      grid: ['sensor.grid_kwh'],
      'device:1': ['sensor.it_kwh'],
      'device:1:0': ['sensor.nas_kwh'],
    });
  });
});

describe('energy statistics of units', () => {
  it('lists the counters of each unit, and the total of the node from them', () => {
    const stats = energyStatistics({
      type: 'x',
      solar: {
        separate: true,
        units: [
          { entity: 'sensor.a', energy_entity: 'sensor.a_kwh' },
          { entity: 'sensor.b', energy_entity: 'sensor.b_kwh' },
        ],
      },
    });
    expect(Object.fromEntries(stats)).toEqual({
      'solar:0': ['sensor.a_kwh'],
      'solar:1': ['sensor.b_kwh'],
      solar: ['sensor.a_kwh', 'sensor.b_kwh'],
    });
  });

  it('a single bubble only needs the total, not the counter of each unit', () => {
    const stats = energyStatistics({
      type: 'x',
      battery: {
        units: [
          { entity: 'sensor.a', energy_entity: 'sensor.a_kwh' },
          { entity: 'sensor.b', energy_entity: 'sensor.b_kwh' },
        ],
      },
    });
    expect([...stats.keys()]).toEqual(['battery']);
  });

  it('gives no total when a unit lacks its own counter', () => {
    const stats = energyStatistics({
      type: 'x',
      solar: {
        separate: true,
        units: [{ entity: 'sensor.a', energy_entity: 'sensor.a_kwh' }, { entity: 'sensor.b' }],
      },
    });
    expect([...stats.keys()]).toEqual(['solar:0']);
  });

  it('keeps the unit ids when a row in the list reads nothing', () => {
    const stats = energyStatistics({
      type: 'x',
      solar: {
        separate: true,
        units: [{}, { entity: 'sensor.b', energy_entity: 'sensor.b_kwh' }],
      },
    });
    expect(stats.get('solar:1')).toEqual(['sensor.b_kwh']);
  });
});

describe('grid export statistic', () => {
  it('is fetched for the daily cost', () => {
    const stats = energyStatistics({
      type: 'x',
      grid: { entity: 'sensor.g', export_energy_entity: ['sensor.out1', 'sensor.out2'] },
    });
    expect(stats.get('grid_export')).toEqual(['sensor.out1', 'sensor.out2']);
  });
});

describe('todayByNode', () => {
  it('adds up the counters of a node, and marks it unavailable when one is missing', () => {
    const stats = energyStatistics(config);
    const values = new Map([
      ['sensor.pv1_kwh', 3],
      ['sensor.pv2_kwh', 1.5],
      ['sensor.it_kwh', 0.4],
    ]);
    expect(Object.fromEntries(todayByNode(stats, values))).toEqual({
      solar: 4.5,
      grid: null,
      'device:1': 0.4,
      'device:1:0': null,
    });
  });
});

describe('fetchToday', () => {
  it("asks for today's change of each statistic once, in kWh", async () => {
    const callWS = vi.fn(async (msg: Record<string, unknown>) => {
      if (msg.statistic_id === 'sensor.broken') throw new Error('no statistics');
      return { change: msg.statistic_id === 'sensor.a' ? 2.5 : null };
    });
    const hass = { states: {}, callWS } as unknown as HomeAssistant;
    const values = await fetchToday(hass, ['sensor.a', 'sensor.a', 'sensor.b', 'sensor.broken']);
    expect([...values]).toEqual([['sensor.a', 2.5]]);
    expect(callWS).toHaveBeenCalledTimes(3);
    expect(callWS).toHaveBeenCalledWith({
      type: 'recorder/statistic_during_period',
      statistic_id: 'sensor.a',
      calendar: { period: 'day' },
      types: ['change'],
      units: { energy: 'kWh' },
    });
  });

  it('returns nothing without a websocket connection', async () => {
    expect((await fetchToday({ states: {} }, ['sensor.a'])).size).toBe(0);
    expect((await fetchToday(undefined, ['sensor.a'])).size).toBe(0);
  });
});

describe('formatEnergy', () => {
  it('uses fewer decimals as the value grows', () => {
    expect(formatEnergy(8.416, 'en')).toBe('8.42 kWh');
    expect(formatEnergy(12.44, 'en')).toBe('12.4 kWh');
    expect(formatEnergy(135.4, 'en')).toBe('135 kWh');
    expect(formatEnergy(8.416, 'fr')).toBe('8,42 kWh');
  });
});
