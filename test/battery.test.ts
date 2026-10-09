import { describe, expect, it } from 'vitest';
import { batteryEta, combinePacks, formatDuration } from '../src/battery';

describe('batteryEta', () => {
  it('estimates the time to full while charging', () => {
    // 10 kWh at 50 %: 5 kWh left to charge at 2 kW.
    expect(batteryEta(50, 2000, 0, 10)).toEqual({ until: 'full', hours: 2.5 });
  });

  it('estimates the time down to the reserve while discharging', () => {
    // 10 kWh at 60 % with a 10 % reserve: 5 kWh at 1 kW.
    expect(batteryEta(60, 0, 1000, 10, 10)).toEqual({ until: 'empty', hours: 5 });
    expect(batteryEta(5, 0, 1000, 10, 10)).toEqual({ until: 'empty', hours: 0 });
  });

  it('needs a charge level, a capacity and some power', () => {
    expect(batteryEta(undefined, 2000, 0, 10)).toBeNull();
    expect(batteryEta(null, 2000, 0, 10)).toBeNull();
    expect(batteryEta(50, 2000, 0, undefined)).toBeNull();
    expect(batteryEta(50, 2000, 0, 0)).toBeNull();
    expect(batteryEta(50, 0, 0, 10)).toBeNull();
  });

  it('hides estimates beyond 48 h and clamps an out-of-range charge level', () => {
    expect(batteryEta(50, 50, 0, 10)).toBeNull();
    expect(batteryEta(120, 1000, 0, 10)).toEqual({ until: 'full', hours: 0 });
  });
});

describe('combinePacks', () => {
  it('has no level without any sensor', () => {
    expect(combinePacks([])).toEqual({ soc: undefined });
    expect(combinePacks([{ soc: undefined, capacity: 10 }])).toEqual({ soc: undefined });
  });

  it('is unreadable as soon as one level is', () => {
    expect(combinePacks([{ soc: 50 }, { soc: null }])).toEqual({ soc: null });
  });

  it('averages the levels, weighted by the capacities when they are all known', () => {
    expect(combinePacks([{ soc: 80 }, { soc: 20 }]).soc).toBe(50);
    expect(combinePacks([{ soc: 80, capacity: 10 }, { soc: 20 }]).soc).toBe(50);
    expect(
      combinePacks([
        { soc: 80, capacity: 10 },
        { soc: 20, capacity: 5 },
      ]).soc,
    ).toBeCloseTo(60);
  });

  it('adds the capacities and weights the reserve, when every battery has a level and a capacity', () => {
    expect(
      combinePacks([
        { soc: 80, capacity: 10, min_soc: 10 },
        { soc: 20, capacity: 5, min_soc: 40 },
      ]),
    ).toEqual({ soc: expect.closeTo(60), capacity: 15, min_soc: 20 });
    expect(
      combinePacks([
        { soc: 80, capacity: 10 },
        { soc: 20, capacity: 5 },
      ]).min_soc,
    ).toBe(0);
  });

  it('gives no capacity, so no estimate, on part of the batteries', () => {
    const noCapacity = combinePacks([{ soc: 80, capacity: 10 }, { soc: 20 }]);
    expect(noCapacity.capacity).toBeUndefined();
    const noLevel = combinePacks([
      { soc: 80, capacity: 10 },
      { soc: undefined, capacity: 5 },
    ]);
    expect(noLevel).toEqual({ soc: 80 });
  });

  it('a single battery is itself', () => {
    expect(combinePacks([{ soc: 42, capacity: 8, min_soc: 5 }])).toEqual({
      soc: 42,
      capacity: 8,
      min_soc: 5,
    });
  });
});

describe('formatDuration', () => {
  it('uses minutes, then hours and minutes, then whole hours', () => {
    expect(formatDuration(0.75)).toBe('45 min');
    expect(formatDuration(2.08)).toBe('2 h 05');
    expect(formatDuration(3)).toBe('3 h');
    expect(formatDuration(10.6)).toBe('11 h');
    expect(formatDuration(0.999)).toBe('1 h');
  });
});
