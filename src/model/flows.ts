import { thresholded, type Flows } from '../compute';
import { resolveToggles } from '../intensity';
import {
  busCornerRadius,
  sourceFlowPath,
  unitFlowPath,
  usesBus,
  type Layout,
  type SourceFlowId,
} from '../layout';
import type { UnitGroup } from '../source-units';
import { buildDeviceTree } from '../tree';
import { DEFAULT_COLORS, resolveColor } from '../colors';
import type { AnimationToggles, BubbleConfig, LiveEnergyCardConfig } from '../types';
import { DEFAULTS, flowScale, intensityOf, type FlowScale } from './context';
import type { DeviceNodes } from './devices';
import type { SourceColors, SourceReadings } from './sources';
import type { CardModel, FlowModel } from './types';

/** Effects of a flow. Eco mode turns the glow off: its blur is the most expensive effect to draw. */
export function flowToggles(
  config: LiveEnergyCardConfig,
  node?: AnimationToggles,
): Required<AnimationToggles> {
  const toggles = resolveToggles(config.animation, node);
  return config.eco_mode ? { ...toggles, glow: false } : toggles;
}

/** Flows between the sources and the home. A flow needs both ends configured. */
export function sourceFlows(
  config: LiveEnergyCardConfig,
  src: SourceReadings,
  f: Flows,
  colors: SourceColors,
  visible: ReadonlySet<string>,
): FlowModel[] {
  const scale = flowScale(config);
  const nodeCfg: Record<string, BubbleConfig | undefined> = {
    solar: src.solar,
    grid: src.grid,
    battery: src.battery,
  };
  const flows: FlowModel[] = [];
  const flow = (
    id: SourceFlowId,
    from: string,
    to: string,
    watts: number,
    colorFrom: string,
    colorTo: string,
  ) => {
    if (from !== 'home' && !nodeCfg[from]) return;
    if (to !== 'home' && !nodeCfg[to]) return;
    const shown = visible.has(from) && visible.has(to);
    const active = watts > 0 && shown;
    flows.push({
      id,
      from,
      to,
      watts,
      intensity: intensityOf(scale, watts),
      active,
      // The grid ↔ battery path is drawn only once when idle.
      idle: scale.dimIdle && !active && id !== 'battery_grid' && shown,
      colorFrom,
      colorTo,
      toggles: flowToggles(config, nodeCfg[from]?.animation),
      source: id,
    });
  };

  flow('solar_home', 'solar', 'home', f.solarToHome, colors.solar, colors.home);
  flow('solar_battery', 'solar', 'battery', f.solarToBattery, colors.solar, colors.batteryCharge);
  flow('solar_grid', 'solar', 'grid', f.solarToGrid, colors.solar, colors.gridExport);
  flow('grid_home', 'grid', 'home', f.gridToHome, colors.gridImport, colors.home);
  flow('grid_battery', 'grid', 'battery', f.gridToBattery, colors.gridImport, colors.batteryCharge);
  flow('battery_home', 'battery', 'home', f.batteryToHome, colors.battery, colors.home);
  flow('battery_grid', 'battery', 'grid', f.batteryToGrid, colors.battery, colors.gridExport);
  return flows;
}

/**
 * Flows between the units of a source and its hub: the production of each solar unit, the charge
 * and discharge of each battery. The flows leaving the hub carry the total.
 */
export function unitFlows(
  config: LiveEnergyCardConfig,
  src: SourceReadings,
  colors: SourceColors,
  visible: ReadonlySet<string>,
): FlowModel[] {
  const scale = flowScale(config);
  const flows: FlowModel[] = [];
  const flow = (
    group: UnitGroup,
    id: string,
    from: string,
    to: string,
    watts: number,
    [colorFrom, colorTo]: [string, string],
    animation: AnimationToggles | undefined,
    idle: boolean,
  ) => {
    const shown = visible.has(from) && visible.has(to);
    const active = watts > 0 && shown;
    flows.push({
      id,
      from,
      to,
      watts,
      intensity: intensityOf(scale, watts),
      active,
      idle: scale.dimIdle && !active && shown && idle,
      colorFrom,
      colorTo,
      toggles: flowToggles(config, animation),
      source: null,
      feeds: group,
    });
  };

  const threshold = config.threshold_w ?? DEFAULTS.threshold_w;
  const power = (watts: number) => thresholded(watts, threshold);
  if (src.solar?.separate) {
    for (const { unit, value } of src.solarUnits) {
      const color = resolveColor(unit.config.color, DEFAULT_COLORS.solar);
      const watts = power(value);
      flow(
        'solar',
        `feed:${unit.id}`,
        unit.id,
        'solar',
        watts,
        [color, colors.solar],
        unit.config.animation,
        true,
      );
    }
  }
  if (src.battery?.separate) {
    for (const { unit, charge, discharge } of src.batteryUnits) {
      const color = resolveColor(unit.config.color, DEFAULT_COLORS.battery);
      const chargeColor = resolveColor(
        unit.config.charge_color ?? unit.config.color,
        DEFAULT_COLORS.batteryCharge,
      );
      const feed = `feed:${unit.id}`;
      const animation = unit.config.animation;
      flow(
        'battery',
        `${feed}:charge`,
        'battery',
        unit.id,
        power(charge),
        [colors.batteryCharge, chargeColor],
        animation,
        false,
      );
      // The two directions share one path: the idle track is drawn once.
      flow(
        'battery',
        `${feed}:discharge`,
        unit.id,
        'battery',
        power(discharge),
        [color, colors.battery],
        animation,
        true,
      );
    }
  }
  return flows;
}

/** Home → device flows (the other ones link the sources and their units). */
const isDeviceFlow = (f: FlowModel): boolean => f.source === null && !f.feeds;

/** One home → device flow per device. */
export function deviceFlows(
  config: LiveEnergyCardConfig,
  devices: DeviceNodes,
  homeColor: string,
): FlowModel[] {
  const scale = flowScale(config);
  return devices.nodes.map((dev) => {
    // An expanded group only heads its members, which carry the flows.
    const watts = dev.group?.expanded ? 0 : (dev.watts ?? 0);
    const active = watts > 0 && dev.visible;
    return {
      id: `flow:${dev.id}`,
      from: 'home',
      to: dev.id,
      watts,
      intensity: intensityOf(scale, watts),
      active,
      idle: scale.dimIdle && !active && dev.visible,
      colorFrom: homeColor,
      colorTo: dev.color,
      toggles: flowToggles(config, devices.configs.get(dev.id)?.animation),
      source: null,
    };
  });
}

function busFlow(
  config: LiveEnergyCardConfig,
  scale: FlowScale,
  id: string,
  to: string,
  watts: number,
  color: string,
): FlowModel {
  const active = watts > 0;
  return {
    id,
    from: 'home',
    to,
    watts,
    intensity: intensityOf(scale, watts),
    active,
    idle: scale.dimIdle && !active,
    colorFrom: color,
    colorTo: color,
    toggles: flowToggles(config),
    source: null,
  };
}

/**
 * In grid mode, replaces home → device flows with the distribution bus: each segment carries
 * the sum of the devices downstream.
 */
export function applyDeviceTree(model: CardModel, layout: Layout, config: LiveEnergyCardConfig): FlowModel[] {
  const style = config.line_style ?? DEFAULTS.line_style;
  // In column mode, only right-angle styles use the bus; the others draw one line per device.
  if (layout.devices.mode === 'column' && !usesBus(style)) return model.flows;
  const scale = flowScale(config);
  const home = model.nodes.find((n) => n.id === 'home')!;
  // Power carried toward each device (zero for an expanded group, whose members carry it).
  const watts = new Map(model.flows.filter(isDeviceFlow).map((f) => [f.to, f.watts]));
  const byId = new Map(model.flows.map((f) => [f.id, f]));
  const bus = layout.devices.bus;

  const flows = model.flows.filter((f) => !isDeviceFlow(f));
  const used = new Set<string>();
  for (const edge of buildDeviceTree(layout.devices, busCornerRadius(style))) {
    if (edge.leaf) {
      const leaf = byId.get(edge.id);
      if (!leaf) continue;
      used.add(edge.id);
      flows.push({ ...leaf, geometry: edge.geometry });
      continue;
    }
    const total = edge.downstream.reduce((acc, id) => acc + (watts.get(id) ?? 0), 0);
    flows.push({
      ...busFlow(config, scale, edge.id, edge.downstream[0], total, home.color),
      geometry: edge.geometry,
    });
  }
  // Hidden devices: a short segment that fades out with the pill.
  for (const f of model.flows) {
    if (!isDeviceFlow(f) || used.has(f.id)) continue;
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

/** Gives the flows between a unit and its hub their path, which depends on the layout. */
export function applyUnitPaths(
  flows: FlowModel[],
  layout: Layout,
  config: LiveEnergyCardConfig,
): FlowModel[] {
  const style = config.line_style ?? DEFAULTS.line_style;
  return flows.map((flow) => {
    const group = flow.feeds;
    if (!group) {
      // The flows of a hub start on (or end on) the stub of its feeders.
      const source = flow.source;
      if (!source || !(layout.units[flow.from as UnitGroup] || layout.units[flow.to as UnitGroup]))
        return flow;
      return {
        ...flow,
        geometry: (rects) => sourceFlowPath(source, rects, style, layout.size, layout.units),
      };
    }
    const trunk = layout.units[group]?.trunk;
    const towardHub = flow.to === group;
    const unitId = towardHub ? flow.from : flow.to;
    return {
      ...flow,
      geometry: (rects) => {
        const unit = rects[unitId];
        const hub = rects[group];
        return unit && hub && trunk !== undefined
          ? unitFlowPath(unit, hub, trunk, style, layout.size, towardHub)
          : null;
      },
    };
  });
}
