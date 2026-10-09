import {
  mdiAlertOutline,
  mdiArrowDown,
  mdiArrowUp,
  mdiChevronDown,
  mdiChevronUp,
  mdiDeleteOutline,
  mdiFolderPlusOutline,
  mdiLightningBoltCircle,
  mdiPlus,
} from '@mdi/js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { fireEvent } from '../actions';
import { configFromEnergyPrefs, fetchEnergyPrefs, importedCount, mergeEnergyImport } from '../energy';
import { localize, type LocalizeKey } from '../localize/localize';
import type { DeviceConfig, HomeAssistant, LiveEnergyCardConfig } from '../types';
import { entityIds } from '../units';
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
import {
  deviceFormData,
  deviceFromForm,
  fromFormData,
  priceModesOf,
  toFormData,
  type PriceModes,
} from './form';
import { EditorSchema, fieldLabel } from './schema';
import { editorStyles } from './styles';
import { describeIssue, deviceIssues, entityIssues, type EntityIssue } from './validation';

export class LiveEnergyCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _expanded: { state: true },
    _importStatus: { state: true },
    _priceModes: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: LiveEnergyCardConfig;
  /** Path key of the device being edited (`2`, or `2.0` for a group member), empty when none. */
  declare _expanded: string;
  /** Result of the last Energy dashboard import, shown under the button. */
  declare _importStatus?: { ok: boolean; text: string };
  /** Price sources picked in the form, for prices that have no value yet. */
  declare _priceModes: PriceModes;

  constructor() {
    super();
    this._expanded = '';
    this._priceModes = {};
  }

  setConfig(config: LiveEnergyCardConfig): void {
    this._config = config;
  }

  private _t(key: LocalizeKey, vars?: Record<string, string>): string {
    return localize(this.hass?.locale?.language ?? this.hass?.language, key, vars);
  }

  private _schema(): EditorSchema {
    return new EditorSchema((key, vars) => this._t(key, vars), this.hass);
  }

  private _label = (schema: { name: string }): string => fieldLabel((key) => this._t(key), schema.name);

  // --- Data -------------------------------------------------------------------------------------

  private _valueChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const data = ev.detail.value as Record<string, unknown>;
    this._priceModes = priceModesOf(data);
    this._emit(fromFormData(data, this._config!));
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
    const value = deviceFromForm(ev.detail.value, previous, this._config?.hide_when_zero);
    this._setDevices(updateDevice(this._devices(), path, value));
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
    const issues = entityIssues(this._config, this.hass);
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
      ${issues.length ? this._renderIssues(issues) : nothing}
      <ha-form
        .hass=${this.hass}
        .data=${toFormData(this._config, this._priceModes)}
        .schema=${this._schema().card(this._config, this._priceModes)}
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
        ${devices.map((dev, i) => this._renderDevice(dev, [i], devices.length, issues))}
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

  private _renderIssues(issues: EntityIssue[]): TemplateResult {
    const t = (key: LocalizeKey, vars?: Record<string, string>) => this._t(key, vars);
    return html`
      <div class="issues" role="status">
        <div class="issues-title">
          <ha-svg-icon .path=${mdiAlertOutline}></ha-svg-icon>
          ${this._t('editor.issues', { count: String(issues.length) })}
        </div>
        <ul>
          ${issues.map((issue) => {
            const d = describeIssue(issue, this._config!, this.hass, t);
            return html`<li>
              <span class="where">${d.where} · ${d.field}</span>
              <span><code>${issue.entity}</code> ${d.problem}</span>
            </li>`;
          })}
        </ul>
      </div>
    `;
  }

  private _renderDevice(
    dev: DeviceConfig,
    path: DevicePath,
    total: number,
    issues: EntityIssue[],
  ): TemplateResult {
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
    const icon =
      dev.icon ?? state?.attributes.icon ?? (group ? 'mdi:folder-outline' : 'mdi:power-plug-outline');
    const warning = deviceIssues(issues, path).length > 0;
    return html`
      <div class="device ${expanded ? 'expanded' : ''} ${group ? 'group' : ''}">
        <div class="device-head">
          <ha-icon .icon=${icon}></ha-icon>
          <button class="device-title" @click=${toggle}>
            <span>${title}</span>
            <small>${subtitle}</small>
          </button>
          ${warning ? html`<ha-svg-icon class="warning" .path=${mdiAlertOutline}></ha-svg-icon>` : nothing}
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
                  .data=${deviceFormData(dev, this._config!.hide_when_zero)}
                  .schema=${this._schema().device(dev)}
                  .computeLabel=${this._label}
                  @value-changed=${(ev: CustomEvent) => this._deviceChanged(path, ev)}
                ></ha-form>
              </div>`
            : nothing
        }
        ${
          group
            ? html`<div class="members">
                ${members.map((m, j) => this._renderDevice(m, [path[0], j], members.length, issues))}
                <button class="add" @click=${() => this._addDevice(path[0])}>
                  <ha-svg-icon .path=${mdiPlus}></ha-svg-icon>${this._t('editor.add_member')}
                </button>
              </div>`
            : nothing
        }
      </div>
    `;
  }

  static override styles = editorStyles;
}

if (!customElements.get('live-energy-card-editor')) {
  customElements.define('live-energy-card-editor', LiveEnergyCardEditor);
}
