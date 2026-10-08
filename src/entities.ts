import type { EntityRef, HassEntity, HomeAssistant } from './types';
import { entityIds, POWER_UNITS } from './units';

/**
 * Entity kinds offered by the visual editor. Each field only lists entities of the matching kind,
 * so a power field cannot point to an energy counter (kWh) or a temperature.
 */
export type EntityKind = 'power' | 'percent' | 'energy' | 'price' | 'carbon';

const DOMAINS = ['sensor', 'input_number', 'number'];
const ENERGY_UNITS = ['Wh', 'kWh', 'MWh', 'GWh'];

const unitOf = (s: HassEntity): string => String(s.attributes.unit_of_measurement ?? '').trim();
const deviceClassOf = (s: HassEntity): string => String(s.attributes.device_class ?? '');

const MATCHERS: Record<EntityKind, (s: HassEntity) => boolean> = {
  power: (s) => deviceClassOf(s) === 'power' || unitOf(s) in POWER_UNITS,
  percent: (s) => deviceClassOf(s) === 'battery' || unitOf(s) === '%',
  energy: (s) => deviceClassOf(s) === 'energy' || ENERGY_UNITS.includes(unitOf(s)),
  // Electricity price: a currency per kWh (€/kWh, EUR/kWh…) or a monetary value.
  price: (s) =>
    (/\/\s*(k|M)?Wh$/i.test(unitOf(s)) && !/co2/i.test(unitOf(s))) || deviceClassOf(s) === 'monetary',
  // Grid carbon intensity (gCO2eq/kWh) or fossil fuel share (%).
  carbon: (s) => /co2/i.test(unitOf(s)) || /co2|carbon|fossil/i.test(s.entity_id),
};

export function matchesKind(entity: HassEntity | undefined, kind: EntityKind): boolean {
  if (!entity) return false;
  const domain = entity.entity_id.split('.')[0];
  return DOMAINS.includes(domain) && MATCHERS[kind](entity);
}

const cache = new WeakMap<object, Partial<Record<EntityKind, string[]>>>();

/** Sorted ids of the entities of a kind. Memoized on the `hass.states` object. */
export function entitiesOfKind(hass: Pick<HomeAssistant, 'states'> | undefined, kind: EntityKind): string[] {
  if (!hass?.states) return [];
  let byKind = cache.get(hass.states);
  if (!byKind) {
    byKind = {};
    cache.set(hass.states, byKind);
  }
  let ids = byKind[kind];
  if (!ids) {
    ids = Object.values(hass.states)
      .filter((s) => matchesKind(s, kind))
      .map((s) => s.entity_id)
      .sort();
    byKind[kind] = ids;
  }
  return ids;
}

/**
 * `ha-form` entity selector restricted to a kind. The current values stay selectable even when they
 * do not match, so an existing configuration is never silently emptied. `multiple` lets a field
 * take several entities, whose values are added up.
 */
export function entitySelector(
  hass: Pick<HomeAssistant, 'states'> | undefined,
  kind: EntityKind,
  current?: EntityRef,
  multiple = false,
): { entity: { include_entities: string[]; multiple?: boolean } } {
  const ids = entitiesOfKind(hass, kind);
  const extra = entityIds(current).filter((id) => !ids.includes(id));
  const include = extra.length ? [...ids, ...extra] : ids;
  return { entity: multiple ? { include_entities: include, multiple: true } : { include_entities: include } };
}

/** Single string for one entity, list for several, `undefined` for none (keeps YAML readable). */
export function compactRef(value: unknown): EntityRef | undefined {
  const ids = entityIds(value as EntityRef);
  if (ids.length === 0) return undefined;
  return ids.length === 1 ? ids[0] : ids;
}
