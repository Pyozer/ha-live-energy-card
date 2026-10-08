import { entitySelector, type EntityKind } from '../entities';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type LocalizeKey } from '../localize/localize';
import type { DeviceConfig, EntityRef, HomeAssistant, LiveEnergyCardConfig } from '../types';
import { isGroup } from './device-list';
import type { NodeKey } from './form';

/** `ha-form` schemas of the visual editor. */

export type Schema = Record<string, unknown>;
export type Translate = (key: LocalizeKey, vars?: Record<string, string>) => string;

const ANY_ENTITY = { entity: {} };

const NODE_ICONS: Record<NodeKey, string> = {
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

  node(kind: NodeKey, config: LiveEnergyCardConfig): Schema[] {
    const cfg = (config[kind] ?? {}) as Record<string, unknown>;
    const power = (name: string): Schema => ({ name, selector: this.entity('power', cfg[name]) });
    // The main entity accepts several sensors, added up (several inverters, phases…).
    const entities: Schema[] = [{ name: 'entity', selector: this.entity('power', cfg.entity, true) }];
    if (kind === 'grid') entities.push(grid([power('import_entity'), power('export_entity')]));
    if (kind === 'battery') {
      entities.push(
        { name: 'soc_entity', selector: this.entity('percent', cfg.soc_entity) },
        grid([power('charge_entity'), power('discharge_entity')]),
      );
    }
    return [
      ...entities,
      grid([
        { name: 'name', selector: { text: {} } },
        { name: 'icon', selector: { icon: {} } },
        { name: 'color', selector: { ui_color: { include_none: false } } },
        ...(kind === 'grid' ? [{ name: 'export_color', selector: { ui_color: {} } }] : []),
        ...(kind === 'battery' ? [{ name: 'charge_color', selector: { ui_color: {} } }] : []),
      ]),
      grid(booleans(kind === 'home' ? ['invert'] : ['hide_when_zero', 'invert'])),
      { name: 'secondary_entity', selector: ANY_ENTITY },
      actionsSchema(this.t),
    ];
  }

  card(config: LiveEnergyCardConfig): Schema[] {
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
          grid([
            { name: 'price', selector: { number: { min: 0, step: 0.0001, mode: 'box' } } },
            { name: 'price_entity', selector: this.entity('price', config.cost?.price_entity) },
            { name: 'export_price', selector: { number: { min: 0, step: 0.0001, mode: 'box' } } },
            { name: 'export_price_entity', selector: this.entity('price', config.cost?.export_price_entity) },
          ]),
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
      { name: 'secondary_entity', selector: ANY_ENTITY },
      actionsSchema(this.t),
    ];
  }
}

/** Field label: `editor.field.<name>`, or the raw name when there is no translation. */
export function fieldLabel(t: Translate, name: string): string {
  if (!name) return '';
  const key = `editor.field.${name}` as LocalizeKey;
  const text = t(key);
  return text === key ? name : text;
}
