import { describe, expect, it } from 'vitest';
import { ECO_FPS, frameDue } from '../src/animator';
import { flowToggles } from '../src/model';
import { DEFAULT_TOGGLES, flowVisual, normalizePower, resolveToggles } from '../src/intensity';
import { formatPower, readPower, unitFactor } from '../src/units';
import type { HassEntity } from '../src/types';

const entity = (state: string, unit?: string): HassEntity => ({
  entity_id: 'sensor.x',
  state,
  attributes: unit ? { unit_of_measurement: unit } : {},
});

describe('units', () => {
  it('converts W, kW, MW and mW', () => {
    expect(unitFactor('W')).toBe(1);
    expect(unitFactor('kW')).toBe(1000);
    expect(unitFactor('MW')).toBe(1_000_000);
    expect(unitFactor('mW')).toBe(0.001);
    expect(readPower(entity('1.5', 'kW')).value).toBe(1500);
  });

  it('handles unavailable entities', () => {
    expect(readPower(entity('unavailable', 'W'))).toEqual({ value: null, available: false });
    expect(readPower(entity('unknown'))).toEqual({ value: null, available: false });
    expect(readPower(entity('abc')).available).toBe(false);
    expect(readPower(undefined).available).toBe(false);
  });

  it('inverts the sign', () => {
    expect(readPower(entity('250', 'W'), true).value).toBe(-250);
  });

  it('formats in W then kW', () => {
    expect(formatPower(850, { locale: 'fr' })).toEqual({ value: '850', unit: 'W' });
    expect(formatPower(1234, { locale: 'fr' })).toEqual({ value: '1,2', unit: 'kW' });
    expect(formatPower(1234, { locale: 'en' })).toEqual({ value: '1.2', unit: 'kW' });
    expect(formatPower(-0.2, { locale: 'fr' }).value).toBe('0');
  });
});

describe('intensity', () => {
  it('normalizes according to the curve', () => {
    expect(normalizePower(0, 0, 4000, 'linear')).toBe(0);
    expect(normalizePower(4000, 0, 4000, 'linear')).toBe(1);
    expect(normalizePower(9000, 0, 4000, 'sqrt')).toBe(1);
    // Small values stay visible with the sqrt and log curves.
    expect(normalizePower(100, 0, 4000, 'sqrt')).toBeGreaterThan(normalizePower(100, 0, 4000, 'linear'));
    expect(normalizePower(100, 0, 4000, 'log')).toBeGreaterThan(normalizePower(100, 0, 4000, 'sqrt'));
  });

  it('each effect is independent', () => {
    const all = flowVisual(1, DEFAULT_TOGGLES);
    const low = flowVisual(0.05, DEFAULT_TOGGLES);
    expect(all.speed).toBeGreaterThan(low.speed);
    expect(all.width).toBeGreaterThan(low.width);
    expect(all.gap).toBeLessThan(low.gap);

    const noSpeed = resolveToggles({ speed: false });
    expect(flowVisual(1, noSpeed).speed).toBe(flowVisual(0.05, noSpeed).speed);
    expect(flowVisual(1, noSpeed).width).toBeGreaterThan(flowVisual(0.05, noSpeed).width);

    const noThickness = resolveToggles({ thickness: false });
    expect(flowVisual(1, noThickness).width).toBe(flowVisual(0, noThickness).width);
  });

  it('glow is off by default', () => {
    expect(flowVisual(1, DEFAULT_TOGGLES).glow).toBe(0);
    expect(flowVisual(1, resolveToggles({ glow: true })).glow).toBeGreaterThan(0);
  });

  it('per-node override', () => {
    expect(resolveToggles({ density: false }, { density: true }).density).toBe(true);
    expect(resolveToggles(undefined, { glow: true }).glow).toBe(true);
  });
});

describe('eco mode', () => {
  it('frameDue caps the frame rate', () => {
    expect(frameDue(1000, 0, ECO_FPS)).toBe(true);
    expect(frameDue(1016.7, 1000, ECO_FPS)).toBe(false);
    expect(frameDue(1033.3, 1000, ECO_FPS)).toBe(true);
    // No cap: every frame is drawn.
    expect(frameDue(1016.7, 1000, 0)).toBe(true);
  });

  it('turns the glow off', () => {
    const config = { type: 'x', animation: { glow: true } };
    expect(flowToggles(config).glow).toBe(true);
    expect(flowToggles({ ...config, eco_mode: true }).glow).toBe(false);
    expect(flowToggles({ ...config, eco_mode: true }).speed).toBe(true);
  });
});
