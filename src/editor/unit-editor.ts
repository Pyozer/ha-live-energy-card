import {
  mdiAlertOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiDeleteOutline,
  mdiDragVertical,
  mdiPlus,
} from '@mdi/js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { localize, type LocalizeKey } from '../localize/localize';
import type { UnitGroup } from '../source-units';
import type { BatteryConfig, BatteryUnitConfig, HomeAssistant, SolarConfig } from '../types';
import { entityIds } from '../units';
import { dropTargetAt } from './drag';
import { DragController, measureBlocks } from './drag-controller';
import { unitFormData, unitFromForm } from './form';
import { EditorSchema, fieldHelper, formLabel, NODE_ICONS } from './schema';
import { editorStyles } from './styles';
import { addUnit, dropUnit, removeUnit, shiftUnit, unitsOf, updateUnit } from './unit-list';
import { unitIssues, type EntityIssue } from './validation';

/**
 * The units of the solar or battery source, as a list of cards that open on their own form, can be
 * added, removed and reordered. It reports a change by firing `units-changed` with the new source
 * config (its options and its units).
 */
export class LiveEnergyCardUnitEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    group: {},
    source: { attribute: false },
    hideWhenZero: { attribute: false },
    issues: { attribute: false },
    _open: { state: true },
  };

  declare hass?: HomeAssistant;
  declare group: UnitGroup;
  /** The solar or battery config the units belong to. */
  declare source?: SolarConfig | BatteryConfig;
  /** The card's `hide_when_zero`, the default of every unit. */
  declare hideWhenZero?: boolean;
  declare issues: EntityIssue[];
  /** Index of the unit being edited, -1 when none. */
  declare _open: number;

  private readonly _drag = new DragController(this, {
    list: () => this.renderRoot.querySelector<HTMLElement>('.units'),
    target: (source, y) => {
      const target = dropTargetAt(measureBlocks(this.renderRoot.querySelector('.units')), y, false);
      return target && dropUnit(this.source ?? {}, Number(source), target) ? target : undefined;
    },
    drop: (source, target) => {
      const moved = dropUnit(this.source ?? {}, Number(source), target);
      if (moved) this._change(moved.node, this._followOpen(moved.node));
    },
  });

  constructor() {
    super();
    this.group = 'solar';
    this.issues = [];
    this._open = -1;
  }

  private _t(key: LocalizeKey, vars?: Record<string, string>): string {
    return localize(this.hass?.locale?.language ?? this.hass?.language, key, vars);
  }

  private _label = (schema: { name: string }): string => formLabel((key) => this._t(key), schema.name);
  private _helper = (schema: { name: string }): string => fieldHelper((key) => this._t(key), schema.name);

  /** Keeps the unit being edited open after the list changed (by identity: its position may differ). */
  private _followOpen(next: SolarConfig | BatteryConfig): number {
    const open = unitsOf(this.source)[this._open];
    return open ? unitsOf(next).indexOf(open) : -1;
  }

  private _change(node: SolarConfig | BatteryConfig, open = this._open): void {
    this._open = open;
    this.dispatchEvent(new CustomEvent('units-changed', { detail: { node } }));
  }

  private _unitChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const previous = unitsOf(this.source)[index];
    const value = unitFromForm(this.group, ev.detail.value, previous, this.hideWhenZero);
    this._change(updateUnit(this.source ?? {}, index, value));
  }

  private _add(): void {
    // A source without units shows an empty one: adding makes it a real one, then adds another.
    const base = unitsOf(this.source).length ? (this.source ?? {}) : updateUnit(this.source ?? {}, 0, {});
    const next = addUnit(base);
    this._change(next, unitsOf(next).length - 1);
  }

  private _remove(index: number): void {
    this._change(removeUnit(this.source ?? {}, index), -1);
  }

  /** Keyboard alternative to dragging: arrows move the unit, and the focus follows its handle. */
  private async _key(ev: KeyboardEvent, index: number): Promise<void> {
    const delta = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
    const moved = delta ? shiftUnit(this.source ?? {}, index, delta) : null;
    if (!moved) return;
    ev.preventDefault();
    this._change(moved.node, this._followOpen(moved.node));
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`[data-path="${moved.index}"] .handle`)?.focus();
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass) return nothing;
    const units = unitsOf(this.source);
    // A source without units shows an empty one, ready to take its first entity.
    const shown: BatteryUnitConfig[] = units.length ? units : [{}];
    return html`
      <div class="units ${this._drag.dragging ? 'lifting' : ''}">
        <div class="devices-title">
          <ha-icon .icon=${NODE_ICONS[this.group]}></ha-icon>
          <span>${this._t(`editor.units_${this.group}`)}</span>
          <span class="count">${units.length}</span>
        </div>
        ${shown.map((unit, i) => this._renderEntry(unit, i, units.length === 0))}
        <div class="actions">
          <button class="add" @click=${this._add}>
            <ha-svg-icon .path=${mdiPlus}></ha-svg-icon>${this._t('editor.add_unit')}
          </button>
        </div>
      </div>
    `;
  }

  /** The gap showing where the dragged unit would land. */
  private _slot(index: number, where: 'before' | 'after'): TemplateResult | typeof nothing {
    const { dragging, target } = this._drag;
    if (!dragging) return nothing;
    // Without a valid drop, the gap stays where the unit was lifted from.
    const here = target
      ? target.position === where && target.path[0] === index
      : where === 'after' && Number(dragging) === index;
    return here ? html`<div class="drop-slot" style="height: ${this._drag.slotHeight}px"></div>` : nothing;
  }

  private _renderEntry(unit: BatteryUnitConfig, index: number, empty: boolean): TemplateResult {
    return html`${this._slot(index, 'before')}${this._renderUnit(unit, index, empty)}${this._slot(index, 'after')}`;
  }

  private _renderUnit(unit: BatteryUnitConfig, index: number, empty: boolean): TemplateResult {
    const expanded = empty || this._open === index;
    const toggle = () => (this._open = expanded ? -1 : index);
    const ids = entityIds(unit.entity ?? unit.discharge_entity ?? unit.charge_entity);
    const state = ids.length ? this.hass!.states[ids[0]] : undefined;
    const separate = !!this.source?.separate;
    // Only a separate bubble has a name of its own.
    const title =
      (separate ? unit.name : undefined) ??
      state?.attributes.friendly_name ??
      this._t('editor.unit_n', { n: String(index + 1) });
    const icon = (separate ? unit.icon : undefined) ?? state?.attributes.icon ?? NODE_ICONS[this.group];
    const warning = unitIssues(this.issues, this.group, index).length > 0;
    return html`
      <div
        class="device ${expanded ? 'expanded' : ''} ${String(index) === this._drag.dragging ? 'lifted' : ''}"
        data-path=${index}
      >
        <div class="device-head">
          ${
            empty
              ? nothing
              : html`<button
                  class="handle"
                  .title=${this._t('editor.drag_unit')}
                  aria-label=${this._t('editor.drag_unit')}
                  @pointerdown=${(ev: PointerEvent) => this._drag.start(ev, String(index))}
                  @pointermove=${(ev: PointerEvent) => this._drag.move(ev)}
                  @pointerup=${(ev: PointerEvent) => this._drag.end(ev)}
                  @pointercancel=${(ev: PointerEvent) => this._drag.end(ev, true)}
                  @keydown=${(ev: KeyboardEvent) => this._key(ev, index)}
                >
                  <ha-svg-icon .path=${mdiDragVertical}></ha-svg-icon>
                </button>`
          }
          <ha-icon .icon=${icon}></ha-icon>
          <button class="device-title" @click=${toggle}>
            <span>${title}</span>
            <small>${ids.join(', ')}</small>
          </button>
          ${warning ? html`<ha-svg-icon class="warning" .path=${mdiAlertOutline}></ha-svg-icon>` : nothing}
          ${
            empty
              ? nothing
              : html`<ha-icon-button
                    .label=${this._t('editor.remove')}
                    .path=${mdiDeleteOutline}
                    @click=${() => this._remove(index)}
                  ></ha-icon-button>
                  <ha-icon-button
                    .label=${this._t('editor.edit')}
                    .path=${expanded ? mdiChevronUp : mdiChevronDown}
                    @click=${toggle}
                  ></ha-icon-button>`
          }
        </div>
        ${
          expanded
            ? html`<div class="device-body">
                <ha-form
                  .hass=${this.hass}
                  .data=${unitFormData(this.group, unit, this.hideWhenZero)}
                  .schema=${new EditorSchema((key, vars) => this._t(key, vars), this.hass).unit(
                    this.group,
                    unit,
                    separate,
                  )}
                  .computeLabel=${this._label}
                  .computeHelper=${this._helper}
                  @value-changed=${(ev: CustomEvent) => this._unitChanged(index, ev)}
                ></ha-form>
              </div>`
            : nothing
        }
      </div>
    `;
  }

  static override styles = editorStyles;
}

if (!customElements.get('live-energy-card-unit-editor')) {
  customElements.define('live-energy-card-unit-editor', LiveEnergyCardUnitEditor);
}
