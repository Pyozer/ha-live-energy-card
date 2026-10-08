/**
 * Minimal stand-ins for the Home Assistant components used by the card,
 * to display it outside Home Assistant.
 */
import * as mdi from '@mdi/js';

const icons = mdi as Record<string, string>;

function iconPath(name: string | null | undefined): string {
  if (!name) return '';
  const key =
    'mdi' +
    name
      .replace(/^mdi:/, '')
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  return icons[key] ?? icons.mdiHelpCircleOutline;
}

class StubIcon extends HTMLElement {
  static observedAttributes = ['icon'];
  private _icon = '';

  get icon(): string {
    return this._icon;
  }

  set icon(value: string) {
    this._icon = value;
    this.render();
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(_name: string, _old: string, value: string): void {
    this.icon = value;
  }

  private render(): void {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; justify-content: center; }
        svg { width: var(--mdc-icon-size, 24px); height: var(--mdc-icon-size, 24px); fill: currentColor; display: block; }
      </style>
      <svg viewBox="0 0 24 24"><path d="${iconPath(this._icon)}"></path></svg>`;
  }
}

class StubCard extends HTMLElement {
  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host {
          display: block;
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
          box-shadow: var(--ha-card-box-shadow, none);
          color: var(--primary-text-color);
          transition: background 0.3s ease;
        }
      </style>
      <slot></slot>`;
  }
}

if (!customElements.get('ha-icon')) customElements.define('ha-icon', StubIcon);
if (!customElements.get('ha-card')) customElements.define('ha-card', StubCard);
