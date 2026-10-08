import { mdiArrowDown, mdiArrowUp, mdiChevronDown, mdiChevronUp, mdiDeleteOutline, mdiPlus } from '@mdi/js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { fireEvent } from '../actions';
import { DEFAULT_TOGGLES } from '../intensity';
import { LANGUAGE_NAMES, localize, SUPPORTED_LANGUAGES, type LocalizeKey } from '../localize/localize';
import { DEFAULTS } from '../model';
import type {
  AnimationToggles,
  BaseNodeConfig,
  DeviceConfig,
  HomeAssistant,
  LiveEnergyCardConfig,
} from '../types';

type Schema = Record<string, unknown>;
type NodeKey = 'solar' | 'grid' | 'battery' | 'home';

const POWER_ENTITY = { entity: { filter: [{ domain: ['sensor', 'input_number', 'number'] }] } };
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
  };

  declare hass?: HomeAssistant;
  declare _config?: LiveEnergyCardConfig;
  declare _expanded: number;

  constructor() {
    super();
    this._expanded = -1;
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

  private _nodeSchema(kind: NodeKey): Schema[] {
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
    const entities: Schema[] = [{ name: 'entity', selector: POWER_ENTITY }];
    if (kind === 'grid') {
      entities.push({
        type: 'grid',
        name: '',
        schema: [
          { name: 'import_entity', selector: POWER_ENTITY },
          { name: 'export_entity', selector: POWER_ENTITY },
        ],
      });
    }
    if (kind === 'battery') {
      entities.push(
        {
          name: 'soc_entity',
          selector: { entity: { filter: [{ domain: ['sensor', 'input_number', 'number'] }] } },
        },
        {
          type: 'grid',
          name: '',
          schema: [
            { name: 'charge_entity', selector: POWER_ENTITY },
            { name: 'discharge_entity', selector: POWER_ENTITY },
          ],
        },
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
            ],
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

  private _deviceSchema(): Schema[] {
    return [
      { name: 'entity', selector: POWER_ENTITY },
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
      return { ...cfg, hide_when_zero: cfg.hide_when_zero ?? this._hideDefault(kind) };
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

  private _deviceChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const devices = this._devices();
    const value = { ...(ev.detail.value as DeviceConfig) };
    const def = this._hideDefault('device');
    if (value.hide_when_zero === def && devices[index]?.hide_when_zero === undefined)
      delete value.hide_when_zero;
    if (value.invert === false) delete value.invert;
    devices[index] = clean(value);
    this._emit({ ...this._config!, devices });
  }

  private _moveDevice(index: number, delta: number): void {
    const devices = this._devices();
    const target = index + delta;
    if (target < 0 || target >= devices.length) return;
    [devices[index], devices[target]] = [devices[target], devices[index]];
    if (this._expanded === index) this._expanded = target;
    this._emit({ ...this._config!, devices });
  }

  private _removeDevice(index: number): void {
    const devices = this._devices();
    devices.splice(index, 1);
    this._expanded = -1;
    this._emit({ ...this._config!, devices });
  }

  private _addDevice(): void {
    const devices = this._devices();
    devices.push({ entity: '' });
    this._expanded = devices.length - 1;
    this._emit({ ...this._config!, devices });
  }

  // --- Render -----------------------------------------------------------------------------------

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;
    const devices = this._config.devices ?? [];
    return html`
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
        ${devices.map((dev, i) => this._renderDevice(dev, i, devices.length))}
        <button class="add" @click=${this._addDevice}>
          <ha-svg-icon .path=${mdiPlus}></ha-svg-icon>${this._t('editor.add_device')}
        </button>
      </div>
    `;
  }

  private _renderDevice(dev: DeviceConfig, index: number, total: number): TemplateResult {
    const expanded = this._expanded === index;
    const state = dev.entity ? this.hass!.states[dev.entity] : undefined;
    const title = dev.name ?? state?.attributes.friendly_name ?? (dev.entity || '—');
    const data = { ...dev, hide_when_zero: dev.hide_when_zero ?? this._hideDefault('device') };
    return html`
      <div class="device ${expanded ? 'expanded' : ''}">
        <div class="device-head">
          <ha-icon .icon=${dev.icon ?? state?.attributes.icon ?? 'mdi:power-plug-outline'}></ha-icon>
          <button class="device-title" @click=${() => (this._expanded = expanded ? -1 : index)}>
            <span>${title}</span>
            <small>${dev.entity}</small>
          </button>
          <ha-icon-button
            .label=${this._t('editor.move_up')}
            .path=${mdiArrowUp}
            .disabled=${index === 0}
            @click=${() => this._moveDevice(index, -1)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${this._t('editor.move_down')}
            .path=${mdiArrowDown}
            .disabled=${index === total - 1}
            @click=${() => this._moveDevice(index, 1)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${this._t('editor.remove')}
            .path=${mdiDeleteOutline}
            @click=${() => this._removeDevice(index)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${this._t('editor.edit')}
            .path=${expanded ? mdiChevronUp : mdiChevronDown}
            @click=${() => (this._expanded = expanded ? -1 : index)}
          ></ha-icon-button>
        </div>
        ${
          expanded
            ? html`<div class="device-body">
                <ha-form
                  .hass=${this.hass}
                  .data=${data}
                  .schema=${this._deviceSchema()}
                  .computeLabel=${this._label}
                  @value-changed=${(ev: CustomEvent) => this._deviceChanged(index, ev)}
                ></ha-form>
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
    .add:hover {
      background: color-mix(in srgb, var(--primary-color) 8%, transparent);
    }
  `;
}

if (!customElements.get('live-energy-card-editor')) {
  customElements.define('live-energy-card-editor', LiveEnergyCardEditor);
}
