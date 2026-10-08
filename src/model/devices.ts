import { DEFAULT_COLORS, resolveColor } from '../colors';
import { untrackedPower } from '../compute';
import type { DeviceConfig } from '../types';
import { entityIds, readPowerSum, type Reading } from '../units';
import type { ModelContext } from './context';
import { actionsFor, cleanName, formatSecondary } from './format';
import { TOGGLE_GROUP, UNTRACKED_ID, type NodeModel } from './types';

export interface DeviceNodes {
  /** Device nodes: top-level devices, group members and the untracked node. */
  nodes: NodeModel[];
  /** Configuration of each device node, for its flow. */
  configs: Map<string, DeviceConfig>;
  /** Display order: top-level devices (optionally sorted), each group followed by its members. */
  order: string[];
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

/**
 * Device nodes, device groups (with their members, shown when expanded) and the "untracked" node,
 * which gets what the home consumes beyond the devices.
 */
export function buildDevices(
  ctx: ModelContext,
  home: number,
  expanded: ReadonlySet<string>,
  previousOrder: string[],
): DeviceNodes {
  const { config, hass, t, threshold, globalHide } = ctx;
  const nodes: NodeModel[] = [];
  const configs = new Map<string, DeviceConfig>();
  /** Power subtracted from the home to get the untracked node. */
  const tracked: number[] = [];
  /** Members of each group, in display order. */
  const groupChildren = new Map<string, string[]>();

  const deviceNode = (dev: DeviceConfig, id: string, reading: Reading, fallbackName: string): NodeModel => {
    const ids = entityIds(dev.entity);
    const watts = reading.available ? Math.max(0, reading.value ?? 0) : null;
    const value = watts !== null && watts >= threshold ? watts : 0;
    const active = value > 0;
    configs.set(id, dev);
    return {
      id,
      kind: 'device',
      name:
        dev.name ??
        (ids.length ? cleanName(hass.states[ids[0]]?.attributes.friendly_name, ids[0]) : fallbackName),
      icon:
        dev.icon ?? (hass.states[ids[0]]?.attributes.icon as string | undefined) ?? 'mdi:power-plug-outline',
      color: resolveColor(dev.color, DEFAULT_COLORS.device),
      watts: watts === null ? null : value,
      available: reading.available,
      active,
      visible: !(reading.available && !active && (dev.hide_when_zero ?? globalHide)),
      secondary: formatSecondary(hass, dev.secondary_entity),
      actions: actionsFor(dev, dev.entity),
    };
  };
  const read = (dev: DeviceConfig): Reading => readPowerSum(hass.states, dev.entity, dev.invert);

  (config.devices ?? []).forEach((dev, index) => {
    if (!dev) return;
    const id = `device:${index}`;
    const members = (dev.devices ?? []).filter((c) => c && entityIds(c.entity).length > 0);
    if (members.length === 0) {
      if (entityIds(dev.entity).length === 0) return;
      const node = deviceNode(dev, id, read(dev), id);
      if (!dev.exclude_from_untracked) tracked.push(node.watts ?? 0);
      nodes.push(node);
      return;
    }

    // Group: its own entity when it has one (e.g. a circuit meter), otherwise the sum of its members.
    const isExpanded = expanded.has(id);
    const children = members.map((child, j) => deviceNode(child, `${id}:${j}`, read(child), `${id}:${j}`));
    const total: Reading = entityIds(dev.entity).length
      ? read(dev)
      : children.every((c) => c.available)
        ? { value: children.reduce((acc, c) => acc + (c.watts ?? 0), 0), available: true }
        : { value: null, available: false };
    const group = deviceNode(dev, id, total, t('node.group'));
    group.icon = dev.icon ?? 'mdi:folder-outline';
    group.group = { expanded: isExpanded, count: children.length };
    group.secondary ??= t('node.group_count', { count: String(children.length) });
    // Tapping a group expands or collapses it, unless another action is configured.
    group.actions = { ...group.actions, tap_action: dev.tap_action ?? { action: TOGGLE_GROUP } };
    if (!dev.exclude_from_untracked) tracked.push(group.watts ?? 0);
    nodes.push(group);
    for (const child of children) {
      child.parent = id;
      child.visible = child.visible && isExpanded && group.visible;
      nodes.push(child);
    }
    groupChildren.set(
      id,
      children.map((c) => c.id),
    );
  });

  const topLevel = nodes.filter((d) => !d.parent);
  let topOrder = topLevel.map((d) => d.id);
  if (config.sort_devices) {
    topOrder = sortWithHysteresis(
      topLevel.map((d) => ({ id: d.id, watts: d.watts ?? -1 })),
      previousOrder.filter((id) => topOrder.includes(id)),
    );
  }
  const order = topOrder.flatMap((id) => [id, ...(groupChildren.get(id) ?? [])]);

  if (config.show_untracked) {
    const rest = untrackedPower(home, tracked);
    const value = rest >= threshold ? rest : 0;
    nodes.push({
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
    order.push(UNTRACKED_ID);
  }

  return { nodes, configs, order };
}
