import { css } from 'lit';

/**
 * Visual language inspired by iOS apps: borderless filled surfaces, system colors
 * reserved for icons and flows, clear typographic hierarchy.
 */
export const cardStyles = css`
  :host {
    /* iOS system colors (light). */
    --lec-solar: #ff9500;
    --lec-grid: #007aff;
    --lec-export: #5856d6;
    --lec-battery: #34c759;
    --lec-home: #8e8e93;
    --lec-device: #8e8e93;
    --lec-alert: #ff3b30;

    --lec-surface: var(--ha-card-background, var(--card-background-color, #fff));
    --lec-text: var(--primary-text-color, #1c1c1e);
    --lec-muted: var(--secondary-text-color, #8e8e93);
    --lec-fill: color-mix(in srgb, var(--lec-text) 4.5%, var(--lec-surface));
    --lec-fill-strong: color-mix(in srgb, var(--lec-text) 8%, transparent);
    --lec-separator: color-mix(in srgb, var(--lec-text) 9%, transparent);
    --lec-idle-line: color-mix(in srgb, var(--lec-text) 14%, transparent);
    --lec-ease: cubic-bezier(0.32, 0.72, 0, 1);
    display: block;
  }

  :host([dark]) {
    --lec-solar: #ff9f0a;
    --lec-grid: #0a84ff;
    --lec-export: #5e5ce6;
    --lec-battery: #30d158;
    --lec-home: #98989d;
    --lec-device: #98989d;
    --lec-alert: #ff453a;
    --lec-fill: color-mix(in srgb, var(--lec-text) 7%, var(--lec-surface));
    --lec-fill-strong: color-mix(in srgb, var(--lec-text) 12%, transparent);
  }

  ha-card {
    overflow: hidden;
    height: 100%;
  }

  /* Transparent mode: no card frame. Nodes keep their own fill, so they stay readable on any
     background. */
  ha-card.transparent {
    background: none;
    border: none;
    box-shadow: none;
    backdrop-filter: none;
  }

  .header {
    padding: 16px 18px 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--lec-text);
  }

  .content {
    padding: 16px 18px 18px;
  }

  .stage {
    position: relative;
    width: 100%;
    min-height: 80px;
    -webkit-tap-highlight-color: transparent;
  }

  svg.flows {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .flow path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* ---------- Nodes ---------- */

  .node {
    position: absolute;
    left: 0;
    top: 0;
    box-sizing: border-box;
    --s: 80px;
    --ph: 44px;
    outline: none;
  }

  .node-inner {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    color: var(--lec-text);
    transition:
      opacity 0.45s var(--lec-ease),
      transform 0.45s var(--lec-ease),
      background-color 0.3s ease;
  }

  .node.is-hidden {
    pointer-events: none;
  }

  .node.is-hidden .node-inner,
  .node.is-hidden .caption {
    opacity: 0;
  }

  .node.is-hidden .node-inner {
    transform: scale(0.9);
  }

  .node.interactive {
    cursor: pointer;
  }

  .node.interactive:active .node-inner {
    transform: scale(0.96);
  }

  @media (hover: hover) {
    .node.interactive:hover .node-inner {
      background-color: color-mix(in srgb, var(--lec-text) 7%, var(--lec-surface));
    }
  }

  .node:focus-visible .node-inner {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--lec-grid) 45%, transparent);
  }

  ha-icon {
    color: var(--c);
    display: inline-flex;
    transition: color 0.3s ease;
  }

  .num {
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum';
  }

  .unit {
    font-size: 0.72em;
    font-weight: 500;
    color: var(--lec-muted);
    margin-left: 0.16em;
    letter-spacing: 0;
  }

  /* Circles: sources and home */

  .circle .node-inner {
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    background: var(--lec-fill);
  }

  .circle.is-idle ha-icon {
    color: var(--lec-muted);
  }

  .circle ha-icon {
    --mdc-icon-size: calc(var(--s) * 0.25);
    margin-bottom: calc(var(--s) * 0.03);
  }

  .circle.has-secondary ha-icon {
    --mdc-icon-size: calc(var(--s) * 0.22);
    margin-bottom: 0;
  }

  /* Over a configured limit: tinted fill and outline, icon and value in the alert color. */
  .circle.is-alert .node-inner {
    background: color-mix(in srgb, var(--lec-alert) 12%, var(--lec-fill));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--lec-alert) 55%, transparent);
  }

  .circle.is-alert ha-icon,
  .circle.is-alert .value {
    color: var(--lec-alert);
  }

  .home ha-icon {
    color: var(--lec-text);
  }

  .circle .value {
    font-size: calc(var(--s) * 0.18);
    font-weight: 600;
    line-height: 1.12;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }

  .circle .name {
    font-size: max(10px, calc(var(--s) * 0.12));
    font-weight: 400;
    color: var(--lec-muted);
    line-height: 1.3;
    max-width: 78%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .circle .secondary {
    font-size: max(9.5px, calc(var(--s) * 0.105));
    color: var(--lec-muted);
    white-space: nowrap;
    max-width: 80%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Units of a source shown unit by unit: small circles, the name only when there is room for it. */
  .circle.is-small .name,
  .circle.is-small .secondary {
    display: none;
  }

  .ring {
    position: absolute;
    inset: calc(var(--s) * -0.06);
    width: calc(100% + var(--s) * 0.12);
    height: calc(100% + var(--s) * 0.12);
    transform: rotate(-90deg);
    pointer-events: none;
    overflow: visible;
  }

  .ring circle {
    fill: none;
    stroke-linecap: round;
    transition:
      stroke-dasharray 0.8s var(--lec-ease),
      stroke-dashoffset 0.8s var(--lec-ease),
      stroke 0.3s ease;
  }

  .ring .ring-track {
    stroke: var(--lec-fill-strong);
  }

  .caption {
    position: absolute;
    left: 50%;
    top: calc(100% + var(--s) * 0.12);
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    line-height: 1;
    color: var(--lec-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.45s var(--lec-ease);
  }

  .caption strong {
    color: var(--lec-text);
    font-weight: 600;
  }

  .caption .dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.6;
  }

  .warn {
    position: absolute;
    top: 0;
    right: 0;
    --mdc-icon-size: 16px;
    color: var(--lec-solar);
    background: var(--lec-surface);
    border-radius: 50%;
    padding: 1px;
    display: none;
  }

  .is-unavailable .warn {
    display: inline-flex;
  }

  .is-unavailable .node-inner > :not(.warn) {
    opacity: 0.45;
  }

  /* Pills: devices */

  .pill .node-inner {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 10px;
    padding: 0 12px 0 7px;
    border-radius: 12px;
    background: var(--lec-fill);
    overflow: hidden;
  }

  .pill .chip {
    flex: none;
    width: calc(var(--ph) - 14px);
    height: calc(var(--ph) - 14px);
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--c) 16%, transparent);
    transition: background-color 0.3s ease;
  }

  .pill ha-icon {
    --mdc-icon-size: 18px;
    color: color-mix(in srgb, var(--c) 70%, var(--lec-text));
  }

  .pill.is-idle .chip {
    background: var(--lec-fill-strong);
  }

  .pill.is-idle ha-icon {
    color: var(--lec-muted);
  }

  .pill .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .pill .name {
    font-size: 13.5px;
    font-weight: 500;
    line-height: 1.25;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Device groups: a chevron after the name; members are slightly recessed. */
  .pill.is-group .name {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .pill.is-group .name span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pill .chevron {
    --mdc-icon-size: 16px;
    flex: none;
    color: var(--lec-muted);
    transition: transform 0.3s var(--lec-ease);
  }

  .pill.is-expanded .chevron {
    transform: rotate(180deg);
  }

  .pill.is-member .node-inner {
    background: color-mix(in srgb, var(--lec-fill) 55%, transparent);
  }

  .pill .secondary {
    font-size: 11.5px;
    color: var(--lec-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pill .value {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  .pill.is-idle .value {
    color: var(--lec-muted);
    font-weight: 500;
  }

  /* Grid and narrow screens: the value moves below the name, like a Home Assistant tile. */
  .stage.grid-devices .pill .node-inner {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-content: center;
    row-gap: 1px;
  }

  .stage.grid-devices .pill .chip {
    grid-row: 1 / span 2;
  }

  .stage.grid-devices .pill .text {
    grid-column: 2;
    grid-row: 1;
  }

  .stage.grid-devices .pill .name {
    font-size: 13px;
  }

  .stage.grid-devices .pill .value {
    grid-column: 2;
    grid-row: 2;
    justify-self: start;
    font-size: 13px;
    color: var(--lec-muted);
    font-weight: 500;
  }

  .stage.grid-devices .pill.is-active .value .num {
    color: var(--lec-text);
    font-weight: 600;
  }

  .stage.grid-devices .pill .secondary {
    display: none;
  }

  /* ---------- Indicators ---------- */

  .ratios {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px 32px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--lec-separator);
  }

  .ratio {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .ratio svg {
    width: 30px;
    height: 30px;
    transform: rotate(-90deg);
  }

  .ratio circle {
    fill: none;
    stroke-width: 4;
    stroke-linecap: round;
    transition: stroke-dasharray 0.8s var(--lec-ease);
  }

  .ratio .ratio-track {
    stroke: var(--lec-fill-strong);
  }

  .stat-icon {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--c) 16%, transparent);
  }

  .stat-icon ha-icon {
    --mdc-icon-size: 17px;
    color: color-mix(in srgb, var(--c) 75%, var(--lec-text));
  }

  .ratio .label {
    font-size: 12px;
    color: var(--lec-muted);
    line-height: 1.2;
  }

  .ratio .pct {
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: reduce) {
    .node-inner,
    .ring circle,
    .ratio circle {
      transition: none;
    }
  }
`;
