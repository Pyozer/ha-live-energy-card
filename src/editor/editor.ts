import {
  mdiAlertOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiDeleteOutline,
  mdiDragVertical,
  mdiFolderPlusOutline,
  mdiLightningBoltCircle,
  mdiPlus,
} from '@mdi/js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { fireEvent } from '../actions';
import { configFromEnergyPrefs, fetchEnergyPrefs, importedCount, mergeEnergyImport } from '../energy';
import { localize, type LocalizeKey } from '../localize/localize';
import { groupCount } from '../model';
import type { UnitGroup } from '../source-units';
import type { BatteryConfig, DeviceConfig, HomeAssistant, LiveEnergyCardConfig, SolarConfig } from '../types';
import { entityIds } from '../units';
import {
  addDevice,
  canReorder,
  deviceAt,
  dropDevice,
  findDevice,
  isGroup,
  moveDevice,
  parsePathKey,
  pathKey,
  removeDevice,
  updateDevice,
  type DevicePath,
} from './device-list';
import { dropTargetAt } from './drag';
import { DragController, measureBlocks } from './drag-controller';
import {
  deviceFormData,
  deviceFromForm,
  fromFormData,
  mergeFormData,
  NESTED_SECTIONS,
  priceModesOf,
  toFormData,
  type NestedSection,
  type PriceModes,
} from './form';
import {
  EditorSchema,
  fieldHelper,
  formLabel,
  SECTION_ICONS,
  type FieldRef,
  type Schema,
  type SettingSection,
} from './schema';
import { editorStyles } from './styles';
import { EDITOR_GROUPS, sectionSummary, showSeparateToggle, toggleSection } from './summary';
import './unit-editor';
import { unitsOf } from './unit-list';
import {
  describeIssue,
  deviceIssues,
  entityIssues,
  sectionIssues,
  type EditorSection,
  type EntityIssue,
} from './validation';

export class LiveEnergyCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _expanded: { state: true },
    _openSections: { state: true },
    _importStatus: { state: true },
    _priceModes: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: LiveEnergyCardConfig;
  /** Path key of the device being edited (`2`, or `2.0` for a group member), empty when none. */
  declare _expanded: string;
  /** Collapsible top-level sections currently open (all closed by default). */
  declare _openSections: ReadonlySet<EditorSection>;
  /** Result of the last Energy dashboard import, shown under the button. */
  declare _importStatus?: { ok: boolean; text: string };
  /** Price sources picked in the form, for prices that have no value yet. */
  declare _priceModes: PriceModes;
  /** Drag and drop of the devices, among the top level and the groups. */
  private readonly _drag = new DragController(this, {
    list: () => this.renderRoot.querySelector<HTMLElement>('.devices'),
    target: (source, y) => {
      const devices = this._devices();
      const path = parsePathKey(source);
      const target = dropTargetAt(
        measureBlocks(this.renderRoot.querySelector('.devices')),
        y,
        isGroup(deviceAt(devices, path)),
      );
      return target && dropDevice(devices, path, target) ? target : undefined;
    },
    drop: (source, target) => {
      const before = this._devices();
      const result = dropDevice(before, parsePathKey(source), target);
      if (!result) return;
      this._followExpanded(before, result.devices);
      this._setDevices(result.devices);
    },
  });

  constructor() {
    super();
    this._expanded = '';
    this._openSections = new Set();
    this._priceModes = {};
  }

  setConfig(config: LiveEnergyCardConfig): void {
    this._config = config;
  }

  private _t = (key: LocalizeKey, vars?: Record<string, string>): string =>
    localize(this.hass?.locale?.language ?? this.hass?.language, key, vars);

  private _schema(): EditorSchema {
    return new EditorSchema(this._t, this.hass);
  }

  private _label = (field: FieldRef): string => formLabel(this._t, field);

  private _helper = (field: FieldRef): string => fieldHelper(this._t, field);

  // --- Data -------------------------------------------------------------------------------------

  private _valueChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const section = ((ev.currentTarget as HTMLElement | null)?.dataset.section || undefined) as
      NestedSection | undefined;
    const data = mergeFormData(this._config!, this._priceModes, ev.detail.value, section);
    this._priceModes = priceModesOf(data);
    this._emit(fromFormData(data, this._config!));
  }

  private _toggleSection(ev: Event): void {
    const section = (ev.currentTarget as HTMLElement).dataset.section as EditorSection;
    this._openSections = toggleSection(this._openSections, section);
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

  /** Keeps the device being edited open after the list changed (by identity: its path may differ). */
  private _followExpanded(before: DeviceConfig[], after: DeviceConfig[]): void {
    const open = this._expanded ? deviceAt(before, parsePathKey(this._expanded)) : undefined;
    const path = open ? findDevice(after, open) : undefined;
    this._expanded = path ? pathKey(path) : '';
  }

  /** Keyboard alternative to dragging: arrows move the device within its list. */
  private async _dragKey(ev: KeyboardEvent, path: DevicePath): Promise<void> {
    const delta = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    ev.preventDefault();
    const result = moveDevice(this._devices(), path, delta);
    if (pathKey(result.path) === pathKey(path)) return;
    this._followExpanded(this._devices(), result.devices);
    this._setDevices(result.devices);
    // The list is re-rendered in place: put the focus back on the moved device's handle.
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`[data-path="${pathKey(result.path)}"] .handle`)?.focus();
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
    const issues = entityIssues(this._config, this.hass);
    const schema = this._schema();
    return html`
      <div class="import">
        <button type="button" class="add" @click=${this._importEnergy}>
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
      ${issues.length ? this._renderIssues(issues) : nothing} ${this._form(schema.intro())}
      ${EDITOR_GROUPS.map(
        (group) => html`
          <div class="group-title">${this._t(group.title)}</div>
          <div class="panels">
            ${group.sections.map((s) => this._renderPanel(s.id, this._t(s.title), schema, issues))}
          </div>
        `,
      )}
    `;
  }

  /** A uniform collapsible panel with icon, title, live summary, optional warning badge and chevron. */
  private _renderPanel(
    section: EditorSection,
    title: string,
    schema: EditorSchema,
    issues: EntityIssue[],
  ): TemplateResult {
    const open = this._openSections.has(section);
    const summary = sectionSummary(section, this._config!, this.hass, this._t);
    const warning = sectionIssues(issues, section).length > 0;
    return html`
      <div class="panel ${open ? 'open' : ''}">
        <button
          type="button"
          class="panel-head"
          data-section=${section}
          aria-expanded=${open ? 'true' : 'false'}
          @click=${this._toggleSection}
        >
          <ha-icon .icon=${SECTION_ICONS[section]}></ha-icon>
          <span class="panel-text">
            <span class="panel-title">${title}</span>
            ${summary ? html`<span class="panel-summary">${summary}</span>` : nothing}
          </span>
          ${warning ? html`<ha-svg-icon class="warning" .path=${mdiAlertOutline}></ha-svg-icon>` : nothing}
          <ha-svg-icon class="chevron" .path=${open ? mdiChevronUp : mdiChevronDown}></ha-svg-icon>
        </button>
        ${open ? html`<div class="panel-body">${this._renderPanelBody(section, schema, issues)}</div>` : nothing}
      </div>
    `;
  }

  private _renderPanelBody(
    section: EditorSection,
    schema: EditorSchema,
    issues: EntityIssue[],
  ): TemplateResult {
    if (section === 'devices') return this._renderDevices(schema, issues);
    if (section === 'grid' || section === 'home') {
      return html`
        ${this._form(schema.sourceReads(section, this._config![section]), section)}
        <div class="sub-heading">${this._t('editor.appearance')}</div>
        ${this._form(schema.sourceAppearance(section), section)}
      `;
    }
    if (section === 'solar' || section === 'battery') {
      const group: UnitGroup = section;
      const source = this._config![group];
      return html`
        <live-energy-card-unit-editor
          .hass=${this.hass}
          .group=${group}
          .source=${source}
          .hideWhenZero=${this._config!.hide_when_zero}
          .issues=${issues}
          @units-changed=${(ev: CustomEvent<{ node: SolarConfig | BatteryConfig }>) =>
            this._emit({ ...this._config!, [group]: ev.detail.node })}
        ></live-energy-card-unit-editor>
        ${showSeparateToggle(source) ? html`<div class="unit-toggle">${this._form([schema.separateToggle(group)], group)}</div>` : nothing}
        ${
          unitsOf(source).length > 0 && !source?.separate
            ? html`
                <div class="sub-heading">${this._t('editor.appearance')}</div>
                ${this._form(schema.bubble(group), group)}
              `
            : nothing
        }
      `;
    }
    const nested = NESTED_SECTIONS.has(section) ? (section as NestedSection) : undefined;
    return this._form(schema.setting(section as SettingSection, this._config!, this._priceModes), nested);
  }

  /**
   * A part of the card form. Root sections edit the full form data; nested sections (`solar`,
   * `grid`, `cost`…) edit only their own sub-object and merge it back in `_valueChanged`.
   */
  private _form(schema: Schema[], section?: NestedSection): TemplateResult {
    const data = toFormData(this._config!, this._priceModes);
    return html`<ha-form
      data-section=${section ?? ''}
      .hass=${this.hass}
      .data=${section ? data[section] : data}
      .schema=${schema}
      .computeLabel=${this._label}
      .computeHelper=${this._helper}
      @value-changed=${this._valueChanged}
    ></ha-form>`;
  }

  /** Body of the devices panel: the reorderable list of devices and groups, then layout and sorting. */
  private _renderDevices(schema: EditorSchema, issues: EntityIssue[]): TemplateResult {
    const devices = this._config!.devices ?? [];
    return html`
      <div class="devices ${this._drag.dragging ? 'lifting' : ''}">
        ${devices.length === 0 ? html`<div class="empty">${this._t('editor.no_devices')}</div>` : nothing}
        ${devices.map((dev, i) => this._renderEntry(dev, [i], issues))}
        <div class="actions">
          <button type="button" class="add" @click=${() => this._addDevice()}>
            <ha-svg-icon .path=${mdiPlus}></ha-svg-icon>${this._t('editor.add_device')}
          </button>
          <button type="button" class="add" @click=${this._addGroup}>
            <ha-svg-icon .path=${mdiFolderPlusOutline}></ha-svg-icon>${this._t('editor.add_group')}
          </button>
        </div>
      </div>
      <div class="sub-heading">${this._t('editor.devices_options')}</div>
      ${this._form(schema.devicesOptions())}
    `;
  }

  private _renderIssues(issues: EntityIssue[]): TemplateResult {
    return html`
      <div class="issues" role="status">
        <div class="issues-title">
          <ha-svg-icon .path=${mdiAlertOutline}></ha-svg-icon>
          ${this._t('editor.issues', { count: String(issues.length) })}
        </div>
        <ul>
          ${issues.map((issue) => {
            const d = describeIssue(issue, this._config!, this.hass, this._t);
            return html`<li>
              <span class="where">${d.where} · ${d.field}</span>
              <span><code>${issue.entity}</code> ${d.problem}</span>
            </li>`;
          })}
        </ul>
      </div>
    `;
  }

  /** The gap showing where the dragged device would land. */
  private _slot(key: string, where: 'before' | 'after' | 'into'): TemplateResult | typeof nothing {
    const { dragging, target, slotHeight } = this._drag;
    if (!dragging) return nothing;
    // Without a valid drop, the gap stays where the device was lifted from.
    const here = target
      ? target.position === where && pathKey(target.path) === key
      : where === 'after' && key === dragging;
    return here ? html`<div class="drop-slot" style="height: ${slotHeight}px"></div>` : nothing;
  }

  /** A device and the gaps around it. The three parts stay put while dragging, so the DOM does too. */
  private _renderEntry(dev: DeviceConfig, path: DevicePath, issues: EntityIssue[]): TemplateResult {
    const key = pathKey(path);
    return html`${this._slot(key, 'before')}${this._renderDevice(dev, path, issues)}${this._slot(key, 'after')}`;
  }

  private _renderDevice(dev: DeviceConfig, path: DevicePath, issues: EntityIssue[]): TemplateResult {
    const key = pathKey(path);
    const expanded = this._expanded === key;
    const toggle = () => (this._expanded = expanded ? '' : key);
    const group = isGroup(dev);
    const members = dev.devices ?? [];
    const ids = entityIds(dev.entity);
    const state = ids.length ? this.hass!.states[ids[0]] : undefined;
    const title = dev.name ?? state?.attributes.friendly_name ?? (ids[0] || '—');
    const subtitle = group ? groupCount(this._t, members.length) : ids.join(', ');
    const icon =
      dev.icon ?? state?.attributes.icon ?? (group ? 'mdi:folder-outline' : 'mdi:power-plug-outline');
    const warning = deviceIssues(issues, path).length > 0;
    const reorderable = canReorder(this._config!.sort_devices, path);
    const dragLabel = this._t(reorderable ? 'editor.drag' : 'editor.drag_sorted');
    const { target } = this._drag;
    const into = target?.position === 'into' && pathKey(target.path) === key;
    return html`
      <div
        class="device ${expanded ? 'expanded' : ''} ${group ? 'group' : ''} ${into ? 'drop-into' : ''} ${
          this._drag.dragging === key ? 'lifted' : ''
        }"
        data-path=${key}
      >
        <div class="device-head">
          <button
            class="handle"
            ?disabled=${!reorderable}
            .title=${dragLabel}
            aria-label=${dragLabel}
            @pointerdown=${(ev: PointerEvent) => this._drag.start(ev, pathKey(path))}
            @pointermove=${(ev: PointerEvent) => this._drag.move(ev)}
            @pointerup=${(ev: PointerEvent) => this._drag.end(ev)}
            @pointercancel=${(ev: PointerEvent) => this._drag.end(ev, true)}
            @keydown=${(ev: KeyboardEvent) => this._dragKey(ev, path)}
          >
            <ha-svg-icon .path=${mdiDragVertical}></ha-svg-icon>
          </button>
          <ha-icon .icon=${icon}></ha-icon>
          <button class="device-title" @click=${toggle}>
            <span>${title}</span>
            <small>${subtitle}</small>
          </button>
          ${warning ? html`<ha-svg-icon class="warning" .path=${mdiAlertOutline}></ha-svg-icon>` : nothing}
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
                  .computeHelper=${this._helper}
                  @value-changed=${(ev: CustomEvent) => this._deviceChanged(path, ev)}
                ></ha-form>
              </div>`
            : nothing
        }
        ${
          group
            ? html`<div class="members">
                ${members.map((m, j) => this._renderEntry(m, [path[0], j], issues))}
                ${this._slot(key, 'into')}
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
