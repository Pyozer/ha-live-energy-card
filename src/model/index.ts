import { computeFlows, computeRatios } from '../compute';
import { computeStats } from '../cost';
import type { HomeAssistant, LiveEnergyCardConfig } from '../types';
import { modelContext } from './context';
import { buildDevices } from './devices';
import { deviceFlows, sourceFlows } from './flows';
import { readSources, sourceColors, sourceNodes } from './sources';
import type { CardModel } from './types';

export { DEFAULTS, flowScale } from './context';
export { sortWithHysteresis } from './devices';
export { applyDeviceTree, flowToggles } from './flows';
export { cleanName } from './format';
export * from './types';

/**
 * Builds what the card displays from the configuration and the entity states:
 * readings → energy balance → source nodes → device nodes → flows.
 */
export function buildModel(
  config: LiveEnergyCardConfig,
  hass: HomeAssistant,
  previousOrder: string[] = [],
  /** Ids of the expanded device groups. */
  expanded: ReadonlySet<string> = new Set(),
): CardModel {
  const ctx = modelContext(config, hass);
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
      ...deviceFlows(config, devices, colors.home),
    ],
    ratios: config.show_ratios ? computeRatios(result) : null,
    stats: computeStats(result, hass, config.cost, config.carbon?.intensity_entity),
    result,
    devicesOrder: devices.order,
  };
}
