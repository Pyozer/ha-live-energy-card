import { localize } from './localize/localize';
import type { LineStyle, LiveEnergyCardConfig } from './types';

export const LINE_STYLES: LineStyle[] = ['rounded', 'square', 'curved', 'straight'];

const NUMERIC_FIELDS = [
  'min_power',
  'max_power',
  'threshold_w',
  'kilo_threshold',
  'decimals',
  'kilo_decimals',
] as const;

function lang(configured: unknown): string {
  if (typeof configured === 'string' && configured && configured !== 'auto') return configured;
  if (typeof document !== 'undefined') {
    const ha = document.querySelector('home-assistant') as unknown as { hass?: { language?: string } } | null;
    if (ha?.hass?.language) return ha.hass.language;
    if (document.documentElement.lang) return document.documentElement.lang;
  }
  return 'en';
}

/** Validates the configuration; throws a readable error (shown by Home Assistant in the card). */
export function validateConfig(input: unknown): LiveEnergyCardConfig {
  if (!input || typeof input !== 'object') throw new Error('Invalid configuration');
  const config = { ...(input as LiveEnergyCardConfig) };
  const l = lang(config.language);

  for (const field of NUMERIC_FIELDS) {
    const value = config[field];
    if (value === undefined || value === null || (value as unknown) === '') {
      delete config[field];
      continue;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) throw new Error(localize(l, 'error.invalid_power', { field }));
    config[field] = num;
  }

  if (
    config.min_power !== undefined &&
    config.max_power !== undefined &&
    config.max_power <= config.min_power
  ) {
    throw new Error(localize(l, 'error.invalid_range'));
  }

  // An unknown line style falls back to the default instead of breaking the card.
  if (config.line_style !== undefined && !LINE_STYLES.includes(config.line_style)) delete config.line_style;

  if (config.devices !== undefined && !Array.isArray(config.devices)) {
    throw new Error(localize(l, 'error.invalid_devices'));
  }
  // Empty rows left by the editor are ignored.
  config.devices = (config.devices ?? []).filter((d) => d && typeof d === 'object');

  const hasEntity =
    !!config.solar?.entity ||
    !!(config.grid?.entity || config.grid?.import_entity || config.grid?.export_entity) ||
    !!(config.battery?.entity || config.battery?.charge_entity || config.battery?.discharge_entity) ||
    !!config.home?.entity ||
    config.devices.some((d) => !!d.entity);
  if (!hasEntity) throw new Error(localize(l, 'error.no_entity'));

  return config;
}

/** All entities whose state affects rendering. */
export function watchedEntities(config: LiveEnergyCardConfig): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => id && ids.add(id);
  for (const node of [config.solar, config.grid, config.battery, config.home, ...(config.devices ?? [])]) {
    if (!node) continue;
    add(node.entity);
    add(node.secondary_entity);
  }
  add(config.grid?.import_entity);
  add(config.grid?.export_entity);
  add(config.battery?.charge_entity);
  add(config.battery?.discharge_entity);
  add(config.battery?.soc_entity);
  return [...ids];
}
