import { describe, expect, it } from 'vitest';
import { computeFlows, computeRatios, splitSigned, untrackedPower } from '../src/compute';

const sumIn = (r: ReturnType<typeof computeFlows>) => r.solar + r.gridImport + r.batteryDischarge;
const sumOut = (r: ReturnType<typeof computeFlows>) => r.home + r.gridExport + r.batteryCharge;

describe('computeFlows', () => {
  it('without solar or battery: everything comes from the grid', () => {
    const r = computeFlows({ gridImport: 850 });
    expect(r.home).toBe(850);
    expect(r.flows.gridToHome).toBe(850);
    expect(r.flows.solarToHome).toBe(0);
  });

  it('solar surplus: self-consumption then export', () => {
    const r = computeFlows({ solar: 3000, gridExport: 2200 });
    expect(r.home).toBe(800);
    expect(r.flows.solarToHome).toBe(800);
    expect(r.flows.solarToGrid).toBe(2200);
    expect(r.flows.gridToHome).toBe(0);
  });

  it('insufficient solar: the grid fills the gap', () => {
    const r = computeFlows({ solar: 600, gridImport: 900 });
    expect(r.home).toBe(1500);
    expect(r.flows.solarToHome).toBe(600);
    expect(r.flows.gridToHome).toBe(900);
  });

  it('solar charges the battery before exporting', () => {
    const r = computeFlows({ solar: 4000, batteryCharge: 1500, gridExport: 1700 });
    expect(r.home).toBe(800);
    expect(r.flows.solarToHome).toBe(800);
    expect(r.flows.solarToBattery).toBe(1500);
    expect(r.flows.solarToGrid).toBe(1700);
  });

  it('battery charges from the grid at night', () => {
    const r = computeFlows({ gridImport: 2700, batteryCharge: 2500 });
    expect(r.home).toBe(200);
    expect(r.flows.gridToHome).toBe(200);
    expect(r.flows.gridToBattery).toBe(2500);
  });

  it('battery feeds the home then the grid', () => {
    const r = computeFlows({ batteryDischarge: 2800, gridExport: 2400 });
    expect(r.home).toBe(400);
    expect(r.flows.batteryToHome).toBe(400);
    expect(r.flows.batteryToGrid).toBe(2400);
  });

  it('measured consumption takes precedence', () => {
    const r = computeFlows({ solar: 1000, gridImport: 500, home: 1450 });
    expect(r.homeMeasured).toBe(true);
    expect(r.home).toBe(1450);
    expect(r.flows.solarToHome).toBe(1000);
    expect(r.flows.gridToHome).toBe(450);
  });

  it('unexpected negative values are clamped to zero', () => {
    const r = computeFlows({ solar: -12, gridImport: 300 });
    expect(r.solar).toBe(0);
    expect(r.home).toBe(300);
  });

  it('values below the threshold are zero', () => {
    const r = computeFlows({ solar: 3, gridImport: 400 }, 5);
    expect(r.solar).toBe(0);
    expect(r.flows.solarToHome).toBe(0);
  });

  it('simultaneous import and export: only the net balance is kept', () => {
    const r = computeFlows({ solar: 2000, gridImport: 100, gridExport: 900 });
    expect(r.gridImport).toBe(0);
    expect(r.gridExport).toBe(800);
  });

  it('energy is conserved in a full scenario', () => {
    const r = computeFlows({ solar: 2600, gridImport: 0, gridExport: 500, batteryCharge: 700 });
    expect(sumIn(r)).toBeCloseTo(sumOut(r));
    const f = r.flows;
    expect(f.solarToHome + f.solarToBattery + f.solarToGrid).toBeCloseTo(r.solar);
    expect(f.solarToHome + f.gridToHome + f.batteryToHome).toBeCloseTo(r.home);
  });

  it('no NaN with missing inputs', () => {
    const r = computeFlows({ solar: Number.NaN, gridImport: undefined });
    for (const v of Object.values(r.flows)) expect(Number.isFinite(v)).toBe(true);
    expect(r.home).toBe(0);
  });
});

describe('helpers', () => {
  it('splitSigned', () => {
    expect(splitSigned(500)).toEqual({ positive: 500, negative: 0 });
    expect(splitSigned(-200)).toEqual({ positive: 0, negative: 200 });
    expect(splitSigned(undefined)).toEqual({ positive: 0, negative: 0 });
  });

  it('untrackedPower is never negative', () => {
    expect(untrackedPower(1000, [300, 200])).toBe(500);
    expect(untrackedPower(400, [300, 200])).toBe(0);
  });

  it('computeRatios', () => {
    const r = computeFlows({ solar: 3000, gridExport: 2000 });
    const ratios = computeRatios(r);
    expect(ratios.selfConsumption).toBeCloseTo(33.33, 1);
    expect(ratios.autarky).toBe(100);
    expect(computeRatios(computeFlows({})).selfConsumption).toBeNull();
  });
});
