import { describe, expect, it } from 'vitest';
import { resolveColor } from '../src/colors';
import { actionsFor, batteryIcon, cleanName, formatSecondary } from '../src/model/format';
import type { HassEntity, HomeAssistant } from '../src/types';

describe('resolveColor', () => {
  it('maps Home Assistant color names to their theme variable, with a fallback', () => {
    expect(resolveColor('amber', '#000')).toBe('var(--amber-color, #ffc107)');
    expect(resolveColor(' deep-orange ', '#000')).toBe('var(--deep-orange-color, #ff6f22)');
  });

  it('keeps theme colors as they are', () => {
    expect(resolveColor('primary', '#000')).toBe('var(--primary-color)');
  });

  it('passes CSS colors through and falls back when empty', () => {
    expect(resolveColor('#ffb300', '#000')).toBe('#ffb300');
    expect(resolveColor('rgb(1, 2, 3)', '#000')).toBe('rgb(1, 2, 3)');
    expect(resolveColor(undefined, 'var(--lec-solar)')).toBe('var(--lec-solar)');
    expect(resolveColor('', 'var(--lec-solar)')).toBe('var(--lec-solar)');
  });
});

describe('batteryIcon', () => {
  it('follows the charge level in steps of 10 %', () => {
    expect(batteryIcon(0, false)).toBe('mdi:battery-outline');
    expect(batteryIcon(44, false)).toBe('mdi:battery-40');
    expect(batteryIcon(96, false)).toBe('mdi:battery');
    expect(batteryIcon(3, true)).toBe('mdi:battery-charging-10');
    expect(batteryIcon(55, true)).toBe('mdi:battery-charging-60');
    expect(batteryIcon(100, true)).toBe('mdi:battery-charging-100');
  });

  it('has a neutral icon without a charge level', () => {
    expect(batteryIcon(undefined, false)).toBe('mdi:battery-high');
    expect(batteryIcon(null, true)).toBe('mdi:battery-charging');
  });
});

describe('cleanName', () => {
  it('removes power suffixes and prefixes', () => {
    expect(cleanName('Fridge Power', 'x')).toBe('Fridge');
    expect(cleanName('Puissance Chauffe-eau', 'x')).toBe('Chauffe-eau');
    expect(cleanName('TV consommation actuelle', 'x')).toBe('TV');
  });

  it('keeps the name when nothing would be left, and falls back without one', () => {
    expect(cleanName('Power', 'x')).toBe('Power');
    expect(cleanName(undefined, 'sensor.x')).toBe('sensor.x');
  });
});

describe('formatSecondary', () => {
  const st = (state: string, unit?: string): HassEntity => ({
    entity_id: 'sensor.s',
    state,
    attributes: unit ? { unit_of_measurement: unit } : {},
  });
  const hass = (s: HassEntity): HomeAssistant => ({ states: { [s.entity_id]: s }, language: 'en' });

  it('formats numbers with fewer decimals as they grow', () => {
    expect(formatSecondary(hass(st('3.456', 'kWh')), 'sensor.s')).toBe('3.46 kWh');
    expect(formatSecondary(hass(st('12.34', 'kWh')), 'sensor.s')).toBe('12.3 kWh');
    expect(formatSecondary(hass(st('1234.5', 'kWh')), 'sensor.s')).toBe('1,235 kWh');
    expect(formatSecondary(hass(st('7', 'kWh')), 'sensor.s')).toBe('7 kWh');
  });

  it('shows text states as they are, and a dash when unavailable', () => {
    expect(formatSecondary(hass(st('sunny')), 'sensor.s')).toBe('sunny');
    expect(formatSecondary(hass(st('unavailable', 'kWh')), 'sensor.s')).toBe('—');
  });

  it('shows nothing for a missing entity', () => {
    expect(formatSecondary(hass(st('1')), 'sensor.other')).toBeUndefined();
    expect(formatSecondary(hass(st('1')), undefined)).toBeUndefined();
  });
});

describe('actionsFor', () => {
  it('opens the more-info dialog of the first entity by default', () => {
    expect(actionsFor({}, ['sensor.a', 'sensor.b'])).toMatchObject({
      entity: 'sensor.a',
      tap_action: { action: 'more-info' },
    });
  });

  it('does nothing without an entity, and keeps configured actions', () => {
    expect(actionsFor({}, undefined).tap_action).toEqual({ action: 'none' });
    const nav = { action: 'navigate', navigation_path: '/energy' };
    expect(actionsFor({ tap_action: nav }, 'sensor.a').tap_action).toBe(nav);
  });
});
