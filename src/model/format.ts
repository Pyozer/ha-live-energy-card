import { formatEnergy } from '../energy-today';
import type { BaseNodeConfig, EntityRef, HomeAssistant } from '../types';
import { entityIds, numberFormat } from '../units';
import type { NodeActions } from './types';

const NAME_SUFFIXES = [
  /\s+puissance$/i,
  /\s+power$/i,
  /\s+consommation actuelle$/i,
  /\s+current consumption$/i,
  /^puissance\s+/i,
];

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

/** Secondary line of a node: its `secondary_entity`, otherwise today's energy when known. */
export function nodeSecondary(
  hass: HomeAssistant,
  cfg: BaseNodeConfig | undefined,
  todayKwh: number | undefined,
): string | undefined {
  if (cfg?.secondary_entity) return formatSecondary(hass, cfg.secondary_entity);
  if (todayKwh === undefined) return undefined;
  return formatEnergy(todayKwh, hass.locale?.language ?? hass.language);
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
