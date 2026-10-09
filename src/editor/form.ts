import { compactRef } from '../entities';
import { DEFAULT_TOGGLES } from '../intensity';
import { DEFAULTS } from '../model';
import type {
  AnimationToggles,
  BaseNodeConfig,
  CostConfig,
  DeviceConfig,
  LiveEnergyCardConfig,
} from '../types';
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

/** Where a price comes from. Not stored in the config: it is derived from which field is set. */
export type PriceMode = 'none' | 'fixed' | 'entity';
export const PRICE_KEYS = ['price', 'export_price'] as const;
export type PriceKey = (typeof PRICE_KEYS)[number];
/** Source chosen in the editor for prices that have no value yet. */
export type PriceModes = Partial<Record<PriceKey, PriceMode>>;

/**
 * Source of a price. A set field wins (the entity first, like the card); `chosen` only applies while
 * the price has no value yet, so the matching field can be shown empty.
 */
export function priceMode(cost: CostConfig | undefined, key: PriceKey, chosen?: PriceMode): PriceMode {
  if (cost?.[`${key}_entity`]) return 'entity';
  if (typeof cost?.[key] === 'number') return 'fixed';
  return chosen ?? 'none';
}

/** Default of `hide_when_zero` for a node: the grid and the home stay visible at zero. */
export function hideDefault(kind: NodeKey | 'device', globalHide: boolean | undefined): boolean {
  if (kind === 'grid' || kind === 'home') return false;
  return globalHide ?? DEFAULTS.hide_when_zero;
}

export function toFormData(config: LiveEnergyCardConfig, modes: PriceModes = {}): Record<string, unknown> {
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
    cost: {
      ...config.cost,
      price_mode: priceMode(config.cost, 'price', modes.price),
      export_price_mode: priceMode(config.cost, 'export_price', modes.export_price),
    },
  };
}

/** Price sources chosen in the form data. */
export function priceModesOf(data: Record<string, unknown>): PriceModes {
  const cost = (data.cost ?? {}) as Record<string, unknown>;
  const out: PriceModes = {};
  for (const key of PRICE_KEYS) {
    const mode = cost[`${key}_mode`];
    if (mode === 'none' || mode === 'fixed' || mode === 'entity') out[key] = mode;
  }
  return out;
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

  // A price keeps only the field of its chosen source (the other one would be ignored).
  const cost = { ...((data.cost ?? {}) as Record<string, unknown>) };
  for (const key of PRICE_KEYS) {
    const mode = cost[`${key}_mode`];
    delete cost[`${key}_mode`];
    if (mode === undefined) continue;
    if (mode !== 'fixed') delete cost[key];
    if (mode !== 'entity') delete cost[`${key}_entity`];
  }
  next.cost = cost;

  for (const key of ['cost', 'carbon'] as const) {
    const cleaned = clean((next[key] ?? {}) as Record<string, unknown>);
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
