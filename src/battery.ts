/**
 * Battery time estimate: time to full while charging, time to the reserve while discharging, at the
 * current power. Needs the charge level and the usable capacity.
 */

export interface BatteryEta {
  /** `full` while charging, `empty` (down to the reserve) while discharging. */
  until: 'full' | 'empty';
  hours: number;
}

/** Longer estimates are not shown: at such a low power, they mean little. */
export const MAX_ETA_HOURS = 48;

export function batteryEta(
  socPercent: number | null | undefined,
  chargeW: number,
  dischargeW: number,
  capacityKwh: number | undefined,
  minSocPercent = 0,
): BatteryEta | null {
  if (socPercent === null || socPercent === undefined || !capacityKwh || capacityKwh <= 0) return null;
  const soc = Math.min(100, Math.max(0, socPercent));
  let eta: BatteryEta;
  if (chargeW > 0) {
    eta = { until: 'full', hours: (((100 - soc) / 100) * capacityKwh * 1000) / chargeW };
  } else if (dischargeW > 0) {
    const left = Math.max(0, soc - Math.max(0, minSocPercent));
    eta = { until: 'empty', hours: ((left / 100) * capacityKwh * 1000) / dischargeW };
  } else {
    return null;
  }
  return eta.hours <= MAX_ETA_HOURS ? eta : null;
}

/** What a battery unit knows about its charge. `soc`: `undefined` without a sensor, `null` when unreadable. */
export interface BatteryPack {
  soc: number | null | undefined;
  /** Usable capacity (kWh). */
  capacity?: number;
  /** Reserve (%). */
  min_soc?: number;
}

/** Whether a battery is at or under its reserve. Without a reserve, or a readable level, it is not. */
export const belowReserve = (pack: BatteryPack): boolean =>
  pack.soc != null && (pack.min_soc ?? 0) > 0 && pack.soc <= pack.min_soc!;

/**
 * The charge of several batteries seen as one. The level is the average of the levels, weighted by
 * the capacities when they are all known. The capacity and the reserve (weighted by capacity) are
 * only known when every battery has a level and a capacity: a time estimate on part of them would
 * be wrong. An unreadable level makes the whole unreadable.
 */
export function combinePacks(packs: readonly BatteryPack[]): BatteryPack {
  const known = packs.filter((p) => p.soc !== undefined);
  if (known.length === 0) return { soc: undefined };
  if (known.some((p) => p.soc === null)) return { soc: null };
  const weighted = known.every((p) => (p.capacity ?? 0) > 0);
  const weight = (p: BatteryPack): number => (weighted ? p.capacity! : 1);
  const total = known.reduce((acc, p) => acc + weight(p), 0);
  const soc = known.reduce((acc, p) => acc + weight(p) * p.soc!, 0) / total;
  if (!weighted || known.length < packs.length) return { soc };
  const capacity = packs.reduce((acc, p) => acc + p.capacity!, 0);
  const reserve = packs.reduce((acc, p) => acc + p.capacity! * (p.min_soc ?? 0), 0) / capacity;
  return { soc, capacity, min_soc: reserve };
}

/** `45 min`, `2 h 05`, `11 h` (whole hours from 10 h). */
export function formatDuration(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 10 || m === 0) return `${Math.round(minutes / 60)} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}
