import { describe, expect, it, vi } from 'vitest';
import { energyStatistics, fetchToday, formatEnergy, todayByNode } from '../src/energy-today';
import type { HomeAssistant, LiveEnergyCardConfig } from '../src/types';

const config: LiveEnergyCardConfig = {
  type: 'x',
  solar: { entity: 'sensor.s', energy_entity: ['sensor.pv1_kwh', 'sensor.pv2_kwh'] },
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
    expect([...energyStatistics(config)]).toEqual([
      ['solar', ['sensor.pv1_kwh', 'sensor.pv2_kwh']],
      ['grid', ['sensor.grid_kwh']],
      ['device:1', ['sensor.it_kwh']],
      ['device:1:0', ['sensor.nas_kwh']],
    ]);
  });
});

describe('todayByNode', () => {
  it('adds up the counters of a node, and leaves it out when one is missing', () => {
    const stats = energyStatistics(config);
    const values = new Map([
      ['sensor.pv1_kwh', 3],
      ['sensor.pv2_kwh', 1.5],
      ['sensor.it_kwh', 0.4],
    ]);
    expect([...todayByNode(stats, values)]).toEqual([
      ['solar', 4.5],
      ['device:1', 0.4],
    ]);
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
