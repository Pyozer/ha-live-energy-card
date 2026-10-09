import { entitySelector, type EntityKind } from '../entities';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type LocalizeKey } from '../localize/localize';
import type { UnitGroup } from '../source-units';
import type {
  BatteryUnitConfig,
  DeviceConfig,
  EntityRef,
  HomeAssistant,
  LiveEnergyCardConfig,
} from '../types';
import { isGroup } from './device-list';
import { isUnitGroup, PRICE_FIELDS, priceMode, type NodeKey, type PriceKey, type PriceModes } from './form';

/** `ha-form` schemas of the visual editor. */

export type Schema = Record<string, unknown>;
export type Translate = (key: LocalizeKey, vars?: Record<string, string>) => string;

const ANY_ENTITY = { entity: {} };

export const NODE_ICONS: Record<NodeKey, string> = {
  solar: 'mdi:solar-power-variant',
  grid: 'mdi:transmission-tower',
  battery: 'mdi:home-battery-outline',
  home: 'mdi:home-lightning-bolt-outline',
};

const grid = (schema: Schema[]): Schema => ({ type: 'grid', name: '', schema });

const select = (t: Translate, name: string, values: readonly string[]): Schema => ({
  name,
  selector: {
    select: {
      mode: 'dropdown',
      options: values.map((v) => ({ value: v, label: t(`editor.option.${v}` as LocalizeKey) })),
    },
  },
});

const booleans = (names: readonly string[]): Schema[] =>
  names.map((name) => ({ name, selector: { boolean: {} } }));

const watts = (name: string, min = 0): Schema => ({
  name,
  selector: { number: { min, mode: 'box', unit_of_measurement: 'W' } },
});

const actionsSchema = (t: Translate): Schema => ({
  type: 'expandable',
  name: '',
  flatten: true,
  title: t('editor.field.tap_action'),
  icon: 'mdi:gesture-tap',
  schema: [
    { name: 'tap_action', selector: { ui_action: {} } },
    { name: 'hold_action', selector: { ui_action: {} } },
    { name: 'double_tap_action', selector: { ui_action: {} } },
  ],
});

export class EditorSchema {
  constructor(
    private readonly t: Translate,
    private readonly hass: HomeAssistant | undefined,
  ) {}

  /** Entity selector listing only entities of the expected kind (power, %…). */
  private entity(kind: EntityKind, current: unknown, multiple = false): { entity: object } {
    return entitySelector(this.hass, kind, current as EntityRef | undefined, multiple);
  }

  /**
   * Fields of a node. The solar and battery sources only have their bubble here, as a single one:
   * with `separate`, the bubble is that of each unit. What they read is set on their units.
   */
  node(kind: NodeKey, config: LiveEnergyCardConfig): Schema[] {
    if (!isUnitGroup(kind)) return this.fields(kind, config[kind], config);
    const separate: Schema = { name: 'separate', selector: { boolean: {} } };
    return config[kind]?.separate ? [separate] : [separate, ...this.bubble(kind)];
  }

  /**
   * Fields of a unit of the solar or battery source: what it reads, then its bubble when the source
   * is shown one bubble per unit.
   */
  unit(group: UnitGroup, unit: BatteryUnitConfig, separate: boolean): Schema[] {
    const cfg = unit as Record<string, unknown>;
    const power = (name: string): Schema => ({ name, selector: this.entity('power', cfg[name]) });
    const reads: Schema[] =
      group === 'solar'
        ? [power('entity')]
        : [
            power('entity'),
            grid([power('charge_entity'), power('discharge_entity')]),
            { name: 'soc_entity', selector: this.entity('percent', cfg.soc_entity) },
            grid([
              {
                name: 'capacity',
                selector: { number: { min: 0, step: 0.1, mode: 'box', unit_of_measurement: 'kWh' } },
              },
              {
                name: 'min_soc',
                selector: { number: { min: 0, max: 100, mode: 'box', unit_of_measurement: '%' } },
              },
            ]),
          ];
    return [
      ...reads,
      grid(booleans(['invert'])),
      { name: 'energy_entity', selector: this.entity('energy', cfg.energy_entity) },
      ...(separate ? this.bubble(group) : []),
    ];
  }

  /** What a bubble shows and does: its look, whether it hides at zero, its custom line, its actions. */
  private bubble(kind: UnitGroup): Schema[] {
    return [
      grid([
        { name: 'name', selector: { text: {} } },
        { name: 'icon', selector: { icon: {} } },
        { name: 'color', selector: { ui_color: { include_none: false } } },
        ...(kind === 'battery' ? [{ name: 'charge_color', selector: { ui_color: {} } }] : []),
      ]),
      grid(booleans(['hide_when_zero'])),
      { name: 'secondary_entity', selector: ANY_ENTITY },
      actionsSchema(this.t),
    ];
  }

  /** Fields of the grid and the home. */
  private fields(kind: 'grid' | 'home', node: object | undefined, config: LiveEnergyCardConfig): Schema[] {
    const cfg = (node ?? {}) as Record<string, unknown>;
    const power = (name: string): Schema => ({ name, selector: this.entity('power', cfg[name]) });
    // The main entity accepts several sensors, added up (grid phases…).
    const entities: Schema[] = [{ name: 'entity', selector: this.entity('power', cfg.entity, true) }];
    if (kind === 'grid') {
      entities.push(grid([power('import_entity'), power('export_entity')]), watts('max_import', 0));
      // Only needed by the daily cost.
      if (config.cost?.period === 'day') {
        entities.push({
          name: 'export_energy_entity',
          selector: this.entity('energy', cfg.export_energy_entity, true),
        });
      }
    }
    return [
      ...entities,
      grid([
        { name: 'name', selector: { text: {} } },
        { name: 'icon', selector: { icon: {} } },
        { name: 'color', selector: { ui_color: { include_none: false } } },
        ...(kind === 'grid' ? [{ name: 'export_color', selector: { ui_color: {} } }] : []),
      ]),
      grid(booleans(kind === 'home' ? ['invert'] : ['hide_when_zero', 'invert'])),
      { name: 'energy_entity', selector: this.entity('energy', cfg.energy_entity, true) },
      { name: 'secondary_entity', selector: ANY_ENTITY },
      actionsSchema(this.t),
    ];
  }

  /** A price: its source, then only the matching field (fixed value or entity). */
  private price(config: LiveEnergyCardConfig, key: PriceKey, modes: PriceModes): Schema {
    const mode = priceMode(config.cost, key, modes[key]);
    const fields = PRICE_FIELDS[key];
    return grid([
      select(this.t, `${key}_mode`, ['none', 'fixed', 'entity', fields.readyMode]),
      ...(mode === 'fixed'
        ? [{ name: key, selector: { number: { min: 0, step: 0.0001, mode: 'box' } } }]
        : mode === 'entity'
          ? [{ name: fields.entity, selector: this.entity('price', config.cost?.[fields.entity]) }]
          : mode === fields.readyMode
            ? [{ name: fields.ready, selector: this.entity('money', config.cost?.[fields.ready]) }]
            : []),
    ]);
  }

  card(config: LiveEnergyCardConfig, modes: PriceModes = {}): Schema[] {
    const t = this.t;
    const node = (kind: NodeKey): Schema => ({
      type: 'expandable',
      name: kind,
      title: t(`node.${kind}`),
      icon: NODE_ICONS[kind],
      schema: this.node(kind, config),
    });
    return [
      grid([
        { name: 'title', selector: { text: {} } },
        {
          name: 'language',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: 'auto', label: t('editor.option.language_auto') },
                ...SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] })),
              ],
            },
          },
        },
      ]),
      node('solar'),
      node('grid'),
      node('battery'),
      node('home'),
      {
        type: 'expandable',
        name: '',
        flatten: true,
        title: t('editor.general'),
        icon: 'mdi:tune-variant',
        schema: [
          grid([
            watts('min_power'),
            watts('max_power', 1),
            watts('threshold_w'),
            watts('kilo_threshold'),
            { name: 'decimals', selector: { number: { min: 0, max: 3, mode: 'box' } } },
            { name: 'kilo_decimals', selector: { number: { min: 0, max: 3, mode: 'box' } } },
          ]),
          select(t, 'power_curve', ['sqrt', 'linear', 'log']),
          select(t, 'line_style', ['rounded', 'square', 'curved', 'straight']),
          select(t, 'inactive_flows', ['hide', 'dim']),
          grid([
            select(t, 'devices_layout', ['auto', 'column', 'grid']),
            { name: 'devices_columns', selector: { number: { min: 1, max: 6, mode: 'box' } } },
          ]),
          grid(
            booleans([
              'hide_when_zero',
              'sort_devices',
              'show_untracked',
              'show_ratios',
              'eco_mode',
              'transparent',
            ]),
          ),
        ],
      },
      {
        type: 'expandable',
        name: 'cost',
        title: t('editor.cost'),
        icon: 'mdi:cash',
        schema: [
          select(t, 'period', ['hour', 'day']),
          this.price(config, 'price', modes),
          this.price(config, 'export_price', modes),
          { name: 'currency', selector: { text: {} } },
        ],
      },
      {
        type: 'expandable',
        name: 'carbon',
        title: t('editor.carbon'),
        icon: 'mdi:molecule-co2',
        schema: [
          { name: 'intensity_entity', selector: this.entity('carbon', config.carbon?.intensity_entity) },
        ],
      },
      {
        type: 'expandable',
        name: 'animation',
        title: t('editor.animation'),
        icon: 'mdi:animation-play-outline',
        schema: [grid(booleans(['speed', 'thickness', 'density', 'glow']))],
      },
    ];
  }

  device(dev: DeviceConfig): Schema[] {
    const group = isGroup(dev);
    return [
      // A group's entity is optional (a circuit meter); without it, its members are added up.
      { name: group ? 'group_entity' : 'entity', selector: this.entity('power', dev.entity, true) },
      grid([
        { name: 'name', selector: { text: {} } },
        { name: 'icon', selector: { icon: {} } },
        { name: 'color', selector: { ui_color: {} } },
      ]),
      grid(booleans(['hide_when_zero', 'invert', 'exclude_from_untracked', ...(group ? ['expanded'] : [])])),
      { name: 'energy_entity', selector: this.entity('energy', dev.energy_entity, true) },
      { name: 'secondary_entity', selector: ANY_ENTITY },
      actionsSchema(this.t),
    ];
  }
}

/**
 * Fields shown without a label in the form. The entity pickers next to a source selector already
 * say what they are; their own label would sit above the field and misalign it with the selector.
 */
const UNLABELED_FIELDS: ReadonlySet<string> = new Set([
  'price_entity',
  'export_price_entity',
  'cost_entity',
  'earnings_entity',
]);

/** Label shown by the form: none for the entity pickers of a price source. */
export function formLabel(t: Translate, name: string): string {
  return UNLABELED_FIELDS.has(name) ? '' : fieldLabel(t, name);
}

/** Help text under a field: `editor.helper.<name>`, empty when there is none. */
export function fieldHelper(t: Translate, name: string): string {
  const key = `editor.helper.${name}` as LocalizeKey;
  const text = t(key);
  return text === key ? '' : text;
}

/** Field label: `editor.field.<name>`, or the raw name when there is no translation. */
export function fieldLabel(t: Translate, name: string): string {
  if (!name) return '';
  const key = `editor.field.${name}` as LocalizeKey;
  const text = t(key);
  return text === key ? name : text;
}
