import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionHandlers, isInteractive, runAction } from '../src/actions';
import type { NodeActions } from '../src/model';

// The handlers use `window` timers; Node has the same API on `globalThis`.
vi.stubGlobal('window', globalThis);

/** A host element that records the `hass-action` events it receives. */
function host() {
  const target = new EventTarget();
  const events: { action: string; config: NodeActions }[] = [];
  target.addEventListener('hass-action', (ev) => events.push((ev as CustomEvent).detail));
  return { el: target as unknown as HTMLElement, events };
}

const pointer = (x = 0, y = 0, button = 0) => ({ button, clientX: x, clientY: y }) as PointerEvent;
const click = () => ({ stopPropagation: () => {} }) as MouseEvent;

const more: NodeActions = { entity: 'sensor.x', tap_action: { action: 'more-info' } };

describe('actions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a tap runs the tap action right away when there is no double tap', () => {
    const h = host();
    const handlers = actionHandlers(h.el, () => more);
    handlers.pointerdown(pointer());
    handlers.click(click());
    expect(h.events).toEqual([{ action: 'tap', config: more }]);
  });

  it('a long press runs the hold action, and the following click does nothing', () => {
    const h = host();
    const actions: NodeActions = { ...more, hold_action: { action: 'toggle' } };
    const handlers = actionHandlers(h.el, () => actions);
    handlers.pointerdown(pointer());
    vi.advanceTimersByTime(500);
    handlers.click(click());
    expect(h.events.map((e) => e.action)).toEqual(['hold']);
  });

  it('moving the pointer cancels the long press', () => {
    const h = host();
    const actions: NodeActions = { ...more, hold_action: { action: 'toggle' } };
    const handlers = actionHandlers(h.el, () => actions);
    handlers.pointerdown(pointer(0, 0));
    handlers.pointermove(pointer(20, 0));
    vi.advanceTimersByTime(600);
    expect(h.events).toEqual([]);
  });

  it('ignores secondary mouse buttons for the long press', () => {
    const h = host();
    const actions: NodeActions = { ...more, hold_action: { action: 'toggle' } };
    actionHandlers(h.el, () => actions).pointerdown(pointer(0, 0, 2));
    vi.advanceTimersByTime(600);
    expect(h.events).toEqual([]);
  });

  it('with a double tap action, a single tap waits before running', () => {
    const h = host();
    const actions: NodeActions = { ...more, double_tap_action: { action: 'toggle' } };
    const handlers = actionHandlers(h.el, () => actions);
    handlers.click(click());
    expect(h.events).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(h.events.map((e) => e.action)).toEqual(['tap']);
  });

  it('two quick taps run the double tap action only', () => {
    const h = host();
    const actions: NodeActions = { ...more, double_tap_action: { action: 'toggle' } };
    const handlers = actionHandlers(h.el, () => actions);
    handlers.click(click());
    vi.advanceTimersByTime(100);
    handlers.click(click());
    vi.advanceTimersByTime(500);
    expect(h.events.map((e) => e.action)).toEqual(['double_tap']);
  });

  it('Enter and Space run the tap action', () => {
    const h = host();
    const handlers = actionHandlers(h.el, () => more);
    for (const key of ['Enter', ' ', 'a']) {
      handlers.keydown({ key, preventDefault: () => {} } as KeyboardEvent);
    }
    expect(h.events.map((e) => e.action)).toEqual(['tap', 'tap']);
  });

  it('a card-internal action does not reach Home Assistant', () => {
    const h = host();
    const local = vi.fn((name: string) => name === 'toggle-group');
    runAction(h.el, { tap_action: { action: 'toggle-group' } }, 'tap', local);
    expect(local).toHaveBeenCalledWith('toggle-group');
    expect(h.events).toEqual([]);
    runAction(h.el, more, 'tap', local);
    expect(h.events).toHaveLength(1);
  });

  it('a node is interactive when one of its actions is not "none"', () => {
    expect(isInteractive({ tap_action: { action: 'none' } })).toBe(false);
    expect(isInteractive({})).toBe(false);
    expect(isInteractive({ hold_action: { action: 'more-info' } })).toBe(true);
  });
});
