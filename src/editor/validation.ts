import { matchesKind, type EntityKind } from '../entities';
import type { BaseNodeConfig, DeviceConfig, EntityRef, HomeAssistant, LiveEnergyCardConfig } from '../types';
import type { UnitGroup } from '../source-units';
import { entityIds } from '../units';
import { isGroup, type DevicePath } from './device-list';
import { NODE_KEYS, PRICE_FIELDS, PRICE_KEYS, type NodeKey } from './form';
import { fieldLabel, type Translate } from './schema';

/**
 * Entity checks shown by the editor: an entity that does not exist (renamed, removed integration)
 * or that does not match its field (an energy counter in a power field…). An unavailable entity is
 * not an issue: it is usually temporary, and the card already flags it.
 */

/** A unit of the solar or battery node, by its position in the node's `units`. */
export interface UnitRef {
  group: UnitGroup;
  index: number;
}

const isUnitRef = (where: EntityIssue['where']): where is UnitRef =>
  typeof where === 'object' && 'group' in where;

export type IssueProblem = 'missing' | 'kind' | 'ignored' | 'ignored_price' | 'no_price';

export interface EntityIssue {
  /** Where the entity is configured: a node, a section, a device (path in the device list) or a unit. */
  where: NodeKey | 'cost' | 'carbon' | DevicePath | UnitRef;
  /** Config field (`entity`, `soc_entity`…). */
  field: string;
  entity: string;
  problem: IssueProblem;
  /** Expected kind, for a `kind` problem. `ignored`: the energy counter, overridden by `secondary_entity`. */
  expected?: EntityKind;
}

/** Fields of a node or a device, with their expected kind (`undefined`: any entity). */
const NODE_FIELDS: [string, EntityKind | undefined][] = [
  ['entity', 'power'],
  ['import_entity', 'power'],
  ['export_entity', 'power'],
  ['charge_entity', 'power'],
  ['discharge_entity', 'power'],
  ['grid_charge_entity', 'power'],
  ['soc_entity', 'percent'],
  ['energy_entity', 'energy'],
  ['export_energy_entity', 'energy'],
  ['secondary_entity', undefined],
];

export function entityIssues(config: LiveEnergyCardConfig, hass: HomeAssistant | undefined): EntityIssue[] {
  if (!hass?.states) return [];
  const issues: EntityIssue[] = [];
  const check = (
    where: EntityIssue['where'],
    field: string,
    ref: EntityRef | undefined,
    kind: EntityKind | undefined,
  ) => {
    for (const entity of entityIds(ref)) {
      const state = hass.states[entity];
      if (!state) issues.push({ where, field, entity, problem: 'missing' });
      else if (kind && !matchesKind(state, kind))
        issues.push({ where, field, entity, problem: 'kind', expected: kind });
    }
  };
  const checkNode = (where: EntityIssue['where'], cfg: BaseNodeConfig | undefined) => {
    const fields = cfg as Record<string, EntityRef | undefined> | undefined;
    for (const [field, kind] of NODE_FIELDS) check(where, field, fields?.[field], kind);
    // The secondary entity replaces today's energy: the counters would never be shown.
    const counters = entityIds(cfg?.energy_entity);
    if (counters.length && cfg?.secondary_entity)
      issues.push({ where, field: 'energy_entity', entity: counters.join(', '), problem: 'ignored' });
  };

  for (const key of NODE_KEYS) checkNode(key, config[key]);
  for (const group of ['solar', 'battery'] as const) {
    (config[group]?.units ?? []).forEach((unit, index) => checkNode({ group, index }, unit));
  }
  (config.devices ?? []).forEach((dev: DeviceConfig, i) => {
    checkNode([i], dev);
    (dev?.devices ?? []).forEach((member, j) => checkNode([i, j], member));
  });
  // A price source is ignored when a stronger one is set: ready-made amount, then price entity.
  for (const key of PRICE_KEYS) {
    const fields = PRICE_FIELDS[key];
    const cost = config.cost;
    const sources = [
      { field: fields.ready as string, value: cost?.[fields.ready] },
      { field: fields.entity as string, value: cost?.[fields.entity] },
      { field: key as string, value: typeof cost?.[key] === 'number' ? String(cost[key]) : undefined },
    ].filter((s) => s.value);
    for (const ignored of sources.slice(1))
      issues.push({ where: 'cost', field: ignored.field, entity: ignored.value!, problem: 'ignored_price' });
  }
  // The solar savings are calculated from the import price: a ready-made cost leaves none to use.
  const cost = config.cost;
  if (cost?.cost_entity && !cost.price_entity && typeof cost.price !== 'number' && !cost.savings_entity) {
    if (config.solar)
      issues.push({ where: 'cost', field: 'cost_entity', entity: cost.cost_entity, problem: 'no_price' });
  }
  check('cost', 'cost_entity', config.cost?.cost_entity, 'money');
  check('cost', 'earnings_entity', config.cost?.earnings_entity, 'money');
  check('cost', 'savings_entity', config.cost?.savings_entity, 'money');
  check('cost', 'price_entity', config.cost?.price_entity, 'price');
  check('cost', 'export_price_entity', config.cost?.export_price_entity, 'price');
  check('carbon', 'intensity_entity', config.carbon?.intensity_entity, 'carbon');
  return issues;
}

/** Issues of the device at `path` (not those of its members). */
export function deviceIssues(issues: readonly EntityIssue[], path: DevicePath): EntityIssue[] {
  return issues.filter(
    (i) =>
      typeof i.where === 'object' &&
      !isUnitRef(i.where) &&
      i.where.length === path.length &&
      i.where.every((v, k) => v === path[k]),
  );
}

/** Issues of a unit of the solar or battery node. */
export function unitIssues(issues: readonly EntityIssue[], group: UnitGroup, index: number): EntityIssue[] {
  return issues.filter((i) => isUnitRef(i.where) && i.where.group === group && i.where.index === index);
}

/** Readable location and problem of an issue, for the editor. */
export function describeIssue(
  issue: EntityIssue,
  config: LiveEnergyCardConfig,
  hass: HomeAssistant | undefined,
  t: Translate,
): { where: string; field: string; problem: string } {
  const at = issue.where;
  let where: string;
  let group = false;
  if (isUnitRef(at)) {
    const unit = config[at.group]?.units?.[at.index];
    const id = entityIds(unit?.entity)[0];
    const friendly = id ? hass?.states[id]?.attributes.friendly_name : undefined;
    where = `${t(`node.${at.group}`)} › ${unit?.name ?? friendly ?? t('editor.unit_n', { n: String(at.index + 1) })}`;
  } else if (typeof at !== 'string') {
    const names: string[] = [];
    let list = config.devices ?? [];
    for (const index of at) {
      const dev = list[index];
      group = isGroup(dev);
      const id = entityIds(dev?.entity)[0];
      const friendly = id ? hass?.states[id]?.attributes.friendly_name : undefined;
      names.push(dev?.name ?? friendly ?? t('editor.device_n', { n: String(index + 1) }));
      list = dev?.devices ?? [];
    }
    where = names.join(' › ');
  } else {
    where = at === 'cost' || at === 'carbon' ? t(`editor.${at}`) : t(`node.${at}`);
  }
  const field = fieldLabel(t, group && issue.field === 'entity' ? 'group_entity' : issue.field);
  const problem =
    issue.problem === 'kind' ? t(`editor.issue.${issue.expected!}`) : t(`editor.issue.${issue.problem}`);
  return { where, field, problem };
}
