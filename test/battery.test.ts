import { describe, expect, it } from 'vitest';
import { batteryEta, formatDuration } from '../src/battery';

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

describe('formatDuration', () => {
  it('uses minutes, then hours and minutes, then whole hours', () => {
    expect(formatDuration(0.75)).toBe('45 min');
    expect(formatDuration(2.08)).toBe('2 h 05');
    expect(formatDuration(3)).toBe('3 h');
    expect(formatDuration(10.6)).toBe('11 h');
    expect(formatDuration(0.999)).toBe('1 h');
  });
});
