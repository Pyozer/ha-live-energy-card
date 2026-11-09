import type { EntityRef, HassEntity } from './types';

export const POWER_UNITS: Record<string, number> = {
  mW: 0.001,
  W: 1,
  kW: 1_000,
  MW: 1_000_000,
  GW: 1_000_000_000,
  // Peak power of the panels (Wc, or Wp), read by the `peak_power_entity` of a solar unit.
  Wc: 1,
  Wp: 1,
  kWc: 1_000,
  kWp: 1_000,
};

/** Conversion factor to watts. `MW` (mega) and `mW` (milli) only differ by case. */
export function unitFactor(unit: string | undefined): number {
  if (!unit) return 1;
  const trimmed = unit.trim();
  if (trimmed in POWER_UNITS) return POWER_UNITS[trimmed];
  const lower = trimmed.toLowerCase();
  if (lower === 'kw') return 1_000;
  if (lower === 'w') return 1;
  return 1;
}

export interface Reading {
  /** Power in W, `null` when the entity is unavailable or not numeric. */
  value: number | null;
  available: boolean;
}

export const UNAVAILABLE: Reading = { value: null, available: false };

/** Reads a power entity state and converts it to watts. */
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

/** Entity ids of a reference, without empty values. */
export function entityIds(ref: EntityRef | undefined | null): string[] {
  if (!ref) return [];
  return (Array.isArray(ref) ? ref : [ref]).filter((id): id is string => typeof id === 'string' && !!id);
}

/**
 * Sum of the powers of several entities. Unavailable as soon as one of them is: a partial total
 * (one phase or one inverter missing) would be misleading.
 */
export function readPowerSum(
  states: Record<string, HassEntity>,
  ref: EntityRef | undefined,
  invert = false,
): Reading {
  const ids = entityIds(ref);
  if (ids.length === 0) return UNAVAILABLE;
  let total = 0;
  for (const id of ids) {
    const r = readPower(states[id], invert);
    if (!r.available || r.value === null) return UNAVAILABLE;
    total += r.value;
  }
  return { value: total, available: true };
}

/** Average of several percentages (charge level of several batteries). */
export function readPercentAverage(
  states: Record<string, HassEntity>,
  ref: EntityRef | undefined,
): number | null {
  const values = entityIds(ref).map((id) => readPercent(states[id]));
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0) / values.length;
}

/** Reads a percentage (battery SOC), clamped between 0 and 100. */
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

/** Formats a power: `850 W`, `1.2 kW`, `3.4 MW`. */
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
  // Avoids displaying "-0 W".
  const rounded = Number(watts.toFixed(decimals));
  return { value: numberFormat(opts.locale, decimals).format(rounded === 0 ? 0 : rounded), unit: 'W' };
}
