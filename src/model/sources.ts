import { batteryEta, formatDuration } from '../battery';
import { DEFAULT_COLORS, resolveColor } from '../colors';
import { splitSigned, type FlowResult, type SourceInputs } from '../compute';
import type {
  BatteryConfig,
  EntityRef,
  GridConfig,
  HomeAssistant,
  HomeConfig,
  LiveEnergyCardConfig,
  SolarConfig,
} from '../types';
import { readPercentAverage, type Reading } from '../units';
import { hasEntity, readRef, type ModelContext } from './context';
import { actionsFor, batteryIcon, nodeSecondary } from './format';
import type { NodeModel } from './types';

/** Configured sources (a node without any entity is left out) and their readings. */
export interface SourceReadings {
  solar?: SolarConfig;
  grid?: GridConfig;
  battery?: BatteryConfig;
  home?: HomeConfig;
  solarReading?: Reading;
  homeReading?: Reading;
  gridAvailable: boolean;
  batteryAvailable: boolean;
  /** Input of the energy balance. */
  inputs: SourceInputs;
}

/** Reads a signed entity, or a pair of positive entities (import / export, charge / discharge). */
function readPair(
  hass: HomeAssistant,
  cfg: GridConfig | BatteryConfig,
  positive: EntityRef | undefined,
  negative: EntityRef | undefined,
): { positive: number; negative: number; available: boolean } {
  if (hasEntity(cfg.entity)) {
    const r = readRef(hass, cfg.entity, cfg.invert)!;
    return { ...splitSigned(r.value ?? 0), available: r.available };
  }
  const p = readRef(hass, positive);
  const n = readRef(hass, negative);
  return {
    positive: Math.max(0, p?.value ?? 0),
    negative: Math.max(0, n?.value ?? 0),
    available: (p?.available ?? true) && (n?.available ?? true),
  };
}

export function readSources(config: LiveEnergyCardConfig, hass: HomeAssistant): SourceReadings {
  const solar = hasEntity(config.solar?.entity) ? config.solar : undefined;
  const g = config.grid;
  const grid =
    g && (hasEntity(g.entity) || hasEntity(g.import_entity) || hasEntity(g.export_entity)) ? g : undefined;
  const b = config.battery;
  const battery =
    b && (hasEntity(b.entity) || hasEntity(b.charge_entity) || hasEntity(b.discharge_entity)) ? b : undefined;
  const home = config.home;

  const solarReading = readRef(hass, solar?.entity, solar?.invert);
  const homeReading = readRef(hass, home?.entity, home?.invert);
  const gridPair = grid ? readPair(hass, grid, grid.import_entity, grid.export_entity) : undefined;
  const batPair = battery
    ? readPair(hass, battery, battery.discharge_entity, battery.charge_entity)
    : undefined;

  return {
    solar,
    grid,
    battery,
    home,
    solarReading,
    homeReading,
    gridAvailable: gridPair?.available ?? true,
    batteryAvailable: batPair?.available ?? true,
    inputs: {
      solar: solarReading?.value ?? undefined,
      gridImport: gridPair?.positive,
      gridExport: gridPair?.negative,
      batteryCharge: batPair?.negative,
      batteryDischarge: batPair?.positive,
      home: homeReading?.available ? (homeReading.value ?? undefined) : undefined,
    },
  };
}

export interface SourceColors {
  solar: string;
  gridImport: string;
  gridExport: string;
  battery: string;
  batteryCharge: string;
  home: string;
}

export function sourceColors(src: SourceReadings): SourceColors {
  return {
    solar: resolveColor(src.solar?.color, DEFAULT_COLORS.solar),
    gridImport: resolveColor(src.grid?.color, DEFAULT_COLORS.gridImport),
    gridExport: resolveColor(src.grid?.export_color, DEFAULT_COLORS.gridExport),
    battery: resolveColor(src.battery?.color, DEFAULT_COLORS.battery),
    batteryCharge: resolveColor(
      src.battery?.charge_color ?? src.battery?.color,
      DEFAULT_COLORS.batteryCharge,
    ),
    home: resolveColor(src.home?.color, DEFAULT_COLORS.home),
  };
}

/** Solar, grid, battery and home nodes. */
export function sourceNodes(
  ctx: ModelContext,
  src: SourceReadings,
  result: FlowResult,
  colors: SourceColors,
): NodeModel[] {
  const { hass, t, globalHide } = ctx;
  const nodes: NodeModel[] = [];

  if (src.solar) {
    const cfg = src.solar;
    const available = src.solarReading?.available ?? false;
    const active = result.solar > 0;
    nodes.push({
      id: 'solar',
      kind: 'solar',
      name: cfg.name ?? t('node.solar'),
      icon: cfg.icon ?? (active ? 'mdi:solar-power-variant' : 'mdi:solar-power-variant-outline'),
      color: colors.solar,
      watts: available ? result.solar : null,
      available,
      active,
      visible: !(available && !active && (cfg.hide_when_zero ?? globalHide)),
      secondary: nodeSecondary(hass, cfg, ctx.todayEnergy.get('solar')),
      actions: actionsFor(cfg, cfg.entity),
    });
  }

  if (src.grid) {
    const cfg = src.grid;
    const available = src.gridAvailable;
    const exporting = result.gridExport > 0;
    const importing = result.gridImport > 0;
    const net = result.gridImport - result.gridExport;
    const active = net !== 0;
    const alert = available && !!cfg.max_import && result.gridImport >= cfg.max_import;
    nodes.push({
      id: 'grid',
      kind: 'grid',
      name: cfg.name ?? t('node.grid'),
      icon:
        cfg.icon ??
        (exporting
          ? 'mdi:transmission-tower-export'
          : importing
            ? 'mdi:transmission-tower-import'
            : 'mdi:transmission-tower'),
      color: exporting ? colors.gridExport : colors.gridImport,
      watts: available ? Math.abs(net) : null,
      available,
      active,
      // The grid stays visible at zero unless explicitly hidden.
      visible: !(available && !active && (cfg.hide_when_zero ?? false)),
      alert,
      status: alert
        ? t('state.over_limit')
        : exporting
          ? t('state.exporting')
          : importing
            ? t('state.importing')
            : undefined,
      secondary: nodeSecondary(hass, cfg, ctx.todayEnergy.get('grid')),
      actions: actionsFor(cfg, cfg.entity ?? cfg.import_entity ?? cfg.export_entity),
    });
  }

  if (src.battery) {
    const cfg = src.battery;
    const available = src.batteryAvailable;
    const charging = result.batteryCharge > 0;
    const soc = hasEntity(cfg.soc_entity) ? readPercentAverage(hass.states, cfg.soc_entity) : undefined;
    const net = result.batteryDischarge - result.batteryCharge;
    const active = net !== 0;
    const eta = available
      ? batteryEta(soc, result.batteryCharge, result.batteryDischarge, cfg.capacity, cfg.min_soc)
      : null;
    nodes.push({
      id: 'battery',
      kind: 'battery',
      name: cfg.name ?? t('node.battery'),
      icon: cfg.icon ?? batteryIcon(soc, charging),
      color: charging ? colors.batteryCharge : colors.battery,
      watts: available ? Math.abs(net) : null,
      available,
      active,
      // With a charge level configured, an idle battery stays visible unless explicitly hidden.
      visible: !(available && !active && (cfg.hide_when_zero ?? (globalHide && soc === undefined))),
      status: eta
        ? t(eta.until === 'full' ? 'state.full_in' : 'state.empty_in', { time: formatDuration(eta.hours) })
        : charging
          ? t('state.charging')
          : result.batteryDischarge > 0
            ? t('state.discharging')
            : t('state.idle'),
      soc,
      secondary: nodeSecondary(hass, cfg, ctx.todayEnergy.get('battery')),
      actions: actionsFor(cfg, cfg.entity ?? cfg.discharge_entity ?? cfg.charge_entity),
    });
  }

  const cfg = src.home;
  const f = result.flows;
  const fromSources = f.solarToHome + f.batteryToHome + f.gridToHome;
  const available = hasEntity(cfg?.entity) ? (src.homeReading?.available ?? false) : true;
  nodes.push({
    id: 'home',
    kind: 'home',
    name: cfg?.name ?? t('node.home'),
    icon: cfg?.icon ?? 'mdi:home-lightning-bolt-outline',
    color: colors.home,
    watts: available ? result.home : null,
    available,
    active: result.home > 0,
    visible: true,
    secondary: nodeSecondary(hass, cfg, ctx.todayEnergy.get('home')),
    mix:
      fromSources > 0
        ? [
            { color: colors.solar, fraction: f.solarToHome / fromSources },
            { color: colors.battery, fraction: f.batteryToHome / fromSources },
            { color: colors.gridImport, fraction: f.gridToHome / fromSources },
          ].filter((s) => s.fraction > 0.004)
        : [],
    actions: actionsFor(cfg, cfg?.entity),
  });

  return nodes;
}
