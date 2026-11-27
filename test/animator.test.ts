import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowAnimator } from '../src/animator';
import { computeLayout } from '../src/layout';

/** A `matchMedia` result that records its listeners, as the browser keeps them alive. */
function fakeMotionQuery(matches = false) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  return {
    matches,
    listeners,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.delete(fn),
  };
}

function stubWindow(query: ReturnType<typeof fakeMotionQuery>) {
  vi.stubGlobal('window', { matchMedia: () => query });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
}

describe('FlowAnimator lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not listen to the reduced-motion preference before the card is connected', () => {
    const query = fakeMotionQuery();
    stubWindow(query);
    expect(new FlowAnimator()).toBeInstanceOf(FlowAnimator);
    expect(query.listeners.size).toBe(0);
  });

  it('stops listening when the card is disconnected, so a removed card can be collected', () => {
    const query = fakeMotionQuery();
    stubWindow(query);
    const animator = new FlowAnimator();
    animator.connect();
    expect(query.listeners.size).toBe(1);
    animator.disconnect();
    expect(query.listeners.size).toBe(0);
  });

  it('listens once, however many times the card is connected', () => {
    const query = fakeMotionQuery();
    stubWindow(query);
    const animator = new FlowAnimator();
    animator.connect();
    animator.connect();
    expect(query.listeners.size).toBe(1);
    animator.disconnect();
    animator.connect();
    expect(query.listeners.size).toBe(1);
  });

  it('works without a window (tests, server rendering)', () => {
    const animator = new FlowAnimator();
    expect(() => {
      animator.connect();
      animator.disconnect();
    }).not.toThrow();
    expect(animator.step(0.016)).toBe(false);
  });
});

function fakeEl(): HTMLElement {
  const props = new Map<string, string>();
  const style = {
    transform: '',
    width: '',
    height: '',
    setProperty: (k: string, v: string) => props.set(k, v),
  };
  return { style } as unknown as HTMLElement;
}

describe('FlowAnimator group frames', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('positions the unified group frame over its header and members, and moves them in lockstep on expand', () => {
    vi.stubGlobal('CSS', { escape: (s: string) => s });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    const animator = new FlowAnimator();
    const els: Record<string, HTMLElement> = {
      '[data-node="home"]': fakeEl(),
      '[data-node="device:0"]': fakeEl(),
      '[data-node="device:0:0"]': fakeEl(),
      '[data-node="device:0:1"]': fakeEl(),
      '[data-group="device:0"]': fakeEl(),
    };
    const root = { querySelector: (sel: string) => els[sel] ?? null } as unknown as HTMLElement;

    // 1. Collapsed state.
    const collapsed = computeLayout({
      width: 700,
      solar: false,
      grid: true,
      battery: false,
      devices: ['device:0'],
    });
    animator.update(
      collapsed,
      new Map([
        ['home', true],
        ['device:0', true],
        ['device:0:0', false],
        ['device:0:1', false],
      ]),
      [],
      new Map(),
    );
    animator.bind(root);
    animator.step(0, true);

    // 2. Expanded state: group header shifts up, members appear aligned below it.
    const expanded = computeLayout({
      width: 700,
      solar: false,
      grid: true,
      battery: false,
      devices: ['device:0', 'device:0:0', 'device:0:1'],
      deviceParents: { 'device:0:0': 'device:0', 'device:0:1': 'device:0' },
    });
    animator.update(
      expanded,
      new Map([
        ['home', true],
        ['device:0', true],
        ['device:0:0', true],
        ['device:0:1', true],
      ]),
      [],
      new Map(),
    );
    animator.bind(root);
    // Mid-transition step: header and members move together without overlapping.
    animator.step(0.016, false);
    const frameEl = els['[data-group="device:0"]'];
    const head = expanded.nodes['device:0'];
    const last = expanded.nodes['device:0:1'];
    const expectedHeight = last.y + last.h / 2 - (head.y - head.h / 2);
    expect(parseFloat(frameEl.style.height)).toBeCloseTo(expectedHeight, 0);
    expect(parseFloat(frameEl.style.width)).toBeCloseTo(head.w, 0);

    // Snap to final position and verify exact alignment.
    animator.step(0, true);
    expect(frameEl.style.transform).toBe(
      `translate(${Math.round((head.x - head.w / 2) * 10) / 10}px, ${Math.round((head.y - head.h / 2) * 10) / 10}px)`,
    );

    // 3. Collapse again: frame keeps its last geometry while fading out, without throwing.
    const prevTransform = frameEl.style.transform;
    animator.update(
      collapsed,
      new Map([
        ['home', true],
        ['device:0', true],
        ['device:0:0', false],
        ['device:0:1', false],
      ]),
      [],
      new Map(),
    );
    animator.bind(root);
    animator.step(0.016, false);
    expect(frameEl.style.transform).toBe(prevTransform);
  });
});
