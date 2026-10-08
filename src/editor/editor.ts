import {
  mdiArrowDown,
  mdiArrowUp,
  mdiChevronDown,
  mdiChevronUp,
  mdiDeleteOutline,
  mdiFolderPlusOutline,
  mdiLightningBoltCircle,
  mdiPlus,
} from '@mdi/js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { fireEvent } from '../actions';
import { configFromEnergyPrefs, fetchEnergyPrefs, importedCount, mergeEnergyImport } from '../energy';
import { compactRef, entitySelector, type EntityKind } from '../entities';
import {
  addDevice,
  deviceAt,
  isGroup,
  moveDevice,
  pathKey,
  removeDevice,
  updateDevice,
  type DevicePath,
} from './device-list';
import { entityIds } from '../units';
import { DEFAULT_TOGGLES } from '../intensity';
import { LANGUAGE_NAMES, localize, SUPPORTED_LANGUAGES, type LocalizeKey } from '../localize/localize';
import { DEFAULTS } from '../model';
import type {
  AnimationToggles,
  BaseNodeConfig,
  DeviceConfig,
  EntityRef,
  HomeAssistant,
  LiveEnergyCardConfig,
} from '../types';

type Schema = Record<string, unknown>;
type NodeKey = 'solar' | 'grid' | 'battery' | 'home';

const ANY_ENTITY = { entity: {} };

const actionsSchema = (title: string): Schema => ({
  type: 'expandable',
  name: '',
  flatten: true,
  title,
  icon: 'mdi:gesture-tap',
  schema: [
    { name: 'tap_action', selector: { ui_action: {} } },
    { name: 'hold_action', selector: { ui_action: {} } },
    { name: 'double_tap_action', selector: { ui_action: {} } },
  ],
});

/** Neutral values removed from the config to keep it readable. */
function clean<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (value === undefined || value === null || value === '') delete out[key];
    else if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
      delete out[key];
  }
  return out as T;
}

export class LiveEnergyCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _expanded: { state: true },
    _importStatus: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: LiveEnergyCardConfig;
  /** Path key of the device being edited (`2`, or `2.0` for a group member), empty when none. */
  declare _expanded: string;
  /** Result of the last Energy dashboard import, shown under the button. */
  declare _importStatus?: { ok: boolean; text: string };

  constructor() {
    super();
    this._expanded = '';
  }

  setConfig(config: LiveEnergyCardConfig): void {
    this._config = config;
  }

  private _t(key: LocalizeKey, vars?: Record<string, string>): string {
    return localize(this.hass?.locale?.language ?? this.hass?.language, key, vars);
  }

  private _hideDefault(kind: NodeKey | 'device'): boolean {
    if (kind === 'grid' || kind === 'home') return false;
    return this._config?.hide_when_zero ?? DEFAULTS.hide_when_zero;
  }

  // --- Schemas -----------------------------------------------------------------------------------

  /** Entity selector listing only entities of the expected kind (power, %…). */
  private _entity(kind: EntityKind, current: unknown, multiple = false): Schema {
    return entitySelector(this.hass, kind, current as EntityRef | undefined, multiple);
  }

  private _nodeSchema(kind: NodeKey): Schema[] {
    const cfg = (this._config?.[kind] ?? {}) as Record<string, unknown>;
    const power = (name: string): Schema => ({ name, selector: this._entity('power', cfg[name]) });
    const appearance: Schema = {
      type: 'grid',
      name: '',
      schema: [
        { name: 'name', selector: { text: {} } },
        { name: 'icon', selector: { icon: {} } },
        { name: 'color', selector: { ui_color: { include_none: false } } },
        ...(kind === 'grid' ? [{ name: 'export_color', selector: { ui_color: {} } }] : []),
        ...(kind === 'battery' ? [{ name: 'charge_color', selector: { ui_color: {} } }] : []),
      ],
    };
    // The main entity accepts several sensors, added up (several inverters, phases…).
    const entities: Schema[] = [{ name: 'entity', selector: this._entity('power', cfg.entity, true) }];
    if (kind === 'grid') {
      entities.push({ type: 'grid', name: '', schema: [power('import_entity'), power('export_entity')] });
    }
    if (kind === 'battery') {
      entities.push(
        { name: 'soc_entity', selector: this._entity('percent', cfg.soc_entity) },
        { type: 'grid', name: '', schema: [power('charge_entity'), power('discharge_entity')] },
      );
    }
    const options: Schema = {
      type: 'grid',
      name: '',
      schema: [
        ...(kind === 'home' ? [] : [{ name: 'hide_when_zero', selector: { boolean: {} } }]),
        { name: 'invert', selector: { boolean: {} } },
      ],
    };
    return [
      ...entities,
      appearance,
      options,
      { name: 'secondary_entity', selector: ANY_ENTITY },
      actionsSchema(this._t('editor.field.tap_action')),
    ];
  }

  private _schema(): Schema[] {
    const node = (kind: NodeKey, icon: string): Schema => ({
      type: 'expandable',
      name: kind,
      title: this._t(`node.${kind}` as LocalizeKey),
      icon,
      schema: this._nodeSchema(kind),
    });
    return [
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'title', selector: { text: {} } },
          {
            name: 'language',
            selector: {
              select: {
                mode: 'dropdown',
                options: [
                  { value: 'auto', label: this._t('editor.option.language_auto') },
                  ...SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] })),
                ],
              },
            },
          },
        ],
      },
      node('solar', 'mdi:solar-power-variant'),
      node('grid', 'mdi:transmission-tower'),
      node('battery', 'mdi:home-battery-outline'),
      node('home', 'mdi:home-lightning-bolt-outline'),
      {
        type: 'expandable',
        name: '',
        flatten: true,
        title: this._t('editor.general'),
        icon: 'mdi:tune-variant',
        schema: [
          {
            type: 'grid',
            name: '',
            schema: [
              { name: 'min_power', selector: { number: { min: 0, mode: 'box', unit_of_measurement: 'W' } } },
              { name: 'max_power', selector: { number: { min: 1, mode: 'box', unit_of_measurement: 'W' } } },
              {
                name: 'threshold_w',
                selector: { number: { min: 0, mode: 'box', unit_of_measurement: 'W' } },
              },
              {
                name: 'kilo_threshold',
                selector: { number: { min: 0, mode: 'box', unit_of_measurement: 'W' } },
              },
              { name: 'decimals', selector: { number: { min: 0, max: 3, mode: 'box' } } },
              { name: 'kilo_decimals', selector: { number: { min: 0, max: 3, mode: 'box' } } },
            ],
          },
          {
            name: 'power_curve',
            selector: {
              select: {
                mode: 'dropdown',
                options: (['sqrt', 'linear', 'log'] as const).map((v) => ({
                  value: v,
                  label: this._t(`editor.option.${v}`),
                })),
              },
            },
          },
          {
            name: 'line_style',
            selector: {
              select: {
                mode: 'dropdown',
                options: (['rounded', 'square', 'curved', 'straight'] as const).map((v) => ({
                  value: v,
                  label: this._t(`editor.option.${v}`),
                })),
              },
            },
          },
          {
            name: 'inactive_flows',
            selector: {
              select: {
                mode: 'dropdown',
                options: (['hide', 'dim'] as const).map((v) => ({
                  value: v,
                  label: this._t(`editor.option.${v}`),
                })),
              },
            },
          },
          {
            type: 'grid',
            name: '',
            schema: [
              {
                name: 'devices_layout',
                selector: {
                  select: {
                    mode: 'dropdown',
                    options: (['auto', 'column', 'grid'] as const).map((v) => ({
                      value: v,
                      label: this._t(`editor.option.${v}`),
                    })),
                  },
                },
              },
              { name: 'devices_columns', selector: { number: { min: 1, max: 6, mode: 'box' } } },
            ],
          },
          {
            type: 'grid',
            name: '',
            schema: [
              { name: 'hide_when_zero', selector: { boolean: {} } },
              { name: 'sort_devices', selector: { boolean: {} } },
              { name: 'show_untracked', selector: { boolean: {} } },
              { name: 'show_ratios', selector: { boolean: {} } },
              { name: 'eco_mode', selector: { boolean: {} } },
            ],
          },
        ],
      },
      {
        type: 'expandable',
        name: 'cost',
        title: this._t('editor.cost'),
        icon: 'mdi:cash',
        schema: [
          {
            type: 'grid',
            name: '',
            schema: [
              { name: 'price', selector: { number: { min: 0, step: 0.0001, mode: 'box' } } },
              { name: 'price_entity', selector: this._entity('price', this._config?.cost?.price_entity) },
              { name: 'export_price', selector: { number: { min: 0, step: 0.0001, mode: 'box' } } },
              {
                name: 'export_price_entity',
                selector: this._entity('price', this._config?.cost?.export_price_entity),
              },
            ],
          },
          { name: 'currency', selector: { text: {} } },
        ],
      },
      {
        type: 'expandable',
        name: 'carbon',
        title: this._t('editor.carbon'),
        icon: 'mdi:molecule-co2',
        schema: [
          {
            name: 'intensity_entity',
            selector: this._entity('carbon', this._config?.carbon?.intensity_entity),
          },
        ],
      },
      {
        type: 'expandable',
        name: 'animation',
        title: this._t('editor.animation'),
        icon: 'mdi:animation-play-outline',
        schema: [
          {
            type: 'grid',
            name: '',
            schema: (['speed', 'thickness', 'density', 'glow'] as const).map((k) => ({
              name: k,
              selector: { boolean: {} },
            })),
          },
        ],
      },
    ];
  }

  private _deviceSchema(dev: DeviceConfig): Schema[] {
    const group = isGroup(dev);
    return [
      // A group's entity is optional (a circuit meter); without it, its members are added up.
      { name: group ? 'group_entity' : 'entity', selector: this._entity('power', dev.entity, true) },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'name', selector: { text: {} } },
          { name: 'icon', selector: { icon: {} } },
          { name: 'color', selector: { ui_color: {} } },
        ],
      },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'hide_when_zero', selector: { boolean: {} } },
          { name: 'invert', selector: { boolean: {} } },
          { name: 'exclude_from_untracked', selector: { boolean: {} } },
          ...(group ? [{ name: 'expanded', selector: { boolean: {} } }] : []),
        ],
      },
      { name: 'secondary_entity', selector: ANY_ENTITY },
      actionsSchema(this._t('editor.field.tap_action')),
    ];
  }

  private _label = (schema: { name: string }): string => {
    if (!schema.name) return '';
    const key = `editor.field.${schema.name}` as LocalizeKey;
    const text = this._t(key);
    return text === key ? schema.name : text;
  };

  // --- Data -------------------------------------------------------------------------------------

  /** Displayed data: defaults resolved so toggles reflect the actual behavior. */
  private _formData(): Record<string, unknown> {
    const c = this._config!;
    const node = (kind: NodeKey) => {
      const cfg = (c[kind] ?? {}) as BaseNodeConfig;
      return {
        ...cfg,
        entity: entityIds(cfg.entity),
        hide_when_zero: cfg.hide_when_zero ?? this._hideDefault(kind),
      };
    };
    return {
      ...DEFAULTS,
      ...c,
      solar: node('solar'),
      grid: node('grid'),
      battery: node('battery'),
      home: node('home'),
      animation: { ...DEFAULT_TOGGLES, ...(c.animation ?? {}) },
    };
  }

  private _valueChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const data = ev.detail.value as Record<string, unknown>;
    const next: Record<string, unknown> = { ...data, type: this._config!.type };

    // General options: only write what differs from the defaults.
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (next[key] === value) delete next[key];
    }
    const globalHide = (data.hide_when_zero as boolean | undefined) ?? DEFAULTS.hide_when_zero;

    for (const kind of ['solar', 'grid', 'battery', 'home'] as NodeKey[]) {
      const cfg = { ...((data[kind] as BaseNodeConfig) ?? {}) };
      cfg.entity = compactRef(cfg.entity);
      const def = kind === 'grid' || kind === 'home' ? false : globalHide;
      const previous = (this._config?.[kind] as BaseNodeConfig | undefined)?.hide_when_zero;
      if (cfg.hide_when_zero === def && previous === undefined) delete cfg.hide_when_zero;
      if (cfg.invert === false) delete cfg.invert;
      const cleaned = clean(cfg);
      if (Object.keys(cleaned).length === 0) delete next[kind];
      else next[kind] = cleaned;
    }

    const anim = (data.animation ?? {}) as AnimationToggles;
    const animOut: AnimationToggles = {};
    // Only effects that differ from their default are written (glow is off by default, the
    // others are on).
    for (const k of Object.keys(DEFAULT_TOGGLES) as (keyof AnimationToggles)[]) {
      if (typeof anim[k] === 'boolean' && anim[k] !== DEFAULT_TOGGLES[k]) animOut[k] = anim[k];
    }
    if (Object.keys(animOut).length) next.animation = animOut;
    else delete next.animation;

    for (const key of ['cost', 'carbon'] as const) {
      const cleaned = clean((data[key] ?? {}) as Record<string, unknown>);
      if (Object.keys(cleaned).length) next[key] = cleaned;
      else delete next[key];
    }

    next.devices = this._config?.devices ?? [];
    this._emit(clean(next) as unknown as LiveEnergyCardConfig);
  }

  private _emit(config: LiveEnergyCardConfig): void {
    // `type` first for readable YAML.
    const { type, ...rest } = config;
    this._config = { type, ...rest };
    fireEvent(this, 'config-changed', { config: this._config });
  }

  private _devices(): DeviceConfig[] {
    return [...(this._config?.devices ?? [])];
  }

  private _setDevices(devices: DeviceConfig[]): void {
    this._emit({ ...this._config!, devices });
  }

  private _deviceChanged(path: DevicePath, ev: CustomEvent): void {
    ev.stopPropagation();
    const previous = deviceAt(this._devices(), path);
    const raw = { ...(ev.detail.value as DeviceConfig & { group_entity?: unknown }) };
    const group = isGroup(previous);
    const value: DeviceConfig = { ...raw };
    delete (value as { group_entity?: unknown }).group_entity;
    value.entity = compactRef(group ? raw.group_entity : raw.entity) ?? (group ? undefined : '');
    if (group) value.devices = previous?.devices ?? [];
    const def = this._hideDefault('device');
    if (value.hide_when_zero === def && previous?.hide_when_zero === undefined) delete value.hide_when_zero;
    for (const key of ['invert', 'exclude_from_untracked', 'expanded'] as const) {
      if (value[key] === false) delete value[key];
    }
    this._setDevices(updateDevice(this._devices(), path, clean(value)));
  }

  private _moveDevice(path: DevicePath, delta: number): void {
    const result = moveDevice(this._devices(), path, delta);
    if (this._expanded === pathKey(path)) this._expanded = pathKey(result.path);
    this._setDevices(result.devices);
  }

  private _removeDevice(path: DevicePath): void {
    this._expanded = '';
    this._setDevices(removeDevice(this._devices(), path));
  }

  private _addDevice(group?: number): void {
    const result = addDevice(this._devices(), { entity: '' }, group);
    this._expanded = pathKey(result.path);
    this._setDevices(result.devices);
  }

  private _addGroup(): void {
    const result = addDevice(this._devices(), { name: this._t('node.group'), devices: [] });
    this._expanded = pathKey(result.path);
    this._setDevices(result.devices);
  }

  private async _importEnergy(): Promise<void> {
    const prefs = await fetchEnergyPrefs(this.hass);
    const imported = prefs ? configFromEnergyPrefs(prefs) : undefined;
    const count = imported ? importedCount(imported) : 0;
    if (!imported || count === 0) {
      this._importStatus = { ok: false, text: this._t('editor.import_none') };
      return;
    }
    this._expanded = '';
    this._emit(mergeEnergyImport(this._config!, imported));
    this._importStatus = { ok: true, text: this._t('editor.import_done', { count: String(count) }) };
  }

  // --- Render -----------------------------------------------------------------------------------

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;
    const devices = this._config.devices ?? [];
    return html`
      <div class="import">
        <button class="add" @click=${this._importEnergy}>
          <ha-svg-icon .path=${mdiLightningBoltCircle}></ha-svg-icon>${this._t('editor.import_energy')}
        </button>
        ${
          this._importStatus
            ? html`<span class="import-status ${this._importStatus.ok ? 'ok' : 'error'}"
                >${this._importStatus.text}</span
              >`
            : nothing
        }
      </div>
      <ha-form
        .hass=${this.hass}
        .data=${this._formData()}
        .schema=${this._schema()}
        .computeLabel=${this._label}
        @value-changed=${this._valueChanged}
      ></ha-form>

      <div class="devices">
        <div class="devices-title">
          <ha-icon icon="mdi:power-plug-outline"></ha-icon>
          <span>${this._t('editor.devices')}</span>
          <span class="count">${devices.length}</span>
        </div>
        ${devices.length === 0 ? html`<div class="empty">${this._t('editor.no_devices')}</div>` : nothing}
        ${devices.map((dev, i) => this._renderDevice(dev, [i], devices.length))}
        <div class="actions">
          <button class="add" @click=${() => this._addDevice()}>
            <ha-svg-icon .path=${mdiPlus}></ha-svg-icon>${this._t('editor.add_device')}
          </button>
          <button class="add" @click=${this._addGroup}>
            <ha-svg-icon .path=${mdiFolderPlusOutline}></ha-svg-icon>${this._t('editor.add_group')}
          </button>
        </div>
      </div>
    `;
  }

  private _renderDevice(dev: DeviceConfig, path: DevicePath, total: number): TemplateResult {
    const key = pathKey(path);
    const index = path[path.length - 1];
    const expanded = this._expanded === key;
    const toggle = () => (this._expanded = expanded ? '' : key);
    const group = isGroup(dev);
    const members = dev.devices ?? [];
    const ids = entityIds(dev.entity);
    const state = ids.length ? this.hass!.states[ids[0]] : undefined;
    const title = dev.name ?? state?.attributes.friendly_name ?? (ids[0] || '—');
    const subtitle = group ? this._t('node.group_count', { count: String(members.length) }) : ids.join(', ');
    const data = {
      ...dev,
      [group ? 'group_entity' : 'entity']: ids,
      hide_when_zero: dev.hide_when_zero ?? this._hideDefault('device'),
    };
    const icon =
      dev.icon ?? state?.attributes.icon ?? (group ? 'mdi:folder-outline' : 'mdi:power-plug-outline');
    return html`
      <div class="device ${expanded ? 'expanded' : ''} ${group ? 'group' : ''}">
        <div class="device-head">
          <ha-icon .icon=${icon}></ha-icon>
          <button class="device-title" @click=${toggle}>
            <span>${title}</span>
            <small>${subtitle}</small>
          </button>
          <ha-icon-button
            .label=${this._t('editor.move_up')}
            .path=${mdiArrowUp}
            .disabled=${index === 0}
            @click=${() => this._moveDevice(path, -1)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${this._t('editor.move_down')}
            .path=${mdiArrowDown}
            .disabled=${index === total - 1}
            @click=${() => this._moveDevice(path, 1)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${this._t('editor.remove')}
            .path=${mdiDeleteOutline}
            @click=${() => this._removeDevice(path)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${this._t('editor.edit')}
            .path=${expanded ? mdiChevronUp : mdiChevronDown}
            @click=${toggle}
          ></ha-icon-button>
        </div>
        ${
          expanded
            ? html`<div class="device-body">
                <ha-form
                  .hass=${this.hass}
                  .data=${data}
                  .schema=${this._deviceSchema(dev)}
                  .computeLabel=${this._label}
                  @value-changed=${(ev: CustomEvent) => this._deviceChanged(path, ev)}
                ></ha-form>
              </div>`
            : nothing
        }
        ${
          group
            ? html`<div class="members">
                ${members.map((m, j) => this._renderDevice(m, [path[0], j], members.length))}
                <button class="add" @click=${() => this._addDevice(path[0])}>
                  <ha-svg-icon .path=${mdiPlus}></ha-svg-icon>${this._t('editor.add_member')}
                </button>
              </div>`
            : nothing
        }
      </div>
    `;
  }

  static override styles = css`
    :host {
      display: block;
    }
    .devices {
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .devices-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 500;
      padding: 4px 2px;
    }
    .devices-title ha-icon {
      color: var(--secondary-text-color);
    }
    .count {
      font-size: 12px;
      color: var(--secondary-text-color);
      background: var(--secondary-background-color);
      border-radius: 10px;
      padding: 1px 8px;
    }
    .empty {
      color: var(--secondary-text-color);
      font-size: 14px;
      padding: 4px 2px;
    }
    .device {
      border: 1px solid var(--divider-color);
      border-radius: 12px;
      overflow: hidden;
    }
    .device.expanded {
      border-color: var(--primary-color);
    }
    .device-head {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 4px 4px 12px;
    }
    .device-head > ha-icon {
      color: var(--secondary-text-color);
      flex: none;
    }
    .device-title {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      background: none;
      border: none;
      padding: 4px 8px;
      color: var(--primary-text-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .device-title span,
    .device-title small {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .device-title small {
      color: var(--secondary-text-color);
      font-size: 12px;
    }
    .device-body {
      padding: 4px 12px 12px;
      border-top: 1px solid var(--divider-color);
    }
    .add {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      align-self: flex-start;
      padding: 8px 14px;
      border-radius: 18px;
      border: 1px solid var(--divider-color);
      background: transparent;
      color: var(--primary-color);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
    .import {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 16px;
    }
    .import-status {
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .import-status.error {
      color: var(--error-color, #db4437);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .members {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 8px 10px 20px;
      border-top: 1px solid var(--divider-color);
    }
    .add:hover {
      background: color-mix(in srgb, var(--primary-color) 8%, transparent);
    }
  `;
}

if (!customElements.get('live-energy-card-editor')) {
  customElements.define('live-energy-card-editor', LiveEnergyCardEditor);
}
