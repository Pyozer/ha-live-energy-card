import type { DeviceConfig, EntityRef, HomeAssistant, LiveEnergyCardConfig } from './types';
import { entityIds, numberFormat } from './units';

/**
 * Today's energy per node, from Home Assistant long-term statistics: the change since midnight of
 * each `energy_entity` (cumulative kWh counters, the ones used by the Energy dashboard).
 */

/** Refresh period. Statistics are compiled every 5 minutes by Home Assistant. */
export const TODAY_REFRESH_MS = 5 * 60 * 1000;

/** Statistic ids next to the node ids: grid export, and the ready-made cost and earnings entities. */
export const EXPORT_STATISTIC = 'grid_export';
export const COST_STATISTIC = 'cost';
export const EARNINGS_STATISTIC = 'earnings';

/** Energy statistics of each node, by node id (`solar`, `device:2`, `device:2:0`…). */
export function energyStatistics(config: LiveEnergyCardConfig): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string, ref: EntityRef | undefined) => {
    const ids = entityIds(ref);
    if (ids.length) out.set(id, ids);
  };
  for (const key of ['solar', 'grid', 'battery', 'home'] as const) add(key, config[key]?.energy_entity);
  // Energy sent to the grid: only used by the daily cost.
  add(EXPORT_STATISTIC, config.grid?.export_energy_entity);
  // Ready-made cost entities: today's change in daily mode (in hourly mode, their state is used).
  if (config.cost?.period === 'day') {
    add(COST_STATISTIC, config.cost.cost_entity);
    add(EARNINGS_STATISTIC, config.cost.earnings_entity);
  }
  (config.devices ?? []).forEach((dev: DeviceConfig, i) => {
    add(`device:${i}`, dev?.energy_entity);
    (dev?.devices ?? []).forEach((m, j) => add(`device:${i}:${j}`, m?.energy_entity));
  });
  return out;
}

/** Sum per node; `null` when one of its statistics is missing (shown as `—`). */
export function todayByNode(
  statistics: Map<string, string[]>,
  values: ReadonlyMap<string, number>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const [node, ids] of statistics) {
    out.set(
      node,
      ids.every((id) => values.has(id)) ? ids.reduce((acc, id) => acc + values.get(id)!, 0) : null,
    );
  }
  return out;
}

interface StatisticDuringPeriod {
  change?: number | null;
}

/** Today's change of each statistic, in kWh. Statistics that fail to load are left out. */
export async function fetchToday(
  hass: HomeAssistant | undefined,
  ids: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!hass?.callWS) return out;
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      try {
        const res = await hass.callWS!<StatisticDuringPeriod>({
          type: 'recorder/statistic_during_period',
          statistic_id: id,
          calendar: { period: 'day' },
          types: ['change'],
          units: { energy: 'kWh' },
        });
        if (typeof res?.change === 'number' && Number.isFinite(res.change)) out.set(id, res.change);
      } catch {
        // No statistics for this entity (not a counter, or not recorded): nothing to show.
      }
    }),
  );
  return out;
}

/** `8.42 kWh`, `12.4 kWh`, `135 kWh`. */
export function formatEnergy(kwh: number, locale?: string): string {
  const abs = Math.abs(kwh);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${numberFormat(locale, decimals).format(kwh)} kWh`;
}
