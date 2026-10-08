import { entitiesOfKind } from './entities';
import { entityIds } from './units';
import type {
  BatteryConfig,
  CostConfig,
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
  entity_energy_price?: string | null;
  number_energy_price?: number | null;
  entity_energy_price_export?: string | null;
  number_energy_price_export?: number | null;
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

export type EnergyImport = Pick<LiveEnergyCardConfig, 'solar' | 'grid' | 'battery' | 'devices' | 'cost'>;

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

  // Several sources of a type (inverters, batteries, grid entries per tariff) are added up when they
  // all use a single signed sensor; otherwise the first one with a power sensor is used.
  const powered = (type: string) =>
    sources
      .filter((s) => s.type === type)
      .map(powerOf)
      .filter(hasPower);
  const signed = (list: ReturnType<typeof powerOf>[]) => {
    const unique = [...new Set(list.filter((p) => p.entity && !p.invert).map((p) => p.entity!))];
    return unique.length > 1 && unique.length === list.length ? unique : undefined;
  };

  const solars = powered('solar');
  if (solars.length) {
    const many = signed(solars);
    const p = solars[0];
    const cfg: SolarConfig = { entity: many ?? p.entity ?? p.from };
    if (!many && p.invert) cfg.invert = true;
    out.solar = cfg;
  }

  const grids = powered('grid');
  if (grids.length) {
    // Grid entries of the same meter often share one sensor: duplicates are merged.
    const unique = grids.filter(
      (p, i) => grids.findIndex((q) => q.entity && q.entity === p.entity) === i || !p.entity,
    );
    const many = signed(unique);
    const p = unique[0];
    const cfg: GridConfig = many
      ? { entity: many }
      : p.entity
        ? { entity: p.entity }
        : { import_entity: p.from, export_entity: p.to };
    if (!many && p.invert) cfg.invert = true;
    out.grid = cfg;
  }

  const batterySources = sources.filter((s) => s.type === 'battery' && hasPower(powerOf(s)));
  if (batterySources.length) {
    const list = batterySources.map(powerOf);
    const many = signed(list);
    const p = list[0];
    // Battery power: positive = discharge, as in the Energy dashboard.
    const cfg: BatteryConfig = many
      ? { entity: many }
      : p.entity
        ? { entity: p.entity }
        : { discharge_entity: p.from, charge_entity: p.to };
    if (!many && p.invert) cfg.invert = true;
    const first = batterySources[0];
    if (!many && str(first.name)) cfg.name = first.name!;
    const socs = (many ? batterySources : [first]).map((b) => str(b.stat_soc)).filter(Boolean) as string[];
    if (socs.length) cfg.soc_entity = socs.length === 1 ? socs[0] : socs;
    out.battery = cfg;
  }

  const cost = costFromSources(sources);
  if (cost) out.cost = cost;

  const devices = prefs.device_consumption ?? [];
  // A device "included in" another listed device (a sub-meter) becomes a member of that device's
  // group, so its consumption is not counted twice. Deeper levels join the top-level ancestor.
  const byStat = new Map(devices.map((d) => [d.stat_consumption, d]));
  const root = (d: EnergyDevice): EnergyDevice => {
    let current = d;
    for (let guard = 0; guard < devices.length; guard++) {
      const parent = current.included_in_stat ? byStat.get(current.included_in_stat) : undefined;
      if (!parent || parent === d) break;
      current = parent;
    }
    return current;
  };
  const toConfig = (d: EnergyDevice): DeviceConfig => {
    const cfg: DeviceConfig = {};
    if (str(d.stat_rate)) cfg.entity = d.stat_rate!;
    if (str(d.name)) cfg.name = d.name!;
    return cfg;
  };
  const members = new Map<EnergyDevice, DeviceConfig[]>();
  for (const d of devices) {
    const top = root(d);
    if (top !== d && str(d.stat_rate)) members.set(top, [...(members.get(top) ?? []), toConfig(d)]);
  }
  out.devices = devices
    .filter((d) => root(d) === d)
    .flatMap((d) => {
      const cfg = toConfig(d);
      const children = members.get(d);
      if (children?.length) cfg.devices = children;
      return cfg.entity || cfg.devices ? [cfg] : [];
    });
  return out;
}

/**
 * Grid prices. Only imported when unambiguous: with several tariffs (peak / off-peak entries with
 * different prices), the current price cannot be known, so it is left to the user.
 */
function costFromSources(sources: EnergySource[]): CostConfig | undefined {
  const grids = sources.filter((s) => s.type === 'grid');
  const unique = (values: (string | number | undefined)[]) => {
    const set = [...new Set(values.filter((v) => v !== undefined))];
    return set.length === 1 ? set[0] : undefined;
  };
  const importPrice = unique(
    grids
      .filter((g) => g.stat_energy_from)
      .map((g) => str(g.entity_energy_price) ?? g.number_energy_price ?? undefined),
  );
  const exportPrice = unique(
    grids
      .filter((g) => g.stat_energy_to)
      .map((g) => str(g.entity_energy_price_export) ?? g.number_energy_price_export ?? undefined),
  );
  const cost: CostConfig = {};
  if (typeof importPrice === 'string') cost.price_entity = importPrice;
  else if (typeof importPrice === 'number') cost.price = importPrice;
  if (typeof exportPrice === 'string') cost.export_price_entity = exportPrice;
  else if (typeof exportPrice === 'number') cost.export_price = exportPrice;
  return Object.keys(cost).length ? cost : undefined;
}

/** Number of nodes found by an import, to report it to the user. */
export function importedCount(imported: EnergyImport): number {
  return (
    (imported.solar ? 1 : 0) +
    (imported.grid ? 1 : 0) +
    (imported.battery ? 1 : 0) +
    (imported.devices ?? []).reduce((acc, d) => acc + 1 + (d.devices?.length ?? 0), 0)
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
  // Prices configured by the user are kept.
  if (imported.cost && !config.cost) next.cost = imported.cost;
  const existing = config.devices ?? [];
  // Same entities (or, for a group without its own entity, same name) = same device.
  const key = (d: DeviceConfig) => entityIds(d.entity).join(',') || `group:${d.name ?? ''}`;
  const known = new Set(existing.map(key));
  next.devices = [...existing, ...(imported.devices ?? []).filter((d) => !known.has(key(d)))];
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
