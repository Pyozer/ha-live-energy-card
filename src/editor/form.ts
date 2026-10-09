import { compactRef } from '../entities';
import { DEFAULT_TOGGLES } from '../intensity';
import { DEFAULTS } from '../model';
import type { AnimationToggles, BaseNodeConfig, DeviceConfig, LiveEnergyCardConfig } from '../types';
import { entityIds } from '../units';
import { isGroup } from './device-list';

/**
 * Conversion between the card configuration and the `ha-form` data. The form shows resolved
 * defaults (so toggles reflect the actual behavior); the config only keeps what differs from them.
 */

export type NodeKey = 'solar' | 'grid' | 'battery' | 'home';
export const NODE_KEYS: readonly NodeKey[] = ['solar', 'grid', 'battery', 'home'];

/** Neutral values removed from the config to keep it readable. */
export function clean<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (value === undefined || value === null || value === '') delete out[key];
    else if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
      delete out[key];
  }
  return out as T;
}

/** Default of `hide_when_zero` for a node: the grid and the home stay visible at zero. */
export function hideDefault(kind: NodeKey | 'device', globalHide: boolean | undefined): boolean {
  if (kind === 'grid' || kind === 'home') return false;
  return globalHide ?? DEFAULTS.hide_when_zero;
}

export function toFormData(config: LiveEnergyCardConfig): Record<string, unknown> {
  const node = (kind: NodeKey) => {
    const cfg = (config[kind] ?? {}) as BaseNodeConfig;
    return {
      ...cfg,
      entity: entityIds(cfg.entity),
      energy_entity: entityIds(cfg.energy_entity),
      hide_when_zero: cfg.hide_when_zero ?? hideDefault(kind, config.hide_when_zero),
    };
  };
  return {
    ...DEFAULTS,
    ...config,
    solar: node('solar'),
    grid: node('grid'),
    battery: node('battery'),
    home: node('home'),
    animation: { ...DEFAULT_TOGGLES, ...(config.animation ?? {}) },
  };
}

/** Config from the form data. Devices are edited separately and kept from `previous`. */
export function fromFormData(
  data: Record<string, unknown>,
  previous: LiveEnergyCardConfig,
): LiveEnergyCardConfig {
  const next: Record<string, unknown> = { ...data, type: previous.type };

  // General options: only write what differs from the defaults.
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (next[key] === value) delete next[key];
  }
  const globalHide = data.hide_when_zero as boolean | undefined;

  for (const kind of NODE_KEYS) {
    const cfg = { ...((data[kind] as BaseNodeConfig) ?? {}) };
    cfg.entity = compactRef(cfg.entity);
    cfg.energy_entity = compactRef(cfg.energy_entity);
    // A value equal to the default is dropped, unless it was written explicitly before.
    const explicit = (previous[kind] as BaseNodeConfig | undefined)?.hide_when_zero !== undefined;
    if (cfg.hide_when_zero === hideDefault(kind, globalHide) && !explicit) delete cfg.hide_when_zero;
    if (cfg.invert === false) delete cfg.invert;
    const cleaned = clean(cfg);
    if (Object.keys(cleaned).length === 0) delete next[kind];
    else next[kind] = cleaned;
  }

  // Only effects that differ from their default are written (glow is off by default, the others
  // are on).
  const anim = (data.animation ?? {}) as AnimationToggles;
  const animOut: AnimationToggles = {};
  for (const k of Object.keys(DEFAULT_TOGGLES) as (keyof AnimationToggles)[]) {
    if (typeof anim[k] === 'boolean' && anim[k] !== DEFAULT_TOGGLES[k]) animOut[k] = anim[k];
  }
  if (Object.keys(animOut).length) next.animation = animOut;
  else delete next.animation;

  for (const key of ['cost', 'carbon'] as const) {
    const cleaned = clean((data[key] ?? {}) as Record<string, unknown>);
    if (Object.keys(cleaned).length) next[key] = cleaned;
    else delete next[key];
  }

  next.devices = previous.devices ?? [];
  return clean(next) as unknown as LiveEnergyCardConfig;
}

/** Form data of a device. A group's entity is shown as `group_entity`, which has its own label. */
export function deviceFormData(dev: DeviceConfig, globalHide: boolean | undefined): Record<string, unknown> {
  return {
    ...dev,
    [isGroup(dev) ? 'group_entity' : 'entity']: entityIds(dev.entity),
    energy_entity: entityIds(dev.energy_entity),
    hide_when_zero: dev.hide_when_zero ?? hideDefault('device', globalHide),
  };
}

/** Device config from its form data. A group keeps its members. */
export function deviceFromForm(
  data: Record<string, unknown>,
  previous: DeviceConfig | undefined,
  globalHide: boolean | undefined,
): DeviceConfig {
  const { group_entity, ...rest } = data as DeviceConfig & { group_entity?: unknown };
  const group = isGroup(previous);
  const value: DeviceConfig = { ...rest };
  value.entity = compactRef(group ? group_entity : rest.entity) ?? (group ? undefined : '');
  value.energy_entity = compactRef(rest.energy_entity);
  if (group) value.devices = previous?.devices ?? [];
  if (value.hide_when_zero === hideDefault('device', globalHide) && previous?.hide_when_zero === undefined)
    delete value.hide_when_zero;
  for (const key of ['invert', 'exclude_from_untracked', 'expanded'] as const) {
    if (value[key] === false) delete value[key];
  }
  return clean(value);
}
