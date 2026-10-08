import type { NodeActions } from './model';

const HOLD_MS = 500;
const DOUBLE_TAP_MS = 250;

export function fireEvent(node: HTMLElement, type: string, detail: unknown): void {
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const hasAction = (cfg: { action: string } | undefined): boolean => !!cfg && cfg.action !== 'none';

/** Runs an action through the `hass-action` event, handled natively by the frontend. */
export function runAction(
  host: HTMLElement,
  actions: NodeActions,
  action: 'tap' | 'hold' | 'double_tap',
  local?: (name: string) => boolean,
): void {
  // Card-internal actions (e.g. expanding a group) never reach Home Assistant.
  const name = actions[`${action}_action`]?.action;
  if (name && local?.(name)) return;
  fireEvent(host, 'hass-action', { config: actions, action });
}

/**
 * Tap / hold / double tap handling on a node.
 * Returns the listeners to attach to the element.
 */
export function actionHandlers(
  host: HTMLElement,
  getActions: () => NodeActions,
  local?: (name: string) => boolean,
) {
  let holdTimer: number | undefined;
  let held = false;
  let tapTimer: number | undefined;
  let startX = 0;
  let startY = 0;

  const clearHold = () => {
    if (holdTimer) window.clearTimeout(holdTimer);
    holdTimer = undefined;
  };

  return {
    pointerdown: (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      held = false;
      startX = ev.clientX;
      startY = ev.clientY;
      if (hasAction(getActions().hold_action)) {
        holdTimer = window.setTimeout(() => {
          held = true;
          runAction(host, getActions(), 'hold', local);
        }, HOLD_MS);
      }
    },
    pointermove: (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) clearHold();
    },
    pointercancel: () => clearHold(),
    pointerleave: () => clearHold(),
    click: (ev: MouseEvent) => {
      ev.stopPropagation();
      clearHold();
      if (held) {
        held = false;
        return;
      }
      const actions = getActions();
      if (hasAction(actions.double_tap_action)) {
        if (tapTimer) {
          window.clearTimeout(tapTimer);
          tapTimer = undefined;
          runAction(host, actions, 'double_tap', local);
          return;
        }
        tapTimer = window.setTimeout(() => {
          tapTimer = undefined;
          runAction(host, getActions(), 'tap', local);
        }, DOUBLE_TAP_MS);
        return;
      }
      if (hasAction(actions.tap_action)) runAction(host, actions, 'tap', local);
    },
    keydown: (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        runAction(host, getActions(), 'tap', local);
      }
    },
  };
}

export function isInteractive(actions: NodeActions): boolean {
  return (
    hasAction(actions.tap_action) || hasAction(actions.hold_action) || hasAction(actions.double_tap_action)
  );
}
