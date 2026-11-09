import { normalizePower } from '../intensity';
import { localize, resolveLanguage, type LocalizeKey } from '../localize/localize';
import type { EntityRef, HomeAssistant, LiveEnergyCardConfig, PowerCurve } from '../types';
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
