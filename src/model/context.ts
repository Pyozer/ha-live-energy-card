import { normalizePower } from '../intensity';
import { localize, resolveLanguage, type LocalizeKey } from '../localize/localize';
import type { EntityRef, HomeAssistant, LiveEnergyCardConfig, MaxPowerConfig, PowerCurve } from '../types';
import { entityIds, readPowerSum, type Reading } from '../units';

export const DEFAULTS = {
  min_power: 0,
  max_power: 5000,
  threshold_w: 5,
  power_curve: 'sqrt' as const,
  hide_when_zero: true,
  inactive_flows: 'hide' as const,
  line_style: 'rounded' as const,
  sort_devices: false,
  devices_layout: 'auto' as const,
  language: 'auto',
  show_untracked: false,
  show_ratios: false,
  eco_mode: false,
  transparent: false,
  compact: false,
  small_bubbles: false,
  kilo_threshold: 1000,
  decimals: 0,
  kilo_decimals: 1,
};

/** How flow power maps to intensity, shared by every flow. */
export interface FlowScale {
  min: number;
  max: number;
  curve: PowerCurve;
  /** Zero flows stay drawn, dimmed. */
  dimIdle: boolean;
}

export function flowScale(config: LiveEnergyCardConfig): FlowScale {
  return {
    min: config.min_power ?? DEFAULTS.min_power,
    max: config.max_power ?? DEFAULTS.max_power,
    curve: config.power_curve ?? DEFAULTS.power_curve,
    dimIdle: (config.inactive_flows ?? DEFAULTS.inactive_flows) === 'dim',
  };
}

export const intensityOf = (scale: FlowScale, watts: number): number =>
  normalizePower(watts, scale.min, scale.max, scale.curve);

/** Everything the model builders need, resolved once per update. */
export interface ModelContext {
  config: LiveEnergyCardConfig;
  hass: HomeAssistant;
  t: (key: LocalizeKey, vars?: Record<string, string>) => string;
  threshold: number;
  globalHide: boolean;
  /** Today's energy (kWh) by node id, `null` when its statistics are unavailable. */
  todayEnergy: ReadonlyMap<string, number | null>;
}

export function modelContext(
  config: LiveEnergyCardConfig,
  hass: HomeAssistant,
  todayEnergy: ReadonlyMap<string, number | null> = new Map(),
): ModelContext {
  const lang = resolveLanguage(config.language, hass);
  return {
    config,
    hass,
    t: (key, vars) => localize(lang, key, vars),
    threshold: config.threshold_w ?? DEFAULTS.threshold_w,
    globalHide: config.hide_when_zero ?? DEFAULTS.hide_when_zero,
    todayEnergy,
  };
}

export const hasEntity = (ref: EntityRef | undefined): boolean => entityIds(ref).length > 0;

/** Summed power of a reference, `undefined` when it has no entity. */
export const readRef = (
  hass: HomeAssistant,
  ref: EntityRef | undefined,
  invert = false,
): Reading | undefined => (hasEntity(ref) ? readPowerSum(hass.states, ref, invert) : undefined);

/**
 * Maximum power of a bubble (W): its entity while it is readable and positive, otherwise the fixed
 * value. `undefined` when neither gives a positive power.
 */
export function readMaxPower(hass: HomeAssistant, cfg: MaxPowerConfig): number | undefined {
  const live = readRef(hass, cfg.max_power_entity);
  const watts = live?.available && (live.value ?? 0) > 0 ? live.value! : Number(cfg.max_power);
  return Number.isFinite(watts) && watts > 0 ? watts : undefined;
}

/**
 * Share (0 to 1) of its maximum power that a bubble reaches. `undefined` without a maximum, so the
 * bubble has no gauge, and `null` when it is unavailable.
 */
export const powerShare = (
  watts: number,
  max: number | undefined,
  available = true,
): number | null | undefined =>
  max === undefined ? undefined : available ? Math.min(1, Math.max(0, watts / max)) : null;

/** Status of a bubble with a gauge ("62 % of maximum power"), none without a share. */
export const shareStatus = (
  ctx: Pick<ModelContext, 't'>,
  share: number | null | undefined,
): string | undefined =>
  share == null ? undefined : ctx.t('state.max_power_ratio', { percent: String(Math.round(share * 100)) });
