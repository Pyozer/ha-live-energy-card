/**
 * Rough stand-ins for the Home Assistant components the visual editor is built on (`ha-form`,
 * `ha-svg-icon`, `ha-icon-button`), to try the editor outside Home Assistant: its sections, the
 * order of its fields, their labels and help texts, and what a change writes to the configuration.
 * They do not look like the real ones: the rendering of the editor is still to be checked in Home
 * Assistant.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../src/types';

interface Field {
  name: string;
  type?: 'grid' | 'expandable';
  title?: string;
  flatten?: boolean;
  schema?: Field[];
  selector?: Record<string, Record<string, unknown> | undefined>;
}

type Data = Record<string, unknown>;
type Describe = (field: Field) => string;

class StubForm extends LitElement {
  static override properties = {
    hass: { attribute: false },
    data: { attribute: false },
    schema: { attribute: false },
    computeLabel: { attribute: false },
    computeHelper: { attribute: false },
  };

  declare hass?: HomeAssistant;
  declare data?: Data;
  declare schema?: Field[];
  declare computeLabel?: Describe;
  declare computeHelper?: Describe;

  static override styles = css`
    :host {
      display: block;
      font-size: 14px;
    }
    .fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    label.boolean {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .label {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    label.boolean .label {
      font-size: 14px;
      color: var(--primary-text-color);
    }
    .helper {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    label.boolean .helper {
      flex-basis: 100%;
    }
    input:not([type='checkbox']),
    select {
      font: inherit;
      color: inherit;
      padding: 8px 10px;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      background: var(--secondary-background-color);
      min-width: 0;
    }
    details {
      border: 1px solid var(--divider-color);
      border-radius: 12px;
      padding: 0 12px;
    }
    summary {
      cursor: pointer;
      font-weight: 500;
      padding: 12px 0;
    }
    details > .fields {
      padding-bottom: 12px;
    }
  `;

  protected override render(): TemplateResult {
    return this._fields(this.schema ?? [], this.data ?? {}, (value) =>
      this.dispatchEvent(
        new CustomEvent('value-changed', { detail: { value }, bubbles: true, composed: true }),
      ),
    );
  }

  private _fields(schema: Field[], data: Data, change: (data: Data) => void): TemplateResult {
    return html`<div class="fields">${schema.map((field) => this._field(field, data, change))}</div>`;
  }

  private _field(field: Field, data: Data, change: (data: Data) => void): TemplateResult {
    if (field.type === 'grid') {
      return html`<div class="grid">${(field.schema ?? []).map((f) => this._field(f, data, change))}</div>`;
    }
    if (field.type === 'expandable') {
      // Like `ha-form`: a named group holds its own object, a flattened one edits its parent's.
      const nested = !!field.name && !field.flatten;
      const inner = nested ? ((data[field.name] ?? {}) as Data) : data;
      const innerChange = nested ? (value: Data) => change({ ...data, [field.name]: value }) : change;
      return html`<details>
        <summary>${field.title}</summary>
        ${this._fields(field.schema ?? [], inner, innerChange)}
      </details>`;
    }
    const set = (value: unknown) => change({ ...data, [field.name]: value });
    const label = this.computeLabel?.(field) ?? field.name;
    const helper = this.computeHelper?.(field);
    const kind = Object.keys(field.selector ?? {})[0] ?? 'text';
    return html`<label class=${kind}>
      ${kind === 'boolean' ? nothing : html`<span class="label">${label}</span>`}
      ${this._input(kind, field, data[field.name], set)}
      ${kind === 'boolean' ? html`<span class="label">${label}</span>` : nothing}
      ${helper ? html`<span class="helper">${helper}</span>` : nothing}
    </label>`;
  }

  private _input(kind: string, field: Field, value: unknown, set: (value: unknown) => void): TemplateResult {
    const options = field.selector?.[kind] ?? {};
    const text = (ev: Event) => (ev.target as HTMLInputElement).value;
    switch (kind) {
      case 'boolean':
        return html`<input
          type="checkbox"
          .checked=${!!value}
          @change=${(ev: Event) => set((ev.target as HTMLInputElement).checked)}
        />`;
      case 'number':
        return html`<input
          type="number"
          .value=${value === undefined || value === null ? '' : String(value)}
          placeholder=${String(options.unit_of_measurement ?? '')}
          @change=${(ev: Event) => set(text(ev) === '' ? undefined : Number(text(ev)))}
        />`;
      case 'select': {
        const choices = (options.options ?? []) as { value: string; label: string }[];
        return html`<select @change=${(ev: Event) => set(text(ev))}>
          ${choices.map((o) => html`<option value=${o.value} ?selected=${o.value === value}>${o.label}</option>`)}
        </select>`;
      }
      case 'entity': {
        // One id, or several separated by commas. The list offers the entities of the expected kind.
        const ids = (options.include_entities ?? Object.keys(this.hass?.states ?? {})) as string[];
        const list = `entities-${field.name}`;
        const many = !!options.multiple;
        const current = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        const parse = (raw: string) => {
          const parts = raw
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
          return many ? parts : parts[0];
        };
        return html`<input
            type="text"
            list=${list}
            .value=${current}
            placeholder=${many ? 'sensor.a, sensor.b' : 'sensor.a'}
            @change=${(ev: Event) => set(parse(text(ev)))}
          />
          <datalist id=${list}>${ids.map((id) => html`<option value=${id}></option>`)}</datalist>`;
      }
      case 'ui_action': {
        const action = (value as { action?: string } | undefined)?.action ?? '';
        return html`<select @change=${(ev: Event) => set(text(ev) ? { action: text(ev) } : undefined)}>
          ${['', 'more-info', 'toggle', 'none'].map(
            (a) => html`<option value=${a} ?selected=${a === action}>${a || '(default)'}</option>`,
          )}
        </select>`;
      }
      default:
        return html`<input
          type="text"
          .value=${String(value ?? '')}
          @change=${(ev: Event) => set(text(ev) || undefined)}
        />`;
    }
  }
}

class StubSvgIcon extends LitElement {
  static override properties = { path: {} };
  declare path?: string;

  static override styles = css`
    :host {
      display: inline-flex;
    }
    svg {
      width: var(--mdc-icon-size, 24px);
      height: var(--mdc-icon-size, 24px);
      fill: currentColor;
    }
  `;

  protected override render(): TemplateResult {
    return html`<svg viewBox="0 0 24 24"><path d=${this.path ?? ''}></path></svg>`;
  }
}

class StubIconButton extends LitElement {
  static override properties = { path: {}, label: {} };
  declare path?: string;
  declare label?: string;

  static override styles = css`
    button {
      display: inline-flex;
      padding: 8px;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--secondary-text-color);
      cursor: pointer;
    }
    button:hover {
      background: var(--secondary-background-color);
    }
    svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
  `;

  protected override render(): TemplateResult {
    return html`<button title=${this.label ?? ''} aria-label=${this.label ?? ''}>
      <svg viewBox="0 0 24 24"><path d=${this.path ?? ''}></path></svg>
    </button>`;
  }
}

if (!customElements.get('ha-form')) customElements.define('ha-form', StubForm);
if (!customElements.get('ha-svg-icon')) customElements.define('ha-svg-icon', StubSvgIcon);
if (!customElements.get('ha-icon-button')) customElements.define('ha-icon-button', StubIconButton);
