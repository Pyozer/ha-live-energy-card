import { batteryEta, combinePacks, formatDuration, type BatteryPack } from '../battery';
import { DEFAULT_COLORS, resolveColor } from '../colors';
import { splitSigned, thresholded, type FlowResult, type SourceInputs } from '../compute';
import {
  batteryUnits,
  solarUnits,
  unitPowerEntities,
  type SourceUnit,
  type UnitGroup,
} from '../source-units';
import type {
  BatteryConfig,
  BatteryUnitConfig,
  BubbleConfig,
  EntityRef,
  GridConfig,
  HomeAssistant,
  HomeConfig,
  LiveEnergyCardConfig,
  SolarConfig,
  SolarUnitConfig,
} from '../types';
import { readPercentAverage, type Reading } from '../units';
import { hasEntity, readRef, type ModelContext } from './context';
import { actionsFor, batteryIcon, cleanName, nodeSecondary } from './format';
import type { NodeModel } from './types';

/** Reading of one solar unit: its power in W (signed, 0 when unavailable). */
export interface SolarUnitReading {
  unit: SourceUnit<SolarUnitConfig>;
  value: number;
  available: boolean;
}

/** Reading of one battery unit, as a net charge or discharge (W), and its charge. */
export interface BatteryUnitReading {
  unit: SourceUnit<BatteryUnitConfig>;
  charge: number;
  discharge: number;
  available: boolean;
  pack: BatteryPack;
}

/** Configured sources (a node without any entity is left out) and their readings. */
export interface SourceReadings {
  solar?: SolarConfig;
  grid?: GridConfig;
  battery?: BatteryConfig;
  home?: HomeConfig;
  /** Units of the solar and battery sources, which exist when the source is configured. */
  solarUnits: SolarUnitReading[];
  batteryUnits: BatteryUnitReading[];
  solarAvailable: boolean;
  homeReading?: Reading;
  gridAvailable: boolean;
  batteryAvailable: boolean;
  /** Input of the energy balance. */
  inputs: SourceInputs;
}

/** Reads a signed entity, or a pair of positive entities (import / export, charge / discharge). */
function readPair(
  hass: HomeAssistant,
  cfg: { entity?: EntityRef; invert?: boolean },
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

const sum = (values: number[]): number => values.reduce((acc, v) => acc + v, 0);

/**
 * Whether a source with several units is readable. As a single bubble, it is only when every unit
 * is: a partial total would be misleading. With a bubble per unit, an unreadable unit is flagged on
 * its own and the others still count.
 */
const readable = (units: { available: boolean }[], separate: boolean | undefined): boolean =>
  units.length > 0 && (separate ? units.some((u) => u.available) : units.every((u) => u.available));

export function readSources(config: LiveEnergyCardConfig, hass: HomeAssistant): SourceReadings {
  const solarList: SolarUnitReading[] = solarUnits(config.solar).map((unit) => {
    const r = readRef(hass, unit.config.entity, unit.config.invert)!;
    return { unit, available: r.available, value: r.value ?? 0 };
  });
  const batteryList: BatteryUnitReading[] = batteryUnits(config.battery).map((unit) => {
    const { discharge_entity, charge_entity, soc_entity, capacity, min_soc } = unit.config;
    const pair = readPair(hass, unit.config, discharge_entity, charge_entity);
    const net = pair.positive - pair.negative;
    return {
      unit,
      available: pair.available,
      charge: Math.max(0, -net),
      discharge: Math.max(0, net),
      pack: {
        soc: hasEntity(soc_entity) ? readPercentAverage(hass.states, soc_entity) : undefined,
        capacity,
        min_soc,
      },
    };
  });
  const g = config.grid;
  const grid =
    g && (hasEntity(g.entity) || hasEntity(g.import_entity) || hasEntity(g.export_entity)) ? g : undefined;
  const home = config.home;

  const solarAvailable = readable(solarList, config.solar?.separate);
  const batteryAvailable = batteryList.length === 0 || readable(batteryList, config.battery?.separate);
  const homeReading = readRef(hass, home?.entity, home?.invert);
  const gridPair = grid ? readPair(hass, grid, grid.import_entity, grid.export_entity) : undefined;
  // Units that cannot be read are left out of the totals.
  const usable = <T extends { available: boolean }>(list: T[], ok: boolean): T[] =>
    ok ? list.filter((u) => u.available) : [];

  return {
    solar: solarList.length ? config.solar : undefined,
    grid,
    battery: batteryList.length ? config.battery : undefined,
    home,
    solarUnits: solarList,
    batteryUnits: batteryList,
    solarAvailable,
    homeReading,
    gridAvailable: gridPair?.available ?? true,
    batteryAvailable,
    inputs: {
      solar: solarAvailable ? sum(usable(solarList, true).map((u) => u.value)) : undefined,
      gridImport: gridPair?.positive,
      gridExport: gridPair?.negative,
      batteryCharge: sum(usable(batteryList, batteryAvailable).map((u) => u.charge)),
      batteryDischarge: sum(usable(batteryList, batteryAvailable).map((u) => u.discharge)),
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

interface NodeLook {
  color: string;
  name: string;
}

/** A solar bubble: the whole source, or one of its units. */
function solarNode(
  ctx: ModelContext,
  id: string,
  bubble: BubbleConfig,
  entity: string | undefined,
  watts: number,
  available: boolean,
  look: NodeLook,
): NodeModel {
  const active = watts > 0;
  return {
    id,
    kind: 'solar',
    name: bubble.name ?? look.name,
    icon: bubble.icon ?? (active ? 'mdi:solar-power-variant' : 'mdi:solar-power-variant-outline'),
    color: look.color,
    watts: available ? watts : null,
    available,
    active,
    visible: !(available && !active && (bubble.hide_when_zero ?? ctx.globalHide)),
    secondary: nodeSecondary(ctx.hass, bubble, ctx.todayEnergy.get(id)),
    actions: actionsFor(bubble, entity),
  };
}

/** A battery bubble: the whole source, or one of its units. */
function batteryNode(
  ctx: ModelContext,
  id: string,
  bubble: BubbleConfig,
  entity: string | undefined,
  pack: BatteryPack,
  power: { charge: number; discharge: number },
  available: boolean,
  look: NodeLook & { chargeColor: string },
): NodeModel {
  const { t, globalHide } = ctx;
  const charging = power.charge > 0;
  const net = power.discharge - power.charge;
  const active = net !== 0;
  const eta = available
    ? batteryEta(pack.soc, power.charge, power.discharge, pack.capacity, pack.min_soc)
    : null;
  return {
    id,
    kind: 'battery',
    name: bubble.name ?? look.name,
    icon: bubble.icon ?? batteryIcon(pack.soc, charging),
    color: charging ? look.chargeColor : look.color,
    watts: available ? Math.abs(net) : null,
    available,
    active,
    // With a charge level configured, an idle battery stays visible unless explicitly hidden.
    visible: !(available && !active && (bubble.hide_when_zero ?? (globalHide && pack.soc === undefined))),
    status: eta
      ? t(eta.until === 'full' ? 'state.full_in' : 'state.empty_in', { time: formatDuration(eta.hours) })
      : charging
        ? t('state.charging')
        : power.discharge > 0
          ? t('state.discharging')
          : t('state.idle'),
    soc: pack.soc,
    secondary: nodeSecondary(ctx.hass, bubble, ctx.todayEnergy.get(id)),
    actions: actionsFor(bubble, entity),
  };
}

/** Default name of a unit: its entity's name, otherwise the source's name and its number. */
function unitName(ctx: ModelContext, group: UnitGroup, unit: SourceUnit<BatteryUnitConfig>): string {
  const entity = unitPowerEntities(unit.config)[0];
  const friendly = ctx.hass.states[entity]?.attributes.friendly_name;
  return cleanName(friendly, `${ctx.t(`node.${group}`)} ${unit.index + 1}`);
}

/** Below the threshold, a power counts as 0. */
const shown = (watts: number, ctx: ModelContext): number => thresholded(watts, ctx.threshold);

/** The solar source as a single bubble, adding up its units. */
function solarSingle(ctx: ModelContext, src: SourceReadings, result: FlowResult, color: string): NodeModel {
  return solarNode(
    ctx,
    'solar',
    src.solar!,
    src.solarUnits[0].unit.config.entity,
    result.solar,
    src.solarAvailable,
    { color, name: ctx.t('node.solar') },
  );
}

/** The battery source as a single bubble, adding up its units. */
function batterySingle(
  ctx: ModelContext,
  src: SourceReadings,
  result: FlowResult,
  colors: SourceColors,
): NodeModel {
  const first = src.batteryUnits[0].unit.config;
  return batteryNode(
    ctx,
    'battery',
    src.battery!,
    first.entity ?? first.discharge_entity ?? first.charge_entity,
    combinePacks(src.batteryUnits.map((u) => u.pack)),
    { charge: result.batteryCharge, discharge: result.batteryDischarge },
    src.batteryAvailable,
    { color: colors.battery, chargeColor: colors.batteryCharge, name: ctx.t('node.battery') },
  );
}

/**
 * A source shown one bubble per unit: its hub (where the units meet, not drawn) followed by one node
 * per unit. The hub carries the total and is visible as long as one unit is.
 */
function unitNodes(
  ctx: ModelContext,
  group: UnitGroup,
  src: SourceReadings,
  result: FlowResult,
  colors: SourceColors,
): NodeModel[] {
  const units =
    group === 'solar'
      ? src.solarUnits.map(({ unit, value, available }) =>
          solarNode(
            ctx,
            unit.id,
            unit.config,
            unit.config.entity,
            shown(Math.max(0, value), ctx),
            available,
            {
              color: resolveColor(unit.config.color, DEFAULT_COLORS.solar),
              name: unitName(ctx, group, unit),
            },
          ),
        )
      : src.batteryUnits.map(({ unit, charge, discharge, available, pack }) =>
          batteryNode(
            ctx,
            unit.id,
            unit.config,
            unit.config.entity ?? unit.config.discharge_entity ?? unit.config.charge_entity,
            pack,
            { charge: shown(charge, ctx), discharge: shown(discharge, ctx) },
            available,
            {
              color: resolveColor(unit.config.color, DEFAULT_COLORS.battery),
              chargeColor: resolveColor(
                unit.config.charge_color ?? unit.config.color,
                DEFAULT_COLORS.batteryCharge,
              ),
              name: unitName(ctx, group, unit),
            },
          ),
        );
  for (const node of units) node.unit = group;
  const available = group === 'solar' ? src.solarAvailable : src.batteryAvailable;
  const total = group === 'solar' ? result.solar : Math.abs(result.batteryDischarge - result.batteryCharge);
  const hub: NodeModel = {
    id: group,
    kind: group,
    name: '',
    icon: '',
    color: colors[group],
    watts: available ? total : null,
    available,
    active: total > 0,
    visible: units.some((u) => u.visible),
    hub: true,
    actions: {},
  };
  return [hub, ...units];
}

/** Solar, grid, battery and home nodes. */
export function sourceNodes(
  ctx: ModelContext,
  src: SourceReadings,
  result: FlowResult,
  colors: SourceColors,
): NodeModel[] {
  const { hass, t } = ctx;
  const nodes: NodeModel[] = [];

  if (src.solar) {
    nodes.push(
      ...(src.solar.separate
        ? unitNodes(ctx, 'solar', src, result, colors)
        : [solarSingle(ctx, src, result, colors.solar)]),
    );
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
      // Signed: positive = import, negative = export (whether one signed entity or an import / export pair).
      watts: available ? net : null,
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
    nodes.push(
      ...(src.battery.separate
        ? unitNodes(ctx, 'battery', src, result, colors)
        : [batterySingle(ctx, src, result, colors)]),
    );
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
