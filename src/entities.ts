import type { EntityRef, HassEntity, HomeAssistant } from './types';
import { entityIds, POWER_UNITS } from './units';

/**
 * Entity kinds offered by the visual editor. Each field only lists entities of the matching kind,
 * so a power field cannot point to an energy counter (kWh) or a temperature.
 */
export type EntityKind = 'power' | 'percent' | 'energy' | 'price' | 'money' | 'carbon';

const DOMAINS = ['sensor', 'input_number', 'number'];
const ENERGY_UNITS = ['Wh', 'kWh', 'MWh', 'GWh'];

const isPowerUnit = (unit: string): boolean => unit in POWER_UNITS || ['w', 'kw'].includes(unit);
/** Carbon intensity of the grid: grams per kWh (`gCO2eq/kWh`, `gCO2/kWh`, `g/kWh`). */
const isCarbonUnit = (unit: string): boolean => /^g\s*(CO2(eq)?)?\s*\/\s*kWh$/i.test(unit);
// Units that are short and free of digits and spaces like a currency, but are not one.
const NOT_CURRENCY = new Set(
  [...Object.keys(POWER_UNITS), ...ENERGY_UNITS, '%', 'V', 'A', 'Hz'].map((u) => u.toLowerCase()),
);
/** A currency: a code (EUR), a symbol (€, kr, zł), possibly per hour. */
const isMoneyUnit = (unit: string): boolean => {
  const match = /^([^\d\s/]{1,4})(\s*\/\s*(h|hour))?$/.exec(unit);
  if (!match) return false;
  const base = match[1];
  return !base.includes('°') && !NOT_CURRENCY.has(base.toLowerCase());
};

const unitOf = (s: HassEntity): string => String(s.attributes.unit_of_measurement ?? '').trim();
const deviceClassOf = (s: HassEntity): string => String(s.attributes.device_class ?? '');

const MATCHERS: Record<EntityKind, (s: HassEntity) => boolean> = {
  // Power, or apparent power (VA / kVA, shown by the card as W / kW).
  power: (s) =>
    deviceClassOf(s) === 'power' || deviceClassOf(s) === 'apparent_power' || isPowerUnit(unitOf(s)),
  percent: (s) => deviceClassOf(s) === 'battery' || unitOf(s) === '%',
  energy: (s) => deviceClassOf(s) === 'energy' || ENERGY_UNITS.includes(unitOf(s)),
  // Electricity price: a currency per kWh (€/kWh, EUR/kWh…) or a monetary value.
  price: (s) =>
    (/\/\s*(k|M)?Wh$/i.test(unitOf(s)) && !/co2/i.test(unitOf(s)) && !isCarbonUnit(unitOf(s))) ||
    deviceClassOf(s) === 'monetary',
  // Ready-made cost: a currency (EUR, €, kr, zł…), possibly per hour, or a monetary value.
  money: (s) => isMoneyUnit(unitOf(s)) || deviceClassOf(s) === 'monetary',
  // Grid carbon intensity, in grams per kWh. Neither an indoor CO2 sensor (ppm) nor the fossil fuel
  // share (%) is one: the card multiplies the import by this value.
  carbon: (s) => isCarbonUnit(unitOf(s)),
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
