import type { HassEntity } from './types';

const UNIT_FACTORS: Record<string, number> = {
  mW: 0.001,
  W: 1,
  kW: 1_000,
  MW: 1_000_000,
  GW: 1_000_000_000,
};

/** Facteur de conversion vers le watt. `MW` (méga) et `mW` (milli) sont distingués par la casse. */
export function unitFactor(unit: string | undefined): number {
  if (!unit) return 1;
  const trimmed = unit.trim();
  if (trimmed in UNIT_FACTORS) return UNIT_FACTORS[trimmed];
  const lower = trimmed.toLowerCase();
  if (lower === 'kw') return 1_000;
  if (lower === 'w') return 1;
  return 1;
}

export interface Reading {
  /** Puissance en W, `null` si l'entité est indisponible ou non numérique. */
  value: number | null;
  available: boolean;
}

export const UNAVAILABLE: Reading = { value: null, available: false };

/** Lit l'état d'une entité de puissance et le convertit en watts. */
export function readPower(entity: HassEntity | undefined, invert = false): Reading {
  if (!entity) return UNAVAILABLE;
  const raw = entity.state;
  if (raw === undefined || raw === null || raw === 'unavailable' || raw === 'unknown' || raw === '') {
    return UNAVAILABLE;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return UNAVAILABLE;
  const watts = num * unitFactor(entity.attributes?.unit_of_measurement);
  return { value: invert ? -watts : watts, available: true };
}

/** Lit un pourcentage (SOC batterie), borné entre 0 et 100. */
export function readPercent(entity: HassEntity | undefined): number | null {
  if (!entity) return null;
  const num = Number(entity.state);
  if (!Number.isFinite(num)) return null;
  return Math.min(100, Math.max(0, num));
}

export interface FormatOptions {
  locale?: string;
  kiloThreshold?: number;
  decimals?: number;
  kiloDecimals?: number;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function numberFormat(locale: string | undefined, decimals: number): Intl.NumberFormat {
  const key = `${locale ?? ''}|${decimals}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch {
      fmt = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    formatters.set(key, fmt);
  }
  return fmt;
}

/** Formate une puissance : `850 W`, `1,2 kW`, `3,4 MW`. */
export function formatPower(watts: number, opts: FormatOptions = {}): { value: string; unit: string } {
  const kilo = opts.kiloThreshold ?? 1000;
  const abs = Math.abs(watts);
  if (abs >= 1_000_000 && kilo <= 1_000_000) {
    return { value: numberFormat(opts.locale, opts.kiloDecimals ?? 1).format(watts / 1_000_000), unit: 'MW' };
  }
  if (abs >= kilo) {
    return { value: numberFormat(opts.locale, opts.kiloDecimals ?? 1).format(watts / 1000), unit: 'kW' };
  }
  const decimals = opts.decimals ?? 0;
  // Évite l'affichage « -0 W ».
  const rounded = Number(watts.toFixed(decimals));
  return { value: numberFormat(opts.locale, decimals).format(rounded === 0 ? 0 : rounded), unit: 'W' };
}
