import { LitElement, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { actionHandlers, isInteractive } from './actions';
import { ECO_FPS, FlowAnimator } from './animator';
import { DEFAULT_COLORS } from './colors';
import { formatCarbonRate, formatMoney, formatMoneyRate, statActions, type StatKey } from './cost';
import { configFromEnergyPrefs, fetchEnergyPrefs, guessConfig, importedCount } from './energy';
import { energyStatistics, fetchToday, TODAY_REFRESH_MS, todayByNode } from './energy-today';
import { validateConfig, watchedEntities } from './config';
import { computeLayout, type Layout } from './layout';
import { localize, resolveLanguage } from './localize/localize';
import {
  applyDeviceTree,
  applyUnitPaths,
  buildModel,
  DEFAULTS,
  ringValue,
  type CardModel,
  type FlowModel,
  type NodeActions,
  type NodeModel,
  TOGGLE_GROUP,
} from './model';
import { cardStyles } from './styles';
import type { HomeAssistant, LiveEnergyCardConfig } from './types';
import { formatPower } from './units';
import './editor/editor';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';

export const CARD_TAG = 'live-energy-card';

/** Below this diameter (px), a unit only shows its icon and value: no room for a name. */
const SMALL_UNIT = 60;

let instances = 0;

type Handlers = ReturnType<typeof actionHandlers>;

export class LiveEnergyCard extends LitElement {
  static override styles = cardStyles;

  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _width: { state: true },
    _expanded: { state: true },
    _today: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: LiveEnergyCardConfig;
  declare _width: number;
  /** Expanded device groups. */
  declare _expanded: ReadonlySet<string>;
  /** Today's energy (kWh) by node id, refreshed from the statistics. */
  declare _today: ReadonlyMap<string, number | null>;

  private _uid = `lec${++instances}`;
  private _model?: CardModel;
  private _layout?: Layout;
  private _order: string[] = [];
  private _watched: string[] = [];
  private _animator = new FlowAnimator();
  private _resize?: ResizeObserver;
  private _intersection?: IntersectionObserver;
  private _handlers = new Map<string, Handlers>();
  private _statHandlers = new Map<string, Handlers>();
  /** Energy statistics by node, and the timer refreshing their daily totals. */
  private _statistics = new Map<string, string[]>();
  private _todayTimer?: number;

  constructor() {
    super();
    this._width = 0;
    this._expanded = new Set();
    this._today = new Map();
  }

  static getConfigElement(): HTMLElement {
    return document.createElement('live-energy-card-editor');
  }

  /**
   * Configuration suggested when adding the card: imported from the Energy dashboard when it has
   * power sensors, otherwise guessed from entity names.
   */
  static async getStubConfig(hass?: HomeAssistant): Promise<Partial<LiveEnergyCardConfig>> {
    const prefs = await fetchEnergyPrefs(hass);
    const imported = prefs ? configFromEnergyPrefs(prefs) : undefined;
    if (imported && importedCount(imported) > 0) return imported;
    return guessConfig(hass);
  }

  setConfig(config: LiveEnergyCardConfig): void {
    this._config = validateConfig(config);
    this._watched = watchedEntities(this._config);
    this._handlers.clear();
    this._statHandlers.clear();
    this._statistics = energyStatistics(this._config);
    this._stopToday();
    this._expanded = new Set(
      (this._config.devices ?? []).flatMap((d, i) =>
        d?.devices?.length && d.expanded ? [`device:${i}`] : [],
      ),
    );
  }

  getCardSize(): number {
    return Math.max(3, Math.ceil(((this._layout?.height ?? 300) + 40) / 50));
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, min_rows: 3 };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._resize = new ResizeObserver(() => this._measure());
    this._resize.observe(this);
    this._intersection = new IntersectionObserver((entries) => {
      this._animator.setVisible(entries.some((e) => e.isIntersecting));
    });
    this._intersection.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resize?.disconnect();
    this._intersection?.disconnect();
    this._animator.setVisible(false);
    this._stopToday();
  }

  /** Starts refreshing today's energy (once `hass` is available), only for nodes that need it. */
  private _startToday(): void {
    if (this._todayTimer !== undefined || !this.hass || !this.isConnected) return;
    if (this._statistics.size === 0) {
      if (this._today.size) this._today = new Map();
      return;
    }
    const statistics = this._statistics;
    const refresh = async () => {
      const values = await fetchToday(this.hass, [...statistics.values()].flat());
      // Ignore a late answer for a configuration that has changed since.
      if (statistics === this._statistics) this._today = todayByNode(statistics, values);
    };
    this._todayTimer = window.setInterval(refresh, TODAY_REFRESH_MS);
    void refresh();
  }

  private _stopToday(): void {
    window.clearInterval(this._todayTimer);
    this._todayTimer = undefined;
  }

  private _measure(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage');
    const width = Math.floor(stage?.clientWidth ?? 0);
    if (width > 0 && Math.abs(width - this._width) >= 1) this._width = width;
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (!this._config) return false;
    if (changed.size === 1 && changed.has('hass')) {
      const old = changed.get('hass') as HomeAssistant | undefined;
      const hass = this.hass;
      if (!old || !hass) return true;
      if (old.language !== hass.language || old.locale?.language !== hass.locale?.language) return true;
      if (old.themes?.darkMode !== hass.themes?.darkMode) return true;
      return this._watched.some((id) => old.states[id] !== hass.states[id]);
    }
    return true;
  }

  protected override willUpdate(): void {
    if (!this._config || !this.hass) return;
    this._model = buildModel(this._config, this.hass, {
      previousOrder: this._order,
      expanded: this._expanded,
      todayEnergy: this._today,
    });
    this._order = this._model.devicesOrder;
    const visible = new Set(this._model.nodes.filter((n) => n.visible).map((n) => n.id));
    this._layout = computeLayout({
      width: this._width || 480,
      solar: visible.has('solar'),
      grid: visible.has('grid'),
      battery: visible.has('battery'),
      devices: this._model.devicesOrder.filter((id) => visible.has(id)),
      devicesLayout: this._config.devices_layout,
      devicesColumns: this._config.devices_columns,
      compact: this._config.compact,
      smallBubbles: this._config.small_bubbles,
      solarUnits: this._unitIds('solar', visible),
      batteryUnits: this._unitIds('battery', visible),
    });
    this._model.flows = applyUnitPaths(
      applyDeviceTree(this._model, this._layout, this._config),
      this._layout,
      this._config,
    );
  }

  /** Visible units of a source shown unit by unit, `undefined` for a source shown as one node. */
  private _unitIds(group: 'solar' | 'battery', visible: ReadonlySet<string>): string[] | undefined {
    const units = this._model!.nodes.filter((n) => n.unit === group);
    return units.length ? units.filter((n) => visible.has(n.id)).map((n) => n.id) : undefined;
  }

  /** Number formatting follows the Home Assistant locale. */
  private get _lang(): string | undefined {
    return this.hass?.locale?.language ?? this.hass?.language;
  }

  /** Labels follow the card `language` option, then the Home Assistant user language. */
  private get _labelLang(): string {
    return resolveLanguage(this._config?.language, this.hass);
  }

  private _format = (watts: number) =>
    formatPower(watts, {
      locale: this._lang,
      kiloThreshold: this._config?.kilo_threshold ?? DEFAULTS.kilo_threshold,
      decimals: this._config?.decimals ?? DEFAULTS.decimals,
      kiloDecimals: this._config?.kilo_decimals ?? DEFAULTS.kilo_decimals,
    });

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config || !this.hass || !this._model || !this._layout) return nothing;
    const model = this._model;
    const layout = this._layout;
    return html`
      <ha-card
        class="${this._config.transparent ? 'transparent' : ''} ${this._config.compact ? 'compact' : ''}"
      >
        ${this._config.title ? html`<div class="header">${this._config.title}</div>` : nothing}
        <div class="content">
          <div
            class="stage ${layout.narrow ? 'narrow' : ''} ${layout.devices.mode !== 'column' ? 'grid-devices' : ''}"
          >
            <svg class="flows" aria-hidden="true">
              <defs>
                <filter
                  id="${this._uid}-glow"
                  filterUnits="userSpaceOnUse"
                  x="-40"
                  y="-40"
                  width=${layout.width + 80}
                  height=${layout.height + 80}
                >
                  <feGaussianBlur stdDeviation="2.5"></feGaussianBlur>
                </filter>
                ${repeat(
                  model.flows,
                  (f) => f.id,
                  (f) => svg`
                    <linearGradient id=${this._gradientId(f)} data-gradient=${f.id} gradientUnits="userSpaceOnUse">
                      <stop offset="0" style="stop-color: ${f.colorFrom}"></stop>
                      <stop offset="1" style="stop-color: ${f.colorTo}"></stop>
                    </linearGradient>`,
                )}
              </defs>
              ${repeat(
                model.flows,
                (f) => f.id,
                (f) => {
                  const stroke = `url(#${this._gradientId(f)})`;
                  const idle = !f.active;
                  return svg`
                    <g class="flow" data-flow=${f.id} style="opacity: 0">
                      <path class="track" stroke=${idle ? 'var(--lec-idle-line)' : stroke}></path>
                      <path class="halo" display="none" stroke=${stroke} filter="url(#${this._uid}-glow)"></path>
                      <path class="dots" stroke=${stroke}></path>
                    </g>`;
                },
              )}
            </svg>
            ${repeat(
              model.nodes.filter((n) => !n.hub),
              (n) => n.id,
              (n) => this._renderNode(n),
            )}
          </div>
          ${model.ratios || model.stats ? this._renderFooter(model) : nothing}
        </div>
      </ha-card>
    `;
  }

  private _gradientId(f: FlowModel): string {
    return `${this._uid}-${f.id.replace(/[^a-z0-9_-]/gi, '_')}`;
  }

  private _handlersFor(id: string): Handlers {
    let h = this._handlers.get(id);
    if (!h) {
      h = actionHandlers(
        this,
        () => this._model?.nodes.find((n) => n.id === id)?.actions ?? {},
        (name) => {
          if (name !== TOGGLE_GROUP) return false;
          const next = new Set(this._expanded);
          if (!next.delete(id)) next.add(id);
          this._expanded = next;
          return true;
        },
      );
      this._handlers.set(id, h);
    }
    return h;
  }

  private _statHandlersFor(key: StatKey): Handlers {
    let h = this._statHandlers.get(key);
    if (!h) {
      h = actionHandlers(this, () => this._statActions(key));
      this._statHandlers.set(key, h);
    }
    return h;
  }

  private _statActions(key: StatKey): NodeActions {
    const cfg = this._config;
    return statActions(key, this._model?.stats?.entities[key], cfg?.cost, cfg?.carbon);
  }

  private _renderNode(n: NodeModel): TemplateResult {
    const interactive = isInteractive(n.actions);
    const h = this._handlersFor(n.id);
    const shape = n.kind === 'device' ? 'pill' : 'circle';
    const reading =
      n.watts === null
        ? `${n.name} : ${localize(this._labelLang, 'state.unavailable')}`
        : `${n.name} : ${Object.values(this._format(n.watts)).join(' ')}`;
    const label = n.status ? `${reading} · ${n.status}` : reading;
    const classes = [
      'node',
      shape,
      n.kind,
      n.visible ? '' : 'is-hidden',
      n.active ? 'is-active' : 'is-idle',
      n.available ? '' : 'is-unavailable',
      interactive ? 'interactive' : '',
      n.secondary ? 'has-secondary' : '',
      ringValue(n) !== undefined ? 'has-ring' : '',
      n.group ? 'is-group' : '',
      n.group?.expanded ? 'is-expanded' : '',
      n.parent ? 'is-member' : '',
      n.unit ? 'is-unit' : '',
      n.unit && (this._layout?.units[n.unit]?.size ?? Infinity) < SMALL_UNIT ? 'is-small' : '',
      n.alert ? 'is-alert' : '',
    ].join(' ');
    return html`
      <div
        class=${classes}
        data-node=${n.id}
        style="--c: ${n.color}"
        role=${interactive ? 'button' : 'group'}
        tabindex=${interactive && n.visible ? 0 : -1}
        aria-label=${label}
        aria-hidden=${n.visible ? 'false' : 'true'}
        aria-expanded=${n.group ? String(n.group.expanded) : nothing}
        title=${n.status ? `${n.name} · ${n.status}` : n.name}
        @pointerdown=${h.pointerdown}
        @pointermove=${h.pointermove}
        @pointercancel=${h.pointercancel}
        @pointerleave=${h.pointerleave}
        @click=${h.click}
        @keydown=${h.keydown}
      >
        ${shape === 'pill' ? this._renderPill(n) : this._renderCircle(n)}
      </div>
    `;
  }

  private _renderValue(n: NodeModel): TemplateResult {
    // Content is written by the animation engine (animated counter).
    return html`<div class="value">
      <span class="num" data-num=${n.id}></span><span class="unit" data-unit=${n.id}></span>
    </div>`;
  }

  private _renderCircle(n: NodeModel): TemplateResult {
    return html`
      <div class="node-inner">
        ${this._renderRing(n)}
        <ha-icon .icon=${n.icon}></ha-icon>
        ${this._renderValue(n)}
        <div class="name">${n.name}</div>
        ${n.secondary ? html`<div class="secondary">${n.secondary}</div>` : nothing}
        <ha-icon class="warn" icon="mdi:alert-circle"></ha-icon>
      </div>
      ${
        n.kind === 'battery' && (n.soc !== undefined || n.status)
          ? html`<div class="caption">
              ${
                n.soc !== undefined && n.soc !== null
                  ? html`<strong>${Math.round(n.soc)} %</strong
                      >${n.unit ? nothing : html`<span class="dot"></span>`}`
                  : nothing
              }
              ${n.unit ? nothing : html`<span>${n.status}</span>`}
            </div>`
          : nothing
      }
    `;
  }

  private _renderRing(n: NodeModel): TemplateResult | typeof nothing {
    const fill = ringValue(n);
    if (fill !== undefined) {
      const level = fill ?? 0;
      return html`<svg class="ring" viewBox="0 0 100 100">
        <circle class="ring-track" cx="50" cy="50" r="47" stroke-width="2.6"></circle>
        <circle
          cx="50"
          cy="50"
          r="47"
          stroke-width="2.6"
          pathLength="100"
          stroke=${n.alert ? 'var(--lec-alert)' : n.color}
          stroke-dasharray="${level} 100"
        ></circle>
      </svg>`;
    }
    if (n.kind === 'home') {
      const segments = n.mix ?? [];
      const gap = segments.length > 1 ? 2.2 : 0;
      let start = 0;
      return html`<svg class="ring" viewBox="0 0 100 100">
        <circle class="ring-track" cx="50" cy="50" r="47" stroke-width="2.6"></circle>
        ${segments.map((s) => {
          const len = s.fraction * 100;
          const visible = Math.max(0.01, len - gap);
          const el = svg`<circle cx="50" cy="50" r="47" stroke-width="2.6" pathLength="100"
            stroke=${s.color} stroke-dasharray="${visible} ${100 - visible}"
            stroke-dashoffset=${-(start + gap / 2)}></circle>`;
          start += len;
          return el;
        })}
      </svg>`;
    }
    return nothing;
  }

  private _renderPill(n: NodeModel): TemplateResult {
    return html`
      <div class="node-inner">
        <div class="chip"><ha-icon .icon=${n.icon}></ha-icon></div>
        <div class="text">
          ${
            n.group
              ? html`<div class="name">
                  <span>${n.name}</span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
                </div>`
              : html`<div class="name">${n.name}</div>`
          }
          ${n.secondary ? html`<div class="secondary">${n.secondary}</div>` : nothing}
        </div>
        ${this._renderValue(n)}
        <ha-icon class="warn" icon="mdi:alert-circle"></ha-icon>
      </div>
    `;
  }

  /** Footer: self-consumption ratios, live cost and carbon. */
  private _renderFooter(model: CardModel): TemplateResult {
    const lang = this._labelLang;
    const ring = (label: string, value: number | null, color: string) => html`
      <div class="ratio">
        <svg viewBox="0 0 36 36">
          <circle class="ratio-track" cx="18" cy="18" r="15"></circle>
          ${
            value !== null && value >= 0.5
              ? svg`<circle cx="18" cy="18" r="15" pathLength="100" stroke=${color}
                stroke-dasharray="${value} 100"></circle>`
              : nothing
          }
        </svg>
        <div>
          <div class="label">${label}</div>
          <div class="pct">${value === null ? '—' : `${Math.round(value)} %`}</div>
        </div>
      </div>
    `;
    // With an entity behind it, the indicator opens its more-info dialog like a node does.
    const stat = (key: StatKey, label: string, value: string, icon: string, color: string) => {
      const interactive = isInteractive(this._statActions(key));
      const h = interactive ? this._statHandlersFor(key) : undefined;
      return html`
        <div
          class="ratio stat ${interactive ? 'interactive' : ''}"
          style="--c: ${color}"
          role=${interactive ? 'button' : nothing}
          tabindex=${interactive ? 0 : nothing}
          aria-label=${interactive ? `${label} : ${value}` : nothing}
          @pointerdown=${h?.pointerdown}
          @pointermove=${h?.pointermove}
          @pointercancel=${h?.pointercancel}
          @pointerleave=${h?.pointerleave}
          @click=${h?.click}
          @keydown=${h?.keydown}
        >
          <div class="stat-icon"><ha-icon .icon=${icon}></ha-icon></div>
          <div>
            <div class="label">${label}</div>
            <div class="pct">${value}</div>
          </div>
        </div>
      `;
    };
    const r = model.ratios;
    const st = model.stats;
    const day = st?.period === 'day';
    const money = day ? formatMoney : formatMoneyRate;
    return html`<div class="ratios">
      ${
        r
          ? html`${ring(localize(lang, 'ratio.self_consumption'), r.selfConsumption, DEFAULT_COLORS.solar)}
            ${ring(localize(lang, 'ratio.autarky'), r.autarky, DEFAULT_COLORS.battery)}`
          : nothing
      }
      ${
        st?.cost != null
          ? // A negative cost means the export earns more than the import costs.
            st.cost < 0
            ? stat(
                'cost',
                localize(lang, day ? 'stat.earnings_day' : 'stat.earnings'),
                money(-st.cost, st.currency, this._lang),
                'mdi:cash-plus',
                DEFAULT_COLORS.gridExport,
              )
            : stat(
                'cost',
                localize(lang, day ? 'stat.cost_day' : 'stat.cost'),
                money(st.cost, st.currency, this._lang),
                'mdi:cash',
                DEFAULT_COLORS.gridImport,
              )
          : nothing
      }
      ${
        st?.savings != null && model.nodes.some((n) => n.kind === 'solar')
          ? stat(
              'savings',
              localize(lang, day ? 'stat.savings_day' : 'stat.savings'),
              money(st.savings, st.currency, this._lang),
              'mdi:piggy-bank-outline',
              DEFAULT_COLORS.solar,
            )
          : nothing
      }
      ${
        st?.carbon != null
          ? stat(
              'carbon',
              localize(lang, 'stat.carbon'),
              formatCarbonRate(st.carbon, this._lang),
              'mdi:molecule-co2',
              DEFAULT_COLORS.device,
            )
          : nothing
      }
    </div>`;
  }

  protected override firstUpdated(): void {
    this._measure();
  }

  protected override updated(): void {
    this.toggleAttribute('dark', !!this.hass?.themes?.darkMode);
    this._startToday();
    if (!this._model || !this._layout) return;
    this._animator.setFormatter(this._format);
    this._animator.setMaxFps(this._config?.eco_mode ? ECO_FPS : 0);
    const visibility = new Map(this._model.nodes.map((n) => [n.id, n.visible]));
    const values = new Map(this._model.nodes.map((n) => [n.id, n.watts]));
    this._animator.update(
      this._layout,
      visibility,
      this._model.flows,
      values,
      this._config?.line_style ?? DEFAULTS.line_style,
    );
    this._animator.bind(this.renderRoot as ShadowRoot);
  }
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, LiveEnergyCard);
}

declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards ?? [];
if (!window.customCards.some((c) => c.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: localize(navigator.language, 'card.name'),
    description: localize(navigator.language, 'card.description'),
    preview: true,
  });
}

console.info(
  `%c LIVE-ENERGY-CARD %c ${VERSION} `,
  'color:#fff;background:#14b8a6;font-weight:600;border-radius:4px 0 0 4px;padding:2px 4px',
  'color:#14b8a6;background:transparent;font-weight:600;padding:2px 4px',
);
