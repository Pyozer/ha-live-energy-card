import { computeFlows, computeRatios } from '../compute';
import { computeStats } from '../cost';
import type { HomeAssistant, LiveEnergyCardConfig } from '../types';
import { modelContext } from './context';
import { buildDevices } from './devices';
import { deviceFlows, sourceFlows, unitFlows } from './flows';
import { readSources, sourceColors, sourceNodes } from './sources';
import type { CardModel } from './types';

export { DEFAULTS, flowScale } from './context';
export { sortWithHysteresis } from './devices';
export { applyDeviceTree, applyUnitPaths, flowToggles } from './flows';
export { cleanName } from './format';
export * from './types';

export interface BuildOptions {
  /** Previous device order, for the sort hysteresis. */
  previousOrder?: string[];
  /** Ids of the expanded device groups. */
  expanded?: ReadonlySet<string>;
  /** Today's energy (kWh) by node id, from the statistics (`null`: statistics unavailable). */
  todayEnergy?: ReadonlyMap<string, number | null>;
}

/**
 * Builds what the card displays from the configuration and the entity states:
 * readings → energy balance → source nodes → device nodes → flows.
 */
export function buildModel(
  config: LiveEnergyCardConfig,
  hass: HomeAssistant,
  options: BuildOptions = {},
): CardModel {
  const { previousOrder = [], expanded = new Set<string>() } = options;
  const ctx = modelContext(config, hass, options.todayEnergy);
  const src = readSources(config, hass);
  const result = computeFlows(src.inputs, ctx.threshold);
  const colors = sourceColors(src);
  const devices = buildDevices(ctx, result.home, expanded, previousOrder);
  const nodes = [...sourceNodes(ctx, src, result, colors), ...devices.nodes];
  const visible = new Set(nodes.filter((n) => n.visible).map((n) => n.id));

  return {
    nodes,
    flows: [
      ...sourceFlows(config, src, result.flows, colors, visible),
      ...unitFlows(config, src, colors, visible),
      ...deviceFlows(config, devices, colors.home),
    ],
    ratios: config.show_ratios ? computeRatios(result) : null,
    stats: computeStats(result, hass, config.cost, config.carbon?.intensity_entity, ctx.todayEnergy),
    result,
    devicesOrder: devices.order,
  };
}
