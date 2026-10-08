/**
 * Répartition des flux d'énergie entre sources (solaire, réseau, batterie) et consommateurs
 * (maison, batterie, réseau). Toutes les valeurs sont en watts et positives.
 *
 * Priorités appliquées :
 *  1. le solaire alimente d'abord la maison, puis la batterie (si elle charge), puis le réseau (surplus) ;
 *  2. la batterie qui se décharge alimente la maison avant le réseau ;
 *  3. le réseau complète le besoin restant de la maison, puis la charge de la batterie.
 */

export interface SourceInputs {
  /** Production solaire (W). Ignorée si non configurée. */
  solar?: number;
  gridImport?: number;
  gridExport?: number;
  batteryCharge?: number;
  batteryDischarge?: number;
  /** Consommation mesurée de la maison. Si absente, elle est déduite du bilan. */
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
  /** Consommation de la maison (mesurée ou calculée). */
  home: number;
  homeMeasured: boolean;
  /** Totaux normalisés utilisés pour le calcul. */
  solar: number;
  gridImport: number;
  gridExport: number;
  batteryCharge: number;
  batteryDischarge: number;
}

const pos = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) && v > 0 ? v : 0);

/** Sépare une puissance signée en deux composantes positives. */
export function splitSigned(value: number | undefined): { positive: number; negative: number } {
  if (value === undefined || !Number.isFinite(value)) return { positive: 0, negative: 0 };
  return value >= 0 ? { positive: value, negative: 0 } : { positive: 0, negative: -value };
}

export function computeFlows(inputs: SourceInputs, threshold = 0): FlowResult {
  const clean = (v: number | undefined): number => {
    const p = pos(v);
    return p < threshold ? 0 : p;
  };

  const solar = clean(inputs.solar);
  let gridImport = clean(inputs.gridImport);
  let gridExport = clean(inputs.gridExport);
  let batteryCharge = clean(inputs.batteryCharge);
  let batteryDischarge = clean(inputs.batteryDischarge);

  // Mesures simultanées dans les deux sens : on ne garde que le solde net.
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

  // 1. Solaire : maison → batterie → réseau.
  let solarLeft = solar;
  const solarToHome = Math.min(solarLeft, home);
  solarLeft -= solarToHome;
  const solarToBattery = Math.min(solarLeft, batteryCharge);
  solarLeft -= solarToBattery;
  const solarToGrid = Math.min(solarLeft, gridExport);

  // 2. Batterie : maison → réseau.
  let homeLeft = home - solarToHome;
  let dischargeLeft = batteryDischarge;
  const batteryToHome = Math.min(dischargeLeft, homeLeft);
  dischargeLeft -= batteryToHome;
  homeLeft -= batteryToHome;
  const batteryToGrid = Math.min(dischargeLeft, Math.max(0, gridExport - solarToGrid));

  // 3. Réseau : maison → batterie.
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

/** Puissance non attribuée aux appareils suivis (jamais négative). */
export function untrackedPower(home: number, devices: number[]): number {
  const sum = devices.reduce((acc, v) => acc + pos(v), 0);
  return Math.max(0, home - sum);
}

export interface Ratios {
  /** Part de la production solaire consommée sur place (%), `null` sans production. */
  selfConsumption: number | null;
  /** Part de la consommation couverte sans le réseau (%), `null` sans consommation. */
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
