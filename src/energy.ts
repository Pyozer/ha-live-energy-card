import { entitiesOfKind } from './entities';
import type {
  BatteryConfig,
  DeviceConfig,
  GridConfig,
  HomeAssistant,
  LiveEnergyCardConfig,
  SolarConfig,
} from './types';

/**
 * Import from the Home Assistant Energy dashboard (`energy/get_prefs`).
 *
 * The dashboard is built on energy statistics (kWh), but recent versions also store the matching
 * power sensors (`stat_rate`, `power_config`), which are what this card needs. Sources or devices
 * without a power sensor are skipped.
 */

export interface EnergyPowerConfig {
  stat_rate?: string | null;
  stat_rate_inverted?: string | null;
  stat_rate_from?: string | null;
  stat_rate_to?: string | null;
}

export interface EnergySource {
  type: string;
  name?: string | null;
  stat_energy_from?: string | null;
  stat_energy_to?: string | null;
  stat_rate?: string | null;
  stat_soc?: string | null;
  power_config?: EnergyPowerConfig | null;
}

export interface EnergyDevice {
  stat_consumption: string;
  stat_rate?: string | null;
  name?: string | null;
  included_in_stat?: string | null;
}

export interface EnergyPrefs {
  energy_sources?: EnergySource[];
  device_consumption?: EnergyDevice[];
}

export type EnergyImport = Pick<LiveEnergyCardConfig, 'solar' | 'grid' | 'battery' | 'devices'>;

const str = (v: string | null | undefined): string | undefined => (v ? v : undefined);

/** Power entities of a source: `power_config` (newer format) first, then `stat_rate`. */
function powerOf(source: EnergySource): {
  entity?: string;
  invert?: boolean;
  from?: string;
  to?: string;
} {
  const pc = source.power_config ?? {};
  if (str(pc.stat_rate)) return { entity: pc.stat_rate! };
  if (str(pc.stat_rate_inverted)) return { entity: pc.stat_rate_inverted!, invert: true };
  if (str(pc.stat_rate_from) || str(pc.stat_rate_to)) {
    return { from: str(pc.stat_rate_from), to: str(pc.stat_rate_to) };
  }
  return { entity: str(source.stat_rate) };
}

const hasPower = (p: ReturnType<typeof powerOf>): boolean => !!(p.entity || p.from || p.to);

export function configFromEnergyPrefs(prefs: EnergyPrefs): EnergyImport {
  const sources = prefs.energy_sources ?? [];
  const out: EnergyImport = {};

  const solar = sources.find((s) => s.type === 'solar' && hasPower(powerOf(s)));
  if (solar) {
    const p = powerOf(solar);
    const cfg: SolarConfig = { entity: p.entity ?? p.from };
    if (p.invert) cfg.invert = true;
    out.solar = cfg;
  }

  // The grid can be split into several entries (one per tariff): the first with a power sensor wins.
  const grid = sources.find((s) => s.type === 'grid' && hasPower(powerOf(s)));
  if (grid) {
    const p = powerOf(grid);
    const cfg: GridConfig = p.entity ? { entity: p.entity } : { import_entity: p.from, export_entity: p.to };
    if (p.invert) cfg.invert = true;
    out.grid = cfg;
  }

  const battery = sources.find((s) => s.type === 'battery' && hasPower(powerOf(s)));
  if (battery) {
    const p = powerOf(battery);
    // Battery power: positive = discharge, as in the Energy dashboard.
    const cfg: BatteryConfig = p.entity
      ? { entity: p.entity }
      : { discharge_entity: p.from, charge_entity: p.to };
    if (p.invert) cfg.invert = true;
    if (str(battery.name)) cfg.name = battery.name!;
    if (str(battery.stat_soc)) cfg.soc_entity = battery.stat_soc!;
    out.battery = cfg;
  }

  const devices = prefs.device_consumption ?? [];
  // A device "included in" another listed device is a sub-meter: counting it again would
  // understate the untracked consumption.
  const listed = new Set(devices.map((d) => d.stat_consumption));
  out.devices = devices
    .filter((d) => str(d.stat_rate))
    .map((d) => {
      const cfg: DeviceConfig = { entity: d.stat_rate! };
      if (str(d.name)) cfg.name = d.name!;
      if (d.included_in_stat && listed.has(d.included_in_stat)) cfg.exclude_from_untracked = true;
      return cfg;
    });
  return out;
}

/** Number of nodes found by an import, to report it to the user. */
export function importedCount(imported: EnergyImport): number {
  return (
    (imported.solar ? 1 : 0) +
    (imported.grid ? 1 : 0) +
    (imported.battery ? 1 : 0) +
    (imported.devices?.length ?? 0)
  );
}

/**
 * Merges an import into an existing configuration: imported sources replace the configured ones,
 * new devices are appended after the existing ones (same entity = same device).
 */
export function mergeEnergyImport(
  config: LiveEnergyCardConfig,
  imported: EnergyImport,
): LiveEnergyCardConfig {
  const next: LiveEnergyCardConfig = { ...config };
  for (const key of ['solar', 'grid', 'battery'] as const) {
    if (imported[key]) next[key] = { ...stripEntities(config[key]), ...imported[key] } as never;
  }
  const existing = config.devices ?? [];
  const known = new Set(existing.map((d) => d.entity));
  next.devices = [...existing, ...(imported.devices ?? []).filter((d) => !known.has(d.entity))];
  return next;
}

/** Keeps the display options of a node (name, color…) but drops its power entities. */
function stripEntities<T extends object>(node: T | undefined): Partial<T> {
  if (!node) return {};
  const out = { ...node } as Record<string, unknown>;
  for (const key of [
    'entity',
    'import_entity',
    'export_entity',
    'charge_entity',
    'discharge_entity',
    'invert',
  ])
    delete out[key];
  return out as Partial<T>;
}

/** Reads the Energy dashboard preferences; `null` when unavailable (not configured, no access). */
export async function fetchEnergyPrefs(hass: HomeAssistant | undefined): Promise<EnergyPrefs | null> {
  if (!hass?.callWS) return null;
  try {
    return await hass.callWS<EnergyPrefs>({ type: 'energy/get_prefs' });
  } catch {
    return null;
  }
}

/** Fallback without an Energy dashboard: power sensors guessed from their names. */
export function guessConfig(hass: HomeAssistant | undefined): Partial<LiveEnergyCardConfig> {
  const power = entitiesOfKind(hass, 'power')
    .filter((id) => id.startsWith('sensor.'))
    .map((id) => hass!.states[id]);
  const find = (re: RegExp) =>
    power.find((s) => re.test(`${s.entity_id} ${s.attributes.friendly_name ?? ''}`));
  const solar = find(/solar|solaire|pv|photovolta/i);
  const grid = find(/grid|r[ée]seau|linky|compteur|meter/i);
  const battery = find(/batter/i);
  const used = new Set([solar, grid, battery].filter(Boolean).map((s) => s!.entity_id));
  const devices = power
    .filter(
      (s) => !used.has(s.entity_id) && /prise|plug|socket|chauffe|boiler|frigo|fridge/i.test(s.entity_id),
    )
    .slice(0, 4)
    .map((s) => ({ entity: s.entity_id }));
  const fallback = !solar && !grid && !battery && devices.length === 0 ? power[0] : undefined;
  return {
    ...(solar ? { solar: { entity: solar.entity_id } } : {}),
    ...(grid ? { grid: { entity: grid.entity_id } } : {}),
    ...(battery ? { battery: { entity: battery.entity_id } } : {}),
    ...(fallback ? { home: { entity: fallback.entity_id } } : {}),
    devices,
  };
}
