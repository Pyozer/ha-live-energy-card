import type { BatteryConfig, BatteryUnitConfig, SolarConfig, SolarUnitConfig } from './types';
import { entityIds } from './units';

/**
 * Units of the solar and battery sources. A source is made of one or several units (inverters,
 * battery packs…), each reading its own entities. Shown as a single bubble, the units are added up;
 * with `separate`, each one has its own bubble.
 */

export type UnitGroup = 'solar' | 'battery';

export interface SourceUnit<C> {
  /** Node id: `solar:0`, `battery:1`… The index is the unit's position in the `units` list. */
  id: string;
  index: number;
  config: C;
}

export const unitId = (group: UnitGroup, index: number): string => `${group}:${index}`;

/** The units of a list that read something: those without an entity are left out, ids unchanged. */
function readable<C extends object>(
  group: UnitGroup,
  units: readonly C[] | undefined,
  hasPower: (unit: C) => boolean,
): SourceUnit<C>[] {
  return (units ?? []).flatMap((config, index) =>
    config && typeof config === 'object' && hasPower(config)
      ? [{ id: unitId(group, index), index, config }]
      : [],
  );
}

export const solarUnits = (node: SolarConfig | undefined): SourceUnit<SolarUnitConfig>[] =>
  readable('solar', node?.units, (unit) => entityIds(unit.entity).length > 0);

/** Entities that carry the power of a battery unit. */
export const unitPowerEntities = (unit: BatteryUnitConfig): string[] =>
  [unit.entity, unit.charge_entity, unit.discharge_entity].flatMap(entityIds);

export const batteryUnits = (node: BatteryConfig | undefined): SourceUnit<BatteryUnitConfig>[] =>
  readable('battery', node?.units, (unit) => unitPowerEntities(unit).length > 0);
