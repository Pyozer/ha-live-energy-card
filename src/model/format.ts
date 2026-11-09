import { formatEnergy } from '../energy-today';
import type { BaseNodeConfig, EntityRef, GridConfig, HomeAssistant } from '../types';
import { entityIds, numberFormat } from '../units';
import type { NodeActions, NodeModel } from './types';

const NAME_SUFFIXES = [
  /\s+puissance$/i,
  /\s+power$/i,
  /\s+consommation actuelle$/i,
  /\s+current consumption$/i,
  /^puissance\s+/i,
];

/**
 * Fill (0 to 100) of the ring around a bubble: the charge of a battery, or the share of its peak
 * power a solar source produces. `null` when unavailable, `undefined` when the bubble has no ring.
 */
export function ringValue(node: Pick<NodeModel, 'kind' | 'soc' | 'peakRatio'>): number | null | undefined {
  if (node.kind === 'battery') return node.soc;
  if (node.kind === 'solar') return node.peakRatio == null ? node.peakRatio : node.peakRatio * 100;
  return undefined;
}

/** Readable entity name, without suffixes such as "Power". */
export function cleanName(friendly: string | undefined, fallback: string): string {
  if (!friendly) return fallback;
  let name = friendly.trim();
  for (const re of NAME_SUFFIXES) name = name.replace(re, '');
  return name || friendly;
}

/** State of the secondary entity with its unit, `—` when unavailable. */
export function formatSecondary(hass: HomeAssistant, entityId: string | undefined): string | undefined {
  if (!entityId) return undefined;
  const st = hass.states[entityId];
  if (!st) return undefined;
  if (st.state === 'unavailable' || st.state === 'unknown') return '—';
  const unit = st.attributes.unit_of_measurement ?? '';
  const num = Number(st.state);
  const locale = hass.locale?.language ?? hass.language;
  const value = Number.isFinite(num)
    ? numberFormat(
        locale,
        Math.abs(num) >= 100 || Number.isInteger(num) ? 0 : Math.abs(num) >= 10 ? 1 : 2,
      ).format(num)
    : st.state;
  return unit ? `${value} ${unit}` : value;
}

/**
 * Secondary line of a node: its `secondary_entity`, otherwise today's energy. `undefined` today's
 * energy means nothing to show (no counter, or not loaded yet), `null` means the statistics of the
 * counter are unavailable.
 */
export function nodeSecondary(
  hass: HomeAssistant,
  cfg: BaseNodeConfig | undefined,
  todayKwh: number | null | undefined,
): string | undefined {
  if (cfg?.secondary_entity) return formatSecondary(hass, cfg.secondary_entity);
  if (todayKwh === undefined) return undefined;
  if (todayKwh === null) return '—';
  return formatEnergy(todayKwh, hass.locale?.language ?? hass.language);
}

/**
 * Secondary line of the grid. With an export counter, both directions are shown, the energy bought
 * (↓) and sent back (↑), sharing the unit: `↓6.88 ↑0.99 kWh`. Without one, it is the energy of the
 * day alone, as for the other nodes. The custom line still replaces everything.
 */
export function gridSecondary(
  hass: HomeAssistant,
  cfg: GridConfig | undefined,
  importedKwh: number | null | undefined,
  exportedKwh: number | null | undefined,
): string | undefined {
  if (cfg?.secondary_entity || !entityIds(cfg?.export_energy_entity).length)
    return nodeSecondary(hass, cfg, importedKwh);
  const locale = hass.locale?.language ?? hass.language;
  const parts: string[] = [];
  for (const [arrow, kwh] of [
    ['↓', entityIds(cfg?.energy_entity).length ? importedKwh : undefined],
    ['↑', exportedKwh],
  ] as const) {
    if (kwh === undefined) continue;
    parts.push(`${arrow}${kwh === null ? '—' : formatEnergy(kwh, locale)}`);
  }
  if (!parts.length) return undefined;
  if (parts.length === 1) return parts[0];
  // One unit for both values, at the end (a dash has none).
  return parts[1].endsWith(' kWh')
    ? `${parts[0].replace(/ kWh$/, '')} ${parts[1]}`
    : `${parts[0]} ${parts[1]}`;
}

/** Default action: more-info of the node's (first) entity. */
export function actionsFor(cfg: BaseNodeConfig | undefined, ref: EntityRef | undefined): NodeActions {
  const entity = entityIds(ref)[0];
  return {
    entity,
    tap_action: cfg?.tap_action ?? (entity ? { action: 'more-info' } : { action: 'none' }),
    hold_action: cfg?.hold_action,
    double_tap_action: cfg?.double_tap_action,
  };
}

export function batteryIcon(soc: number | null | undefined, charging: boolean): string {
  if (soc === null || soc === undefined) return charging ? 'mdi:battery-charging' : 'mdi:battery-high';
  const level = Math.round(soc / 10) * 10;
  if (charging)
    return level >= 100 ? 'mdi:battery-charging-100' : `mdi:battery-charging-${Math.max(10, level)}`;
  if (level >= 100) return 'mdi:battery';
  if (level <= 0) return 'mdi:battery-outline';
  return `mdi:battery-${level}`;
}
