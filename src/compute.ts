/**
 * Allocation of energy flows between sources (solar, grid, battery) and consumers
 * (home, battery, grid). All values are positive watts.
 *
 * Priorities:
 *  0. the part of the battery charge known to come from solar (`batterySolar`, deduced from what the
 *     battery says it draws from the grid) is taken from the solar first;
 *  1. the rest of the solar feeds the home, then the battery (if still charging), then the grid (surplus);
 *  2. a discharging battery feeds the home before the grid;
 *  3. the grid covers the remaining home demand, then the battery charge.
 */

export interface SourceInputs {
  /** Solar production (W). Ignored when not configured. */
  solar?: number;
  /**
   * Part of `batteryCharge` known to come from solar, when the battery reports what it draws from
   * the grid (panels on a hybrid battery, or the battery choosing to store a small surplus). It is
   * taken from the solar before the home. Unknown by default: solar then feeds the home first.
   */
  batterySolar?: number;
  gridImport?: number;
  gridExport?: number;
  batteryCharge?: number;
  batteryDischarge?: number;
  /** Measured home consumption. When missing, it is derived from the balance. */
  home?: number;
}

export interface Flows {
  solarToHome: number;
  solarToBattery: number;
  solarToGrid: number;
  gridToHome: number;
  gridToBattery: number;
  batteryToHome: number;
  batteryToGrid: number;
}

export interface FlowResult {
  flows: Flows;
  /** Home consumption (measured or computed). */
  home: number;
  homeMeasured: boolean;
  /** Normalized totals used for the computation. */
  solar: number;
  gridImport: number;
  gridExport: number;
  batteryCharge: number;
  batteryDischarge: number;
}

const pos = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) && v > 0 ? v : 0);

/** A positive power, or 0 below the threshold (noise of the sensors). */
export function thresholded(value: number | undefined, threshold = 0): number {
  const p = pos(value);
  return p < threshold ? 0 : p;
}

/** Splits a signed power into two positive components. */
export function splitSigned(value: number | undefined): { positive: number; negative: number } {
  if (value === undefined || !Number.isFinite(value)) return { positive: 0, negative: 0 };
  return value >= 0 ? { positive: value, negative: 0 } : { positive: 0, negative: -value };
}

export function computeFlows(inputs: SourceInputs, threshold = 0): FlowResult {
  const clean = (v: number | undefined): number => thresholded(v, threshold);

  const solar = clean(inputs.solar);
  let gridImport = clean(inputs.gridImport);
  let gridExport = clean(inputs.gridExport);
  let batteryCharge = clean(inputs.batteryCharge);
  let batteryDischarge = clean(inputs.batteryDischarge);

  // Both directions measured at once: keep only the net balance.
  if (gridImport > 0 && gridExport > 0) {
    const net = gridImport - gridExport;
    gridImport = Math.max(0, net);
    gridExport = Math.max(0, -net);
  }
  if (batteryCharge > 0 && batteryDischarge > 0) {
    const net = batteryDischarge - batteryCharge;
    batteryDischarge = Math.max(0, net);
    batteryCharge = Math.max(0, -net);
  }

  const homeMeasured = inputs.home !== undefined && Number.isFinite(inputs.home);
  const computedHome = solar + gridImport + batteryDischarge - gridExport - batteryCharge;
  const home = homeMeasured ? pos(inputs.home) : Math.max(0, computedHome);

  // 1. Solar: the battery charge known to be solar, then home → battery → grid.
  const knownSolarCharge = Math.min(clean(inputs.batterySolar), solar, batteryCharge);
  let solarLeft = solar - knownSolarCharge;
  const solarToHome = Math.min(solarLeft, home);
  solarLeft -= solarToHome;
  const otherSolarCharge = Math.min(solarLeft, batteryCharge - knownSolarCharge);
  const solarToBattery = knownSolarCharge + otherSolarCharge;
  solarLeft -= otherSolarCharge;
  const solarToGrid = Math.min(solarLeft, gridExport);

  // 2. Battery: home → grid.
  let homeLeft = home - solarToHome;
  let dischargeLeft = batteryDischarge;
  const batteryToHome = Math.min(dischargeLeft, homeLeft);
  dischargeLeft -= batteryToHome;
  homeLeft -= batteryToHome;
  const batteryToGrid = Math.min(dischargeLeft, Math.max(0, gridExport - solarToGrid));

  // 3. Grid: home → battery.
  let importLeft = gridImport;
  const gridToHome = Math.min(importLeft, Math.max(0, homeLeft));
  importLeft = Math.max(0, importLeft - gridToHome);
  const gridToBattery = Math.min(importLeft, Math.max(0, batteryCharge - solarToBattery));

  return {
    flows: {
      solarToHome,
      solarToBattery,
      solarToGrid,
      gridToHome,
      gridToBattery,
      batteryToHome,
      batteryToGrid,
    },
    home,
    homeMeasured,
    solar,
    gridImport,
    gridExport,
    batteryCharge,
    batteryDischarge,
  };
}

/** Power not attributed to tracked devices (never negative). */
export function untrackedPower(home: number, devices: number[]): number {
  const sum = devices.reduce((acc, v) => acc + pos(v), 0);
  return Math.max(0, home - sum);
}

export interface Ratios {
  /** Share of solar production consumed on site (%), `null` without production. */
  selfConsumption: number | null;
  /** Share of consumption covered without the grid (%), `null` without consumption. */
  autarky: number | null;
}

export function computeRatios(result: FlowResult): Ratios {
  const { flows, solar, home } = result;
  const selfConsumption =
    solar > 0 ? Math.min(100, ((flows.solarToHome + flows.solarToBattery) / solar) * 100) : null;
  const autarky = home > 0 ? Math.min(100, ((home - flows.gridToHome) / home) * 100) : null;
  return {
    selfConsumption: selfConsumption === null ? null : Math.max(0, selfConsumption),
    autarky: autarky === null ? null : Math.max(0, autarky),
  };
}
