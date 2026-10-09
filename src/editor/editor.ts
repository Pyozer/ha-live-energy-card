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
import type { DeviceConfig, HomeAssistant, LiveEnergyCardConfig } from '../types';
import { entityIds } from '../units';
import {
  addDevice,
  deviceAt,
  dropDevice,
  findDevice,
  isGroup,
  moveDevice,
  pathKey,
  removeDevice,
  updateDevice,
  type DevicePath,
  type DropTarget,
} from './device-list';
import { dropTargetAt, type DragBlock, type Span } from './drag';
import {
  deviceFormData,
  deviceFromForm,
  fromFormData,
  priceModesOf,
  toFormData,
  type PriceModes,
} from './form';
import { EditorSchema, fieldHelper, formLabel } from './schema';
import { editorStyles } from './styles';
import { describeIssue, deviceIssues, entityIssues, type EntityIssue } from './validation';

export class LiveEnergyCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _expanded: { state: true },
    _importStatus: { state: true },
    _priceModes: { state: true },
    _dragging: { state: true },
    _drop: { state: true },
    _slotHeight: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: LiveEnergyCardConfig;
  /** Path key of the device being edited (`2`, or `2.0` for a group member), empty when none. */
  declare _expanded: string;
  /** Result of the last Energy dashboard import, shown under the button. */
  declare _importStatus?: { ok: boolean; text: string };
  /** Price sources picked in the form, for prices that have no value yet. */
  declare _priceModes: PriceModes;
  /** Path key of the device being dragged, empty when none. */
  declare _dragging: string;
  /** Where the dragged device would land, `undefined` when the drop is not allowed. */
  declare _drop?: DropTarget;
  /** Height (px) of the gap left for the dragged device. */
  declare _slotHeight: number;
  /** Drag in progress: the lifted block, and where the pointer grabbed it and is now. */
  private _drag?: {
    el: HTMLElement;
    scroller: HTMLElement | null;
    grabX: number;
    grabY: number;
    x: number;
    y: number;
  };
  private _dragFrame = 0;

  constructor() {
    super();
    this._expanded = '';
    this._priceModes = {};
    this._dragging = '';
    this._slotHeight = 0;
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

  private _label = (schema: { name: string }): string => formLabel((key) => this._t(key), schema.name);

  private _helper = (schema: { name: string }): string => fieldHelper((key) => this._t(key), schema.name);

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

  /** Keeps the device being edited open after the list changed (by identity: its path may differ). */
  private _followExpanded(before: DeviceConfig[], after: DeviceConfig[]): void {
    const open = this._expanded
      ? deviceAt(
          before,
          this._expanded.split('.').map((n) => Number(n)),
        )
      : undefined;
    const path = open ? findDevice(after, open) : undefined;
    this._expanded = path ? pathKey(path) : '';
  }

  // --- Drag and drop ------------------------------------------------------------------------------
  // Pointer events (mouse, touch and pen) on a handle: the list is two levels deep and grows with
  // the config, so the geometry is measured on pointer move and the result shown as a drop mark.

  /**
   * Blocks as laid out on screen. The lifted block floats above the list (out of the flow), so it is
   * left out: the others have already closed up around the gap shown for the drop.
   */
  private _dragBlocks(): DragBlock[] {
    const span = (el: Element | null): Span => {
      const r = el!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const indexOf = (el: Element) => Number((el as HTMLElement).dataset.path!.split('.').pop());
    return [...this.renderRoot.querySelectorAll('.devices > .device:not(.lifted)')].map((el) => ({
      index: indexOf(el),
      block: span(el),
      head: span(el.querySelector(':scope > .device-head')),
      group: el.classList.contains('group'),
      members: [...el.querySelectorAll(':scope > .members > .device:not(.lifted)')].map((m) => ({
        index: indexOf(m),
        ...span(m),
      })),
    }));
  }

  /** Drop target under the pointer, kept only when it would actually move the device. */
  private _updateDrop(): void {
    const source = this._dragging.split('.').map((n) => Number(n));
    const devices = this._devices();
    const dragged = deviceAt(devices, source);
    const target = dropTargetAt(this._dragBlocks(), this._drag!.y, isGroup(dragged));
    this._drop = target && dropDevice(devices, source, target) ? target : undefined;
  }

  /** Makes the lifted block follow the pointer, wherever the list is scrolled to. */
  private _followPointer(): void {
    const d = this._drag!;
    const list = this.renderRoot.querySelector('.devices')!;
    const box = list.getBoundingClientRect();
    d.el.style.left = `${d.x - d.grabX - box.left - list.clientLeft}px`;
    d.el.style.top = `${d.y - d.grabY - box.top - list.clientTop}px`;
  }

  private _dragStart(ev: PointerEvent, path: DevicePath): void {
    if (this._dragging || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    ev.preventDefault();
    const handle = ev.currentTarget as HTMLElement;
    handle.setPointerCapture(ev.pointerId);
    const el = handle.closest('.device') as HTMLElement;
    const box = el.getBoundingClientRect();
    this._drag = {
      el,
      scroller: this._scrollParent(),
      grabX: ev.clientX - box.left,
      grabY: ev.clientY - box.top,
      x: ev.clientX,
      y: ev.clientY,
    };
    // Lifted out of the list at its current size; a gap of the same size stays in its place.
    el.style.width = `${box.width}px`;
    this._slotHeight = box.height;
    this._dragging = pathKey(path);
    this._dragLoop();
  }

  private _dragMove(ev: PointerEvent): void {
    if (!this._drag) return;
    this._drag.x = ev.clientX;
    this._drag.y = ev.clientY;
    this._followPointer();
    this._updateDrop();
  }

  /** While dragging: scrolls the editor near its edges, and keeps the block and drop mark current. */
  private _dragLoop = (): void => {
    if (!this._drag) return;
    this._scrollNearEdge();
    this._followPointer();
    this._updateDrop();
    this._dragFrame = requestAnimationFrame(this._dragLoop);
  };

  /** Closest scrollable ancestor, crossing shadow roots (the editor lives in a dialog), else the page. */
  private _scrollParent(): HTMLElement | null {
    let node: Node | null = this.parentNode ?? (this.getRootNode() as ShadowRoot).host;
    while (node) {
      if (node instanceof HTMLElement) {
        const overflow = getComputedStyle(node).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight)
          return node;
      }
      node = node.parentNode ?? (node as ShadowRoot).host ?? null;
    }
    return document.scrollingElement as HTMLElement | null;
  }

  private _scrollNearEdge(): void {
    const el = this._drag!.scroller;
    // The page itself scrolls when no ancestor does: its edges are the window's.
    const rect =
      el && el !== document.scrollingElement
        ? el.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    const y = this._drag!.y;
    const step = y < top + 48 ? -12 : y > bottom - 48 ? 12 : 0;
    if (step) el?.scrollBy(0, step);
  }

  private _dragEnd(ev: PointerEvent, cancel = false): void {
    if (!this._drag) return;
    cancelAnimationFrame(this._dragFrame);
    // The release point decides, even if no frame ran since the last move.
    this._drag.y = ev.clientY;
    this._updateDrop();
    (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
    this._drag.el.style.cssText = '';
    this._drag = undefined;
    const source = this._dragging.split('.').map((n) => Number(n));
    const target = cancel ? undefined : this._drop;
    this._dragging = '';
    this._drop = undefined;
    const before = this._devices();
    const result = target ? dropDevice(before, source, target) : null;
    if (!result) return;
    this._followExpanded(before, result.devices);
    this._setDevices(result.devices);
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
        .computeHelper=${this._helper}
        @value-changed=${this._valueChanged}
      ></ha-form>

      <div class="devices ${this._dragging ? 'lifting' : ''}">
        <div class="devices-title">
          <ha-icon icon="mdi:power-plug-outline"></ha-icon>
          <span>${this._t('editor.devices')}</span>
          <span class="count">${devices.length}</span>
        </div>
        ${devices.length === 0 ? html`<div class="empty">${this._t('editor.no_devices')}</div>` : nothing}
        ${devices.map((dev, i) => this._renderEntry(dev, [i], issues))}
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

  /** The gap showing where the dragged device would land. */
  private _slot(key: string, where: 'before' | 'after' | 'into'): TemplateResult | typeof nothing {
    if (!this._dragging) return nothing;
    const drop = this._drop;
    // Without a valid drop, the gap stays where the device was lifted from.
    const here = drop
      ? drop.position === where && pathKey(drop.path) === key
      : where === 'after' && key === this._dragging;
    return here ? html`<div class="drop-slot" style="height: ${this._slotHeight}px"></div>` : nothing;
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
    const subtitle = group ? this._t('node.group_count', { count: String(members.length) }) : ids.join(', ');
    const icon =
      dev.icon ?? state?.attributes.icon ?? (group ? 'mdi:folder-outline' : 'mdi:power-plug-outline');
    const warning = deviceIssues(issues, path).length > 0;
    const into = this._drop?.position === 'into' && pathKey(this._drop.path) === key;
    return html`
      <div
        class="device ${expanded ? 'expanded' : ''} ${group ? 'group' : ''} ${into ? 'drop-into' : ''} ${
          this._dragging === key ? 'lifted' : ''
        }"
        data-path=${key}
      >
        <div class="device-head">
          <button
            class="handle"
            .title=${this._t('editor.drag')}
            aria-label=${this._t('editor.drag')}
            @pointerdown=${(ev: PointerEvent) => this._dragStart(ev, path)}
            @pointermove=${(ev: PointerEvent) => this._dragMove(ev)}
            @pointerup=${(ev: PointerEvent) => this._dragEnd(ev)}
            @pointercancel=${(ev: PointerEvent) => this._dragEnd(ev, true)}
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
