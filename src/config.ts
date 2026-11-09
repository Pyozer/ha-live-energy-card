import { localize } from './localize/localize';
import { batteryUnits, solarUnits } from './source-units';
import type { BatteryUnitConfig, EntityRef, LineStyle, LiveEnergyCardConfig, SolarUnitConfig } from './types';
import { entityIds } from './units';

export const LINE_STYLES: LineStyle[] = ['rounded', 'square', 'curved', 'straight'];

const NUMERIC_FIELDS = [
  'min_power',
  'max_power',
  'threshold_w',
  'kilo_threshold',
  'decimals',
  'kilo_decimals',
] as const;

/** Options that moved from the solar and battery nodes to their units. */
const MOVED_TO_UNITS = {
  solar: ['entity', 'energy_entity', 'invert'],
  battery: [
    'entity',
    'energy_entity',
    'invert',
    'soc_entity',
    'charge_entity',
    'discharge_entity',
    'capacity',
    'min_soc',
  ],
} as const;

/** Options of the units that were renamed: the old name is still accepted, the new one wins. */
const RENAMED_UNIT_OPTIONS: Record<'solar' | 'battery', Record<string, string>> = {
  solar: { peak_power: 'max_power', peak_power_entity: 'max_power_entity' },
  battery: {},
};

/** Copy of an object with its numeric fields coerced (YAML or the editor may give strings), empty ones removed. */
function withNumbers(obj: object, fields: readonly string[], l: string): Record<string, unknown> {
  const copy = { ...obj } as Record<string, unknown>;
  for (const field of fields) {
    const value = copy[field];
    if (value === undefined || value === null || value === '') delete copy[field];
    else if (!Number.isFinite(Number(value))) throw new Error(localize(l, 'error.invalid_power', { field }));
    else copy[field] = Number(value);
  }
  return copy;
}

function renamed(obj: object, names: Record<string, string>): object {
  const copy = { ...obj } as Record<string, unknown>;
  for (const [old, current] of Object.entries(names)) {
    if (!(old in copy)) continue;
    copy[current] ??= copy[old];
    delete copy[old];
  }
  return copy;
}

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

  // Numbers nested in a section: coerced, empty ones removed.
  const numbers = <K extends 'cost' | 'grid'>(section: K, fields: string[]) => {
    if (config[section])
      (config as Record<string, unknown>)[section] = withNumbers(config[section], fields, l);
  };
  numbers('cost', ['price', 'export_price']);
  // An unknown period falls back to the default instead of breaking the card.
  if (config.cost && config.cost.period !== undefined && !['hour', 'day'].includes(config.cost.period))
    config.cost = { ...config.cost, period: undefined };
  numbers('grid', ['max_import']);

  // Solar and battery: their entities are set on their units, as a list without the empty rows left
  // by the editor. An option that used to be on the node is refused, naming where it goes now.
  for (const section of ['solar', 'battery'] as const) {
    const node = config[section];
    if (!node) continue;
    for (const field of MOVED_TO_UNITS[section]) {
      if ((node as Record<string, unknown>)[field] !== undefined)
        throw new Error(localize(l, 'error.moved_to_units', { node: section, field }));
    }
    if (node.units === undefined) continue;
    if (!Array.isArray(node.units)) throw new Error(localize(l, 'error.invalid_units', { field: section }));
    const numeric = section === 'battery' ? ['capacity', 'min_soc'] : ['max_power'];
    (config as Record<string, unknown>)[section] = {
      ...node,
      units: node.units
        .filter((u) => u && typeof u === 'object')
        .map((u) => withNumbers(renamed(u, RENAMED_UNIT_OPTIONS[section]), numeric, l)),
    };
  }

  // An unknown line style falls back to the default instead of breaking the card.
  if (config.line_style !== undefined && !LINE_STYLES.includes(config.line_style)) delete config.line_style;

  if (config.devices !== undefined && !Array.isArray(config.devices)) {
    throw new Error(localize(l, 'error.invalid_devices'));
  }
  // Empty rows left by the editor are ignored.
  config.devices = (config.devices ?? []).filter((d) => d && typeof d === 'object');

  const has = (...refs: unknown[]) => refs.some((r) => entityIds(r as EntityRef).length > 0);
  const hasEntity =
    solarUnits(config.solar).length > 0 ||
    has(config.grid?.entity, config.grid?.import_entity, config.grid?.export_entity) ||
    batteryUnits(config.battery).length > 0 ||
    has(config.home?.entity) ||
    config.devices.some((d) => has(d.entity) || !!d.devices?.some((c) => has(c?.entity)));
  if (!hasEntity) throw new Error(localize(l, 'error.no_entity'));

  return config;
}

/** All entities whose state affects rendering. */
export function watchedEntities(config: LiveEnergyCardConfig): string[] {
  const ids = new Set<string>();
  const add = (ref: EntityRef | undefined) => entityIds(ref).forEach((id) => ids.add(id));
  const devices = (config.devices ?? []).flatMap((d) => (d ? [d, ...(d.devices ?? [])] : []));
  for (const node of [config.grid, config.home, ...devices]) {
    if (!node) continue;
    add(node.entity);
    add(node.secondary_entity);
  }
  for (const unit of [...(config.solar?.units ?? []), ...(config.battery?.units ?? [])]) {
    if (!unit) continue;
    add(unit.entity);
    add(unit.secondary_entity);
    add((unit as BatteryUnitConfig).charge_entity);
    add((unit as BatteryUnitConfig).discharge_entity);
    add((unit as BatteryUnitConfig).grid_charge_entity);
    add((unit as BatteryUnitConfig).soc_entity);
    add((unit as SolarUnitConfig).max_power_entity);
  }
  add(config.solar?.secondary_entity);
  add(config.battery?.secondary_entity);
  add(config.grid?.import_entity);
  add(config.grid?.export_entity);
  add(config.cost?.price_entity);
  add(config.cost?.export_price_entity);
  add(config.cost?.cost_entity);
  add(config.cost?.earnings_entity);
  add(config.cost?.savings_entity);
  add(config.carbon?.intensity_entity);
  return [...ids];
}
