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

/** `45 min`, `2 h 05`, `11 h` (whole hours from 10 h). */
export function formatDuration(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 10 || m === 0) return `${Math.round(minutes / 60)} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}
