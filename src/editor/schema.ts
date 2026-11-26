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
import {
  isUnitGroup,
  NODE_KEYS,
  PRICE_FIELDS,
  priceMode,
  savingsMode,
  type NodeKey,
  type PriceKey,
  type PriceModes,
} from './form';
import type { EditorSection } from './validation';

/** `ha-form` schemas of the visual editor. */

export type Schema = Record<string, unknown>;
export type Translate = (key: LocalizeKey, vars?: Record<string, string>) => string;
export type SettingSection = 'display' | 'cost' | 'carbon' | 'animation' | 'advanced';

/**
 * What the form needs to describe a field. Its name is its config key; `label` and `helper` name a
 * label or a help text of its own (`editor.field.<label>`, `editor.helper.<helper>`) where the key
 * alone does not say what the field is for: `max_power` is the scale of the animation for the card,
 * and what a gauge fills up to for a device.
 */
export interface FieldRef {
  name: string;
  label?: string;
  helper?: string;
}

const ANY_ENTITY = { entity: {} };

export const NODE_ICONS: Record<NodeKey, string> = {
  solar: 'mdi:solar-power-variant',
  grid: 'mdi:transmission-tower',
  battery: 'mdi:home-battery-outline',
  home: 'mdi:home-lightning-bolt-outline',
};

export const SECTION_ICONS: Record<EditorSection, string> = {
  ...NODE_ICONS,
  devices: 'mdi:power-plug-outline',
  display: 'mdi:eye-outline',
  cost: 'mdi:cash',
  carbon: 'mdi:molecule-co2',
  animation: 'mdi:animation-play-outline',
  advanced: 'mdi:tune-variant',
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

const watts = (name: string, min = 0, describe: Partial<FieldRef> = {}): Schema => ({
  name,
  ...describe,
  selector: { number: { min, mode: 'box', unit_of_measurement: 'W' } },
});

/** Actions and optional target entity, flattened into a node form or nested under `name` for an indicator. */
const actionsSchema = (t: Translate, name = '', title: LocalizeKey = 'editor.actions'): Schema => ({
  type: 'expandable',
  name,
  ...(name ? {} : { flatten: true }),
  title: t(title),
  icon: 'mdi:gesture-tap',
  schema: [
    { name: 'action_entity', selector: ANY_ENTITY },
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

  /** Switch that shows each inverter or battery as its own bubble. */
  separateToggle(kind: UnitGroup): Schema {
    return { name: 'separate', label: `separate_${kind}`, selector: { boolean: {} } };
  }

  /**
   * Fields of a node. The solar and battery sources only have their bubble here, as a single one:
   * with `separate`, the bubble is that of each unit. What they read is set on their units.
   */
  node(kind: NodeKey, config: LiveEnergyCardConfig): Schema[] {
    if (!isUnitGroup(kind)) return [...this.sourceReads(kind, config[kind]), ...this.sourceAppearance(kind)];
    const separate = this.separateToggle(kind);
    return config[kind]?.separate ? [separate] : [separate, ...this.bubble(kind)];
  }

  /**
   * Fields of a unit of the solar or battery source: what it reads, then its bubble when the source
   * is shown one bubble per unit.
   */
  unit(group: UnitGroup, unit: BatteryUnitConfig, separate: boolean): Schema[] {
    const cfg = unit as Record<string, unknown>;
    const power = (name: string): Schema => ({ name, selector: this.entity('power', cfg[name]) });
    const energy: Schema = {
      name: 'energy_entity',
      helper: 'energy_entity_unit',
      selector: this.entity('energy', cfg.energy_entity),
    };
    // What the unit reads, the essential first; then its bubble.
    const reads: Schema[] =
      group === 'solar'
        ? [
            power('entity'),
            grid(booleans(['invert'])),
            grid([watts('max_power', 0, { helper: 'max_power_solar' }), power('max_power_entity')]),
            energy,
          ]
        : [
            { ...power('entity'), helper: 'battery_entity' },
            grid([power('charge_entity'), power('discharge_entity')]),
            grid(booleans(['invert'])),
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
            energy,
            power('grid_charge_entity'),
          ];
    return [...reads, ...(separate ? this.bubble(group) : [])];
  }

  /** What a bubble shows and does: its look, whether it hides at zero, its custom line, its actions. */
  bubble(kind: UnitGroup): Schema[] {
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

  /** Sensors read by the grid or the home. */
  sourceReads(kind: 'grid' | 'home', node: object | undefined): Schema[] {
    const cfg = (node ?? {}) as Record<string, unknown>;
    const power = (name: string): Schema => ({ name, selector: this.entity('power', cfg[name]) });
    const energy = (name: string): Schema => ({ name, selector: this.entity('energy', cfg[name], true) });
    // The main entity accepts several sensors, added up (grid phases…).
    return [
      { name: 'entity', helper: `${kind}_entity`, selector: this.entity('power', cfg.entity, true) },
      ...(kind === 'grid' ? [grid([power('import_entity'), power('export_entity')])] : []),
      grid(booleans(['invert'])),
      energy('energy_entity'),
      // Shown next to the energy bought on the bubble, and needed by the daily cost.
      ...(kind === 'grid' ? [energy('export_energy_entity'), watts('max_import', 0)] : []),
    ];
  }

  /** Appearance and actions of the grid or the home bubble. */
  sourceAppearance(kind: 'grid' | 'home'): Schema[] {
    return [
      grid([
        { name: 'name', selector: { text: {} } },
        { name: 'icon', selector: { icon: {} } },
        { name: 'color', selector: { ui_color: { include_none: false } } },
        ...(kind === 'grid' ? [{ name: 'export_color', selector: { ui_color: {} } }] : []),
      ]),
      ...(kind === 'grid' ? [grid(booleans(['hide_when_zero']))] : []),
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

  /** The solar savings: computed from the import price, or a ready-made entity. */
  private savings(config: LiveEnergyCardConfig, modes: PriceModes): Schema {
    return grid([
      select(this.t, 'savings_mode', ['calculated', 'savings']),
      ...(savingsMode(config.cost, modes.savings) === 'savings'
        ? [{ name: 'savings_entity', selector: this.entity('money', config.cost?.savings_entity) }]
        : []),
    ]);
  }

  /** The whole form of the card. The editor shows it in parts, between its lists. */
  card(config: LiveEnergyCardConfig, modes: PriceModes = {}): Schema[] {
    return [
      ...this.intro(),
      ...NODE_KEYS.map((kind) => this.source(kind, config)),
      ...this.devicesOptions(),
      ...this.settings(config, modes),
    ];
  }

  /** Title and language of the card. */
  intro(): Schema[] {
    const t = this.t;
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
    ];
  }

  /** The section of a source, used to compose the full card schema. */
  source(kind: NodeKey, config: LiveEnergyCardConfig): Schema {
    return {
      type: 'expandable',
      name: kind,
      title: this.t(`node.${kind}`),
      icon: NODE_ICONS[kind],
      schema: this.node(kind, config),
    };
  }

  /** How the devices are laid out and sorted: shown directly inside the Devices panel. */
  devicesOptions(): Schema[] {
    const t = this.t;
    return [
      grid([
        select(t, 'devices_layout', ['auto', 'column', 'grid']),
        { name: 'devices_columns', selector: { number: { min: 1, max: 6, mode: 'box' } } },
      ]),
      grid(booleans(['sort_devices', 'show_untracked'])),
    ];
  }

  /** Fields of one card-wide settings panel. */
  setting(section: SettingSection, config: LiveEnergyCardConfig, modes: PriceModes = {}): Schema[] {
    const t = this.t;
    switch (section) {
      case 'display':
        return [
          { name: 'hide_when_zero', helper: 'hide_when_zero_card', selector: { boolean: {} } },
          grid(booleans(['show_ratios', 'compact', 'small_bubbles', 'transparent'])),
          select(t, 'line_style', ['rounded', 'square', 'curved', 'straight']),
          select(t, 'inactive_flows', ['hide', 'dim']),
        ];
      case 'cost':
        return [
          select(t, 'period', ['hour', 'day']),
          this.price(config, 'price', modes),
          this.price(config, 'export_price', modes),
          this.savings(config, modes),
          { name: 'currency', selector: { text: {} } },
          actionsSchema(this.t, 'cost_actions', 'editor.field.cost_actions'),
          actionsSchema(this.t, 'savings_actions', 'editor.field.savings_actions'),
        ];
      case 'carbon':
        return [
          { name: 'intensity_entity', selector: this.entity('carbon', config.carbon?.intensity_entity) },
          actionsSchema(this.t, 'actions', 'editor.field.carbon_actions'),
        ];
      case 'animation':
        return [grid(booleans(['speed', 'thickness', 'density', 'glow']))];
      case 'advanced':
        return [
          // The scale of the animation: `max_power` is also what a gauge fills up to elsewhere.
          grid([
            watts('min_power', 0, { label: 'scale_min' }),
            watts('max_power', 1, { label: 'scale_max' }),
          ]),
          select(t, 'power_curve', ['sqrt', 'linear', 'log']),
          grid([
            watts('threshold_w'),
            watts('kilo_threshold'),
            { name: 'decimals', selector: { number: { min: 0, max: 3, mode: 'box' } } },
            { name: 'kilo_decimals', selector: { number: { min: 0, max: 3, mode: 'box' } } },
          ]),
          grid(booleans(['eco_mode'])),
        ];
    }
  }

  /** Options of the card as a whole: the common ones first, the fine tuning last. */
  settings(config: LiveEnergyCardConfig, modes: PriceModes = {}): Schema[] {
    const sections: { key: SettingSection; nested?: boolean }[] = [
      { key: 'display' },
      { key: 'cost', nested: true },
      { key: 'carbon', nested: true },
      { key: 'animation', nested: true },
      { key: 'advanced' },
    ];
    return sections.map(({ key, nested }) => ({
      type: 'expandable',
      name: nested ? key : '',
      ...(nested ? {} : { flatten: true }),
      title: this.t(`editor.${key}`),
      icon: SECTION_ICONS[key],
      schema: this.setting(key, config, modes),
    }));
  }

  device(dev: DeviceConfig): Schema[] {
    const group = isGroup(dev);
    return [
      // A group's entity is optional (a circuit meter); without it, its members are added up.
      { name: group ? 'group_entity' : 'entity', selector: this.entity('power', dev.entity, true) },
      grid([
        watts('max_power', 0, { helper: 'max_power_device' }),
        { name: 'max_power_entity', selector: this.entity('power', dev.max_power_entity) },
      ]),
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
  'savings_entity',
]);

/** Label shown by the form: none for the entity pickers of a price source. */
export function formLabel(t: Translate, field: FieldRef): string {
  return UNLABELED_FIELDS.has(field.name) ? '' : fieldLabel(t, field.label ?? field.name);
}

/** Help text under a field: `editor.helper.<helper, label or name>`, empty when there is none. */
export function fieldHelper(t: Translate, field: FieldRef): string {
  const key = `editor.helper.${field.helper ?? field.label ?? field.name}` as LocalizeKey;
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
