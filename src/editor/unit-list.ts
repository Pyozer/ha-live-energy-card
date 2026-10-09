import type { BatteryConfig, BatteryUnitConfig, SolarConfig } from '../types';
import type { DropTarget } from './device-list';

/**
 * Immutable operations on the units of the solar and battery sources, for the editor. A source
 * (`SolarConfig` / `BatteryConfig`) holds its units in `units`.
 */
type UnitNode = SolarConfig | BatteryConfig;

export const unitsOf = (node: UnitNode | undefined): BatteryUnitConfig[] => node?.units ?? [];

/** Adds an empty unit at the end. */
export function addUnit(node: UnitNode): UnitNode {
  return { ...node, units: [...unitsOf(node), {}] } as UnitNode;
}

/** Replaces a unit. The position just past the end appends: the editor shows an empty first unit. */
export function updateUnit(node: UnitNode, index: number, unit: BatteryUnitConfig): UnitNode {
  const units = [...unitsOf(node)];
  if (index >= 0 && index <= units.length) units[index] = unit;
  return { ...node, units } as UnitNode;
}

/** Removes a unit; the node keeps its (possibly empty) list. */
export function removeUnit(node: UnitNode, index: number): UnitNode {
  return { ...node, units: unitsOf(node).filter((_, i) => i !== index) } as UnitNode;
}

/** Moves the unit at `from` to the position `to` of the list. `null` when it would not move. */
function reorder(node: UnitNode, from: number, to: number): { node: UnitNode; index: number } | null {
  const units = [...unitsOf(node)];
  if (from === to || from < 0 || from >= units.length || to < 0 || to >= units.length) return null;
  units.splice(to, 0, ...units.splice(from, 1));
  return { node: { ...node, units } as UnitNode, index: to };
}

/** Moves a unit by one position (keyboard alternative to dragging). */
export const shiftUnit = (node: UnitNode, index: number, delta: number) =>
  reorder(node, index, index + delta);

/** Drops a unit before or after another one (drag and drop). `null` when it would not move. */
export function dropUnit(node: UnitNode, from: number, target: DropTarget) {
  const at = target.path[0] + (target.position === 'after' ? 1 : 0);
  // The target's position is that of the list before the unit is taken out of it.
  return reorder(node, from, from < at ? at - 1 : at);
}
