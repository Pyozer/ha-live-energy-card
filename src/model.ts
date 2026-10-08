import { DEFAULT_COLORS, resolveColor } from './colors';
import {
  computeFlows,
  computeRatios,
  splitSigned,
  untrackedPower,
  type FlowResult,
  type Ratios,
} from './compute';
import { normalizePower, resolveToggles } from './intensity';
import type { Layout, PathGeometry, Rect, SourceFlowId } from './layout';
import { buildDeviceTree } from './tree';
import { localize, resolveLanguage } from './localize/localize';
import type {
  ActionConfig,
  AnimationToggles,
  BaseNodeConfig,
  HomeAssistant,
  PowerFlowCardConfig,
} from './types';
import { numberFormat, readPercent, readPower, type Reading } from './units';

export type NodeKind = 'solar' | 'grid' | 'battery' | 'home' | 'device';

export const UNTRACKED_ID = 'device:untracked';

export interface NodeActions {
  entity?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export interface MixSegment {
  color: string;
  fraction: number;
}

export interface NodeModel {
  id: string;
  kind: NodeKind;
  name: string;
  icon: string;
  color: string;
  /** Displayed power (W, absolute value), `null` when unavailable. */
  watts: number | null;
  available: boolean;
  visible: boolean;
  active: boolean;
  /** State label (Exporting, Charging…). */
  status?: string;
  secondary?: string;
  soc?: number | null;
  /** Home source mix, for the ring. */
  mix?: MixSegment[];
  actions: NodeActions;
}

export interface FlowModel {
  id: string;
  from: string;
  to: string;
  watts: number;
  /** Normalized intensity (0..1). */
  intensity: number;
  active: boolean;
  /** Show the dimmed path when the flow is zero. */
  idle: boolean;
  colorFrom: string;
  colorTo: string;
  toggles: Required<AnimationToggles>;
  source: SourceFlowId | null;
  /** Custom path (distribution bus in grid mode). */
  geometry?: (rects: Record<string, Rect>) => PathGeometry | null;
}

export interface CardModel {
  nodes: NodeModel[];
  flows: FlowModel[];
  ratios: Ratios | null;
  result: FlowResult;
  devicesOrder: string[];
}

export const DEFAULTS = {
  min_power: 0,
  max_power: 5000,
  threshold_w: 5,
  power_curve: 'sqrt' as const,
  hide_when_zero: true,
  inactive_flows: 'hide' as const,
  sort_devices: false,
  devices_layout: 'auto' as const,
  language: 'auto',
  show_untracked: false,
  show_ratios: false,
  kilo_threshold: 1000,
  decimals: 0,
  kilo_decimals: 1,
};

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

function formatSecondary(hass: HomeAssistant, entityId: string | undefined): string | undefined {
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

function actionsFor(cfg: BaseNodeConfig | undefined, entity: string | undefined): NodeActions {
  return {
    entity,
    tap_action: cfg?.tap_action ?? (entity ? { action: 'more-info' } : { action: 'none' }),
    hold_action: cfg?.hold_action,
    double_tap_action: cfg?.double_tap_action,
  };
}

function batteryIcon(soc: number | null | undefined, charging: boolean): string {
  if (soc === null || soc === undefined) return charging ? 'mdi:battery-charging' : 'mdi:battery-high';
  const level = Math.round(soc / 10) * 10;
  if (charging)
    return level >= 100 ? 'mdi:battery-charging-100' : `mdi:battery-charging-${Math.max(10, level)}`;
  if (level >= 100) return 'mdi:battery';
  if (level <= 0) return 'mdi:battery-outline';
  return `mdi:battery-${level}`;
}

/**
 * Sorts devices by decreasing power with hysteresis: a device only overtakes its neighbour when
 * clearly above it, so the list does not keep moving.
 */
export function sortWithHysteresis(
  items: { id: string; watts: number }[],
  previous: string[],
  margin = 0.12,
  minDelta = 8,
): string[] {
  const rank = new Map(previous.map((id, i) => [id, i]));
  const ordered = [...items].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
  const beats = (a: { watts: number }, b: { watts: number }): boolean =>
    a.watts > b.watts * (1 + margin) + minDelta;
  // Stable insertion sort with an overtaking threshold.
  for (let i = 1; i < ordered.length; i++) {
    const item = ordered[i];
    let j = i - 1;
    while (j >= 0 && beats(item, ordered[j])) {
      ordered[j + 1] = ordered[j];
      j--;
    }
    ordered[j + 1] = item;
  }
  return ordered.map((it) => it.id);
}

export function buildModel(
  config: PowerFlowCardConfig,
  hass: HomeAssistant,
  previousOrder: string[] = [],
): CardModel {
  const lang = resolveLanguage(config.language, hass);
  const t = (key: Parameters<typeof localize>[1]) => localize(lang, key);
  const threshold = config.threshold_w ?? DEFAULTS.threshold_w;
  const globalHide = config.hide_when_zero ?? DEFAULTS.hide_when_zero;
  const min = config.min_power ?? DEFAULTS.min_power;
  const max = config.max_power ?? DEFAULTS.max_power;
  const curve = config.power_curve ?? DEFAULTS.power_curve;
  const dimIdle = (config.inactive_flows ?? DEFAULTS.inactive_flows) === 'dim';
  const read = (id: string | undefined, invert = false): Reading | undefined =>
    id ? readPower(hass.states[id], invert) : undefined;
  const friendly = (id: string | undefined): string | undefined =>
    id ? hass.states[id]?.attributes.friendly_name : undefined;

  // --- Source readings -------------------------------------------------------------------------
  const solarCfg = config.solar?.entity ? config.solar : undefined;
  const solarR = read(solarCfg?.entity, solarCfg?.invert);

  const gridCfg =
    config.grid && (config.grid.entity || config.grid.import_entity || config.grid.export_entity)
      ? config.grid
      : undefined;
  let gridImport: number | undefined;
  let gridExport: number | undefined;
  let gridAvailable = true;
  if (gridCfg) {
    if (gridCfg.entity) {
      const r = read(gridCfg.entity, gridCfg.invert)!;
      gridAvailable = r.available;
      const s = splitSigned(r.value ?? 0);
      gridImport = s.positive;
      gridExport = s.negative;
    } else {
      const ri = read(gridCfg.import_entity);
      const re = read(gridCfg.export_entity);
      gridAvailable = (ri?.available ?? true) && (re?.available ?? true);
      gridImport = Math.max(0, ri?.value ?? 0);
      gridExport = Math.max(0, re?.value ?? 0);
    }
  }

  const batCfg =
    config.battery &&
    (config.battery.entity || config.battery.charge_entity || config.battery.discharge_entity)
      ? config.battery
      : undefined;
  let batCharge: number | undefined;
  let batDischarge: number | undefined;
  let batAvailable = true;
  if (batCfg) {
    if (batCfg.entity) {
      const r = read(batCfg.entity, batCfg.invert)!;
      batAvailable = r.available;
      const s = splitSigned(r.value ?? 0);
      batDischarge = s.positive;
      batCharge = s.negative;
    } else {
      const rc = read(batCfg.charge_entity);
      const rd = read(batCfg.discharge_entity);
      batAvailable = (rc?.available ?? true) && (rd?.available ?? true);
      batCharge = Math.max(0, rc?.value ?? 0);
      batDischarge = Math.max(0, rd?.value ?? 0);
    }
  }

  const homeCfg = config.home;
  const homeR = read(homeCfg?.entity, homeCfg?.invert);

  const result = computeFlows(
    {
      solar: solarR?.value ?? undefined,
      gridImport,
      gridExport,
      batteryCharge: batCharge,
      batteryDischarge: batDischarge,
      home: homeR?.available ? (homeR.value ?? undefined) : undefined,
    },
    threshold,
  );

  const nodes: NodeModel[] = [];
  const flows: FlowModel[] = [];
  const hideFor = (cfg: BaseNodeConfig | undefined, defaultHide: boolean) =>
    cfg?.hide_when_zero ?? defaultHide;

  // --- Source nodes ----------------------------------------------------------------------------
  const solarColor = resolveColor(solarCfg?.color, DEFAULT_COLORS.solar);
  if (solarCfg) {
    const available = solarR?.available ?? false;
    const watts = available ? result.solar : null;
    const active = result.solar > 0;
    nodes.push({
      id: 'solar',
      kind: 'solar',
      name: solarCfg.name ?? t('node.solar'),
      icon: solarCfg.icon ?? (active ? 'mdi:solar-power-variant' : 'mdi:solar-power-variant-outline'),
      color: solarColor,
      watts,
      available,
      active,
      visible: !(available && !active && hideFor(solarCfg, globalHide)),
      secondary: formatSecondary(hass, solarCfg.secondary_entity),
      actions: actionsFor(solarCfg, solarCfg.entity),
    });
  }

  const exporting = result.gridExport > 0;
  const gridImportColor = resolveColor(gridCfg?.color, DEFAULT_COLORS.gridImport);
  const gridExportColor = resolveColor(gridCfg?.export_color, DEFAULT_COLORS.gridExport);
  if (gridCfg) {
    const net = result.gridImport - result.gridExport;
    const active = net !== 0;
    nodes.push({
      id: 'grid',
      kind: 'grid',
      name: gridCfg.name ?? t('node.grid'),
      icon:
        gridCfg.icon ??
        (exporting
          ? 'mdi:transmission-tower-export'
          : result.gridImport > 0
            ? 'mdi:transmission-tower-import'
            : 'mdi:transmission-tower'),
      color: exporting ? gridExportColor : gridImportColor,
      watts: gridAvailable ? Math.abs(net) : null,
      available: gridAvailable,
      active,
      visible: !(gridAvailable && !active && hideFor(gridCfg, false)),
      status: exporting ? t('state.exporting') : result.gridImport > 0 ? t('state.importing') : undefined,
      secondary: formatSecondary(hass, gridCfg.secondary_entity),
      actions: actionsFor(gridCfg, gridCfg.entity ?? gridCfg.import_entity ?? gridCfg.export_entity),
    });
  }

  const charging = result.batteryCharge > 0;
  const batColor = resolveColor(batCfg?.color, DEFAULT_COLORS.battery);
  const batChargeColor = resolveColor(batCfg?.charge_color ?? batCfg?.color, DEFAULT_COLORS.batteryCharge);
  if (batCfg) {
    const soc = batCfg.soc_entity ? readPercent(hass.states[batCfg.soc_entity]) : undefined;
    const net = result.batteryDischarge - result.batteryCharge;
    const active = net !== 0;
    nodes.push({
      id: 'battery',
      kind: 'battery',
      name: batCfg.name ?? t('node.battery'),
      icon: batCfg.icon ?? batteryIcon(soc, charging),
      color: charging ? batChargeColor : batColor,
      watts: batAvailable ? Math.abs(net) : null,
      available: batAvailable,
      active,
      // With a charge level configured, an idle battery stays visible unless explicitly hidden.
      visible: !(batAvailable && !active && hideFor(batCfg, globalHide && soc === undefined)),
      status: charging
        ? t('state.charging')
        : result.batteryDischarge > 0
          ? t('state.discharging')
          : t('state.idle'),
      soc,
      secondary: formatSecondary(hass, batCfg.secondary_entity),
      actions: actionsFor(batCfg, batCfg.entity ?? batCfg.discharge_entity ?? batCfg.charge_entity),
    });
  }

  // --- Home ------------------------------------------------------------------------------------
  const homeColor = resolveColor(homeCfg?.color, DEFAULT_COLORS.home);
  const f = result.flows;
  const homeSources = f.solarToHome + f.batteryToHome + f.gridToHome;
  const homeAvailable = homeCfg?.entity ? (homeR?.available ?? false) : true;
  nodes.push({
    id: 'home',
    kind: 'home',
    name: homeCfg?.name ?? t('node.home'),
    icon: homeCfg?.icon ?? 'mdi:home-lightning-bolt-outline',
    color: homeColor,
    watts: homeAvailable ? result.home : null,
    available: homeAvailable,
    active: result.home > 0,
    visible: true,
    secondary: formatSecondary(hass, homeCfg?.secondary_entity),
    mix:
      homeSources > 0
        ? [
            { color: solarColor, fraction: f.solarToHome / homeSources },
            { color: batColor, fraction: f.batteryToHome / homeSources },
            { color: gridImportColor, fraction: f.gridToHome / homeSources },
          ].filter((s) => s.fraction > 0.004)
        : [],
    actions: actionsFor(homeCfg, homeCfg?.entity),
  });

  // --- Devices ---------------------------------------------------------------------------------
  const deviceNodes: NodeModel[] = [];
  const deviceWatts: number[] = [];
  (config.devices ?? []).forEach((dev, index) => {
    if (!dev?.entity) return;
    const r = readPower(hass.states[dev.entity], dev.invert);
    const watts = r.available ? Math.max(0, r.value ?? 0) : null;
    const value = watts !== null && watts >= threshold ? watts : 0;
    deviceWatts.push(value);
    const active = value > 0;
    deviceNodes.push({
      id: `device:${index}`,
      kind: 'device',
      name: dev.name ?? cleanName(friendly(dev.entity), dev.entity),
      icon:
        dev.icon ??
        (hass.states[dev.entity]?.attributes.icon as string | undefined) ??
        'mdi:power-plug-outline',
      color: resolveColor(dev.color, DEFAULT_COLORS.device),
      watts: watts === null ? null : value,
      available: r.available,
      active,
      visible: !(r.available && !active && hideFor(dev, globalHide)),
      secondary: formatSecondary(hass, dev.secondary_entity),
      actions: actionsFor(dev, dev.entity),
    });
  });

  if (config.show_untracked) {
    const rest = untrackedPower(result.home, deviceWatts);
    const value = rest >= threshold ? rest : 0;
    deviceNodes.push({
      id: UNTRACKED_ID,
      kind: 'device',
      name: t('node.untracked'),
      icon: 'mdi:dots-horizontal-circle-outline',
      color: DEFAULT_COLORS.device,
      watts: value,
      available: true,
      active: value > 0,
      visible: !(value === 0 && globalHide),
      actions: { tap_action: { action: 'none' } },
    });
  }

  let devicesOrder = deviceNodes.map((d) => d.id);
  if (config.sort_devices) {
    const untracked = devicesOrder.filter((id) => id === UNTRACKED_ID);
    devicesOrder = [
      ...sortWithHysteresis(
        deviceNodes.filter((d) => d.id !== UNTRACKED_ID).map((d) => ({ id: d.id, watts: d.watts ?? -1 })),
        previousOrder,
      ),
      ...untracked,
    ];
  }
  nodes.push(...deviceNodes);

  // --- Flows -----------------------------------------------------------------------------------
  const visible = new Set(nodes.filter((n) => n.visible).map((n) => n.id));
  const nodeCfg: Record<string, BaseNodeConfig | undefined> = {
    solar: solarCfg,
    grid: gridCfg,
    battery: batCfg,
    home: homeCfg,
  };
  const colorOf: Record<string, string> = {
    solar: solarColor,
    grid: gridImportColor,
    battery: batColor,
    home: homeColor,
  };

  const sourceFlow = (
    id: SourceFlowId,
    from: string,
    to: string,
    watts: number,
    colorFrom: string,
    colorTo: string,
  ) => {
    if (!nodeCfg[from] && from !== 'home') return;
    if (!nodeCfg[to] && to !== 'home') return;
    const active = watts > 0 && visible.has(from) && visible.has(to);
    // The grid ↔ battery path is drawn only once when idle.
    const idle = dimIdle && !active && id !== 'battery_grid' && visible.has(from) && visible.has(to);
    flows.push({
      id,
      from,
      to,
      watts,
      intensity: normalizePower(watts, min, max, curve),
      active,
      idle,
      colorFrom,
      colorTo,
      toggles: resolveToggles(config.animation, nodeCfg[from]?.animation),
      source: id,
    });
  };

  sourceFlow('solar_home', 'solar', 'home', f.solarToHome, solarColor, homeColor);
  sourceFlow('solar_battery', 'solar', 'battery', f.solarToBattery, solarColor, batChargeColor);
  sourceFlow('solar_grid', 'solar', 'grid', f.solarToGrid, solarColor, gridExportColor);
  sourceFlow('grid_home', 'grid', 'home', f.gridToHome, colorOf.grid, homeColor);
  sourceFlow('grid_battery', 'grid', 'battery', f.gridToBattery, colorOf.grid, batChargeColor);
  sourceFlow('battery_home', 'battery', 'home', f.batteryToHome, batColor, homeColor);
  sourceFlow('battery_grid', 'battery', 'grid', f.batteryToGrid, batColor, gridExportColor);

  const devCfgs = config.devices ?? [];
  for (const dev of deviceNodes) {
    const index = dev.id === UNTRACKED_ID ? -1 : Number(dev.id.split(':')[1]);
    const watts = dev.watts ?? 0;
    const active = watts > 0 && dev.visible;
    flows.push({
      id: `flow:${dev.id}`,
      from: 'home',
      to: dev.id,
      watts,
      intensity: normalizePower(watts, min, max, curve),
      active,
      idle: dimIdle && !active && dev.visible,
      colorFrom: homeColor,
      colorTo: dev.color,
      toggles: resolveToggles(config.animation, index >= 0 ? devCfgs[index]?.animation : undefined),
      source: null,
    });
  }

  return {
    nodes,
    flows,
    ratios: config.show_ratios ? computeRatios(result) : null,
    result,
    devicesOrder,
  };
}

/**
 * In grid mode, replaces home → device flows with the distribution bus: each segment carries
 * the sum of the devices downstream.
 */
export function applyDeviceTree(model: CardModel, layout: Layout, config: PowerFlowCardConfig): FlowModel[] {
  if (layout.devices.mode === 'column') return model.flows;
  const min = config.min_power ?? DEFAULTS.min_power;
  const max = config.max_power ?? DEFAULTS.max_power;
  const curve = config.power_curve ?? DEFAULTS.power_curve;
  const dimIdle = (config.inactive_flows ?? DEFAULTS.inactive_flows) === 'dim';
  const home = model.nodes.find((n) => n.id === 'home')!;
  const watts = new Map(model.nodes.map((n) => [n.id, n.watts ?? 0]));
  const byId = new Map(model.flows.map((f) => [f.id, f]));
  const bus = layout.devices.bus;

  const flows = model.flows.filter((f) => f.source !== null);
  const used = new Set<string>();
  for (const edge of buildDeviceTree(layout.devices)) {
    if (edge.leaf) {
      const leaf = byId.get(edge.id);
      if (!leaf) continue;
      used.add(edge.id);
      flows.push({ ...leaf, geometry: edge.geometry });
      continue;
    }
    const total = edge.downstream.reduce((acc, id) => acc + (watts.get(id) ?? 0), 0);
    const active = total > 0;
    flows.push({
      id: edge.id,
      from: 'home',
      to: edge.downstream[0],
      watts: total,
      intensity: normalizePower(total, min, max, curve),
      active,
      idle: dimIdle && !active,
      colorFrom: home.color,
      colorTo: home.color,
      toggles: resolveToggles(config.animation),
      source: null,
      geometry: edge.geometry,
    });
  }
  // Hidden devices: a short segment that fades out with the pill.
  for (const f of model.flows) {
    if (f.source !== null || used.has(f.id)) continue;
    flows.push({
      ...f,
      geometry: (rects) => {
        const tile = rects[f.to];
        if (!tile) return null;
        const x = tile.x - tile.w / 2;
        return {
          d: `M${x - bus},${tile.y} L${x + 2},${tile.y}`,
          from: { x: x - bus, y: tile.y },
          to: { x, y: tile.y },
        };
      },
    });
  }
  return flows;
}
