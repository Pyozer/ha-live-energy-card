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

  describe('battery charge known to come from solar (batterySolar)', () => {
    it('charges the battery before feeding the home, so the grid does not charge it', () => {
      // Micro-inverter (37 W) feeds the home; the battery charges from its own panels (44 W), 0 W from the grid.
      const r = computeFlows({ solar: 81, batterySolar: 44, batteryCharge: 44, home: 175, gridImport: 138 });
      expect(r.flows.solarToBattery).toBe(44);
      expect(r.flows.solarToHome).toBe(37);
      expect(r.flows.gridToBattery).toBe(0);
      expect(r.flows.gridToHome).toBe(138);
    });

    it('without the information, the same readings show a grid charge (home first)', () => {
      const r = computeFlows({ solar: 81, batteryCharge: 44, home: 175, gridImport: 138 });
      expect(r.flows.solarToBattery).toBe(0);
      expect(r.flows.gridToBattery).toBe(44);
    });

    it('solar beyond the known charge goes to the home', () => {
      const r = computeFlows({
        solar: 300,
        batterySolar: 300,
        batteryCharge: 100,
        home: 500,
        gridImport: 300,
      });
      expect(r.flows.solarToBattery).toBe(100);
      expect(r.flows.solarToHome).toBe(200);
      expect(r.flows.gridToHome).toBe(300);
    });

    it('the other solar and the grid complete the charge, in that order', () => {
      const r = computeFlows({
        solar: 1000,
        batterySolar: 400,
        batteryCharge: 1000,
        home: 300,
        gridImport: 300,
      });
      // 400 W known to come from solar; the other 600 W feed the home (300) then the battery (300).
      expect(r.flows.solarToBattery).toBe(700);
      expect(r.flows.solarToHome).toBe(300);
      expect(r.flows.gridToBattery).toBe(300);
      expect(r.flows.gridToHome).toBe(0);
    });

    it('a solar surplus still charges the battery, then goes to the grid', () => {
      // Plain surplus (battery on the AC side, no option): home → battery → grid.
      const ac = computeFlows({ solar: 1000, batteryCharge: 500, gridExport: 200, home: 300 });
      expect(ac.flows.solarToHome).toBe(300);
      expect(ac.flows.solarToBattery).toBe(500);
      expect(ac.flows.solarToGrid).toBe(200);
      expect(ac.flows.gridToBattery).toBe(0);
      // With 300 W of the charge known to be solar, the surplus completes the charge the same way.
      const dc = computeFlows({
        solar: 1200,
        batterySolar: 300,
        batteryCharge: 700,
        gridExport: 200,
        home: 300,
      });
      expect(dc.flows.solarToHome).toBe(300);
      expect(dc.flows.solarToBattery).toBe(700);
      expect(dc.flows.solarToGrid).toBe(200);
      expect(dc.flows.gridToBattery).toBe(0);
    });

    it('does nothing while the battery is not charging', () => {
      const r = computeFlows({ solar: 500, batterySolar: 200, batteryDischarge: 100, home: 600 });
      expect(r.flows.solarToHome).toBe(500);
      expect(r.flows.solarToBattery).toBe(0);
      expect(r.flows.batteryToHome).toBe(100);
    });

    it('is capped by the production and the charge, and ignores noise and negative values', () => {
      expect(
        computeFlows({ solar: 50, batterySolar: 400, batteryCharge: 300, home: 200 }).flows.solarToBattery,
      ).toBe(50);
      expect(
        computeFlows({ solar: 50, batterySolar: -20, batteryCharge: 30, home: 200 }).flows.solarToBattery,
      ).toBe(0);
      expect(
        computeFlows({ solar: 50, batterySolar: 3, batteryCharge: 30, home: 200 }, 5).flows.solarToBattery,
      ).toBe(0);
    });

    it('conserves energy', () => {
      const r = computeFlows({
        solar: 900,
        batterySolar: 600,
        batteryCharge: 700,
        gridExport: 0,
        gridImport: 400,
        home: 600,
      });
      const f = r.flows;
      expect(f.solarToHome + f.batteryToHome + f.gridToHome).toBeCloseTo(r.home);
      expect(f.solarToBattery + f.gridToBattery).toBeCloseTo(r.batteryCharge);
      expect(f.solarToHome + f.solarToBattery + f.solarToGrid).toBeCloseTo(r.solar);
    });
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
