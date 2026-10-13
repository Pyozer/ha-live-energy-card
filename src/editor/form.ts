import { compactRef } from '../entities';
import { DEFAULT_TOGGLES } from '../intensity';
import { DEFAULTS } from '../model';
import type { UnitGroup } from '../source-units';
import type {
  AnimationToggles,
  BaseNodeConfig,
  BatteryUnitConfig,
  CostConfig,
  DeviceConfig,
  GridConfig,
  LiveEnergyCardConfig,
  SolarConfig,
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

/**
 * Where a price comes from. Not stored in the config: it is derived from which field is set.
 * `cost` / `earnings` is a ready-made amount (entity of the import cost, or of the export earnings).
 */
export type PriceMode = 'none' | 'fixed' | 'entity' | 'cost' | 'earnings';
export const PRICE_KEYS = ['price', 'export_price'] as const;
export type PriceKey = (typeof PRICE_KEYS)[number];

/** Config fields of each price, by source. */
export const PRICE_FIELDS = {
  price: { entity: 'price_entity', ready: 'cost_entity', readyMode: 'cost' },
  export_price: { entity: 'export_price_entity', ready: 'earnings_entity', readyMode: 'earnings' },
} as const;
/** Where the solar savings come from: computed from the import price, or a ready-made entity. */
export type SavingsMode = 'calculated' | 'savings';
/** Source chosen in the editor for prices (and savings) that have no value yet. */
export type PriceModes = Partial<Record<PriceKey, PriceMode>> & { savings?: SavingsMode };

/**
 * Source of a price. A set field wins, ready-made amount first, then the price entity, like the
 * card; `chosen` only applies while the price has no value yet, so the matching field can be shown
 * empty.
 */
export function priceMode(cost: CostConfig | undefined, key: PriceKey, chosen?: PriceMode): PriceMode {
  const fields = PRICE_FIELDS[key];
  if (cost?.[fields.ready]) return fields.readyMode;
  if (cost?.[fields.entity]) return 'entity';
  if (typeof cost?.[key] === 'number') return 'fixed';
  return chosen ?? 'none';
}

/** Source of the solar savings: the entity when set; `chosen` only applies while it is empty. */
export function savingsMode(cost: CostConfig | undefined, chosen?: SavingsMode): SavingsMode {
  return cost?.savings_entity ? 'savings' : (chosen ?? 'calculated');
}

/** Default of `hide_when_zero` for a node: the grid and the home stay visible at zero. */
export function hideDefault(kind: NodeKey | 'device', globalHide: boolean | undefined): boolean {
  if (kind === 'grid' || kind === 'home') return false;
  return globalHide ?? DEFAULTS.hide_when_zero;
}

export const isUnitGroup = (kind: NodeKey): kind is UnitGroup => kind === 'solar' || kind === 'battery';

export function toFormData(config: LiveEnergyCardConfig, modes: PriceModes = {}): Record<string, unknown> {
  const node = (kind: NodeKey) => {
    const cfg = { ...config[kind] } as Record<string, unknown>;
    // The units are edited in their own list.
    delete cfg.units;
    const hide = { hide_when_zero: cfg.hide_when_zero ?? hideDefault(kind, config.hide_when_zero) };
    if (isUnitGroup(kind)) return { ...cfg, separate: !!cfg.separate, ...hide };
    const base = cfg as BaseNodeConfig;
    return {
      ...cfg,
      entity: entityIds(base.entity),
      energy_entity: entityIds(base.energy_entity),
      ...(kind === 'grid'
        ? { export_energy_entity: entityIds((cfg as GridConfig).export_energy_entity) }
        : {}),
      ...hide,
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
      period: config.cost?.period ?? 'hour',
      price_mode: priceMode(config.cost, 'price', modes.price),
      export_price_mode: priceMode(config.cost, 'export_price', modes.export_price),
      savings_mode: savingsMode(config.cost, modes.savings),
    },
  };
}

/** Price sources chosen in the form data. */
export function priceModesOf(data: Record<string, unknown>): PriceModes {
  const cost = (data.cost ?? {}) as Record<string, unknown>;
  const out: PriceModes = {};
  for (const key of PRICE_KEYS) {
    const mode = cost[`${key}_mode`] as PriceMode;
    if (['none', 'fixed', 'entity', PRICE_FIELDS[key].readyMode].includes(mode)) out[key] = mode;
  }
  const savings = cost.savings_mode;
  if (savings === 'calculated' || savings === 'savings') out.savings = savings;
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
    if (isUnitGroup(kind)) {
      // The units are edited in their own list and kept from `previous`.
      const node = cfg as SolarConfig;
      if (node.separate === false) delete node.separate;
      const units = (previous[kind] as SolarConfig | undefined)?.units;
      if (units?.length) node.units = units;
      else delete node.units;
    } else {
      cfg.entity = compactRef(cfg.entity);
      cfg.energy_entity = compactRef(cfg.energy_entity);
      if (cfg.invert === false) delete cfg.invert;
    }
    if (kind === 'grid') {
      const grid = cfg as GridConfig;
      grid.export_energy_entity = compactRef(grid.export_energy_entity);
    }
    // A value equal to the default is dropped, unless it was written explicitly before.
    const explicit = (previous[kind] as BaseNodeConfig | undefined)?.hide_when_zero !== undefined;
    if (cfg.hide_when_zero === hideDefault(kind, globalHide) && !explicit) delete cfg.hide_when_zero;
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
    const fields = PRICE_FIELDS[key];
    if (mode !== 'fixed') delete cost[key];
    if (mode !== 'entity') delete cost[fields.entity];
    if (mode !== fields.readyMode) delete cost[fields.ready];
  }
  const savings = cost.savings_mode;
  delete cost.savings_mode;
  if (savings !== undefined && savings !== 'savings') delete cost.savings_entity;
  if (cost.period === 'hour') delete cost.period;
  // Unset actions are left as `undefined` by the form: drop them, and a group left empty.
  const dropEmpty = (section: Record<string, unknown>, key: string) => {
    const cleaned = clean((section[key] ?? {}) as Record<string, unknown>);
    if (Object.keys(cleaned).length) section[key] = cleaned;
    else delete section[key];
  };
  dropEmpty(cost, 'cost_actions');
  dropEmpty(cost, 'savings_actions');
  next.cost = cost;
  if (next.carbon) {
    next.carbon = { ...(next.carbon as Record<string, unknown>) };
    dropEmpty(next.carbon as Record<string, unknown>, 'actions');
  }

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

/** Form data of a unit. Like a device, the form shows the resolved `hide_when_zero`. */
export function unitFormData(
  group: UnitGroup,
  unit: BatteryUnitConfig,
  globalHide: boolean | undefined,
): Record<string, unknown> {
  return { ...unit, hide_when_zero: unit.hide_when_zero ?? hideDefault(group, globalHide) };
}

/** Unit config from its form data: only what differs from the defaults is written. */
export function unitFromForm(
  group: UnitGroup,
  data: Record<string, unknown>,
  previous: BatteryUnitConfig | undefined,
  globalHide: boolean | undefined,
): BatteryUnitConfig {
  const value = { ...data } as BatteryUnitConfig;
  if (value.hide_when_zero === hideDefault(group, globalHide) && previous?.hide_when_zero === undefined)
    delete value.hide_when_zero;
  if (value.invert === false) delete value.invert;
  return clean(value);
}
