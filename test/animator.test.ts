import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowAnimator } from '../src/animator';
import { computeLayout } from '../src/layout';
import type { FlowModel } from '../src/model';

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

interface FakeSvgEl {
  attrs: Map<string, string>;
  writes: Map<string, number>;
  style: Record<string, string>;
  setAttribute: (k: string, v: string) => void;
  removeAttribute: (k: string) => void;
  querySelector?: (sel: string) => FakeSvgEl | null;
}

function fakeSvgEl(children?: Record<string, FakeSvgEl>): FakeSvgEl {
  const attrs = new Map<string, string>();
  const writes = new Map<string, number>();
  return {
    attrs,
    writes,
    style: {},
    setAttribute: (k, v) => {
      attrs.set(k, v);
      writes.set(k, (writes.get(k) ?? 0) + 1);
    },
    removeAttribute: (k) => attrs.delete(k),
    ...(children ? { querySelector: (sel: string) => children[sel] ?? null } : {}),
  };
}

function fakeFlowDom() {
  const track = fakeSvgEl();
  const halo = fakeSvgEl();
  const dots = fakeSvgEl();
  const group = fakeSvgEl({ '.track': track, '.halo': halo, '.dots': dots });
  const gradient = fakeSvgEl();
  return { group, gradient, track, halo, dots };
}

function makeFlow(overrides: Partial<FlowModel> = {}): FlowModel {
  return {
    id: 'solar_home',
    from: 'solar',
    to: 'home',
    watts: 1500,
    intensity: 0.5,
    active: true,
    idle: false,
    colorFrom: '#ff9500',
    colorTo: '#8e8e93',
    toggles: { speed: true, thickness: true, density: true, glow: false },
    source: 'solar_home',
    ...overrides,
  };
}

describe('FlowAnimator flows, counters and visibility', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws active flows, keeps glow off until enabled, and only writes stroke-dashoffset on steady frames', () => {
    vi.stubGlobal('CSS', { escape: (s: string) => s });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    const layout = computeLayout({ width: 700, solar: true, grid: false, battery: false, devices: [] });
    const stage = fakeEl();
    const flowDom = fakeFlowDom();
    const root = {
      querySelector: (sel: string) => {
        if (sel === '.stage') return stage;
        if (sel === '[data-flow="solar_home"]') return flowDom.group;
        if (sel === '[data-gradient="solar_home"]') return flowDom.gradient;
        return null;
      },
    } as unknown as HTMLElement;

    const animator = new FlowAnimator();
    const vis = new Map([
      ['solar', true],
      ['home', true],
    ]);
    animator.update(layout, vis, [makeFlow()], new Map());
    animator.bind(root);
    animator.step(0, true);

    expect(flowDom.group.style.opacity).toBe('1');
    expect(flowDom.track.attrs.get('d')).toMatch(/^M/);
    expect(flowDom.gradient.attrs.get('x2')).toBeDefined();
    // Glow disabled: halo stays detached via display="none" so its blur filter costs nothing.
    expect(flowDom.halo.attrs.get('display')).toBe('none');
    const dWritesAfterSnap = flowDom.dots.writes.get('d') ?? 0;
    const widthWritesAfterSnap = flowDom.dots.writes.get('stroke-width') ?? 0;
    const initialOffset = flowDom.dots.attrs.get('stroke-dashoffset');

    // Steady-state frame: only particles move (stroke-dashoffset changes, path & width are untouched).
    expect(animator.step(0.05, false)).toBe(true);
    expect(flowDom.dots.attrs.get('stroke-dashoffset')).not.toBe(initialOffset);
    expect(flowDom.dots.writes.get('d')).toBe(dWritesAfterSnap);
    expect(flowDom.dots.writes.get('stroke-width')).toBe(widthWritesAfterSnap);

    // Enabling glow removes display="none" and animates the halo alongside the dots.
    animator.update(
      layout,
      vis,
      [makeFlow({ toggles: { speed: true, thickness: true, density: true, glow: true } })],
      new Map(),
    );
    animator.step(0, true);
    expect(flowDom.halo.attrs.has('display')).toBe(false);
    expect(flowDom.halo.attrs.get('stroke-dashoffset')).toBe(flowDom.dots.attrs.get('stroke-dashoffset'));
  });

  it('handles dimmed idle flows, hidden flows and missing endpoints cleanly', () => {
    vi.stubGlobal('CSS', { escape: (s: string) => s });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    const layout = computeLayout({ width: 700, solar: true, grid: false, battery: false, devices: [] });
    const flowDom = fakeFlowDom();
    const root = {
      querySelector: (sel: string) => {
        if (sel === '[data-flow="solar_home"]') return flowDom.group;
        if (sel === '[data-gradient="solar_home"]') return flowDom.gradient;
        return null;
      },
    } as unknown as HTMLElement;

    const animator = new FlowAnimator();
    const vis = new Map([
      ['solar', true],
      ['home', true],
    ]);

    // Idle dimmed flow: track visible, dots hidden.
    animator.update(layout, vis, [makeFlow({ active: false, idle: true, watts: 0 })], new Map());
    animator.bind(root);
    animator.step(0, true);
    expect(flowDom.group.style.opacity).toBe('1');
    expect(flowDom.dots.style.opacity).toBe('0.000');

    // Inactive non-idle flow: whole group hidden.
    animator.update(layout, vis, [makeFlow({ active: false, idle: false, watts: 0 })], new Map());
    animator.step(0, true);
    expect(flowDom.group.style.opacity).toBe('0');

    // Missing endpoint rect: flow hidden without throwing.
    animator.update(layout, new Map([['home', true]]), [makeFlow({ active: true })], new Map());
    animator.step(0, true);
    expect(flowDom.group.style.opacity).toBe('0');
  });

  it('pauses particle movement when prefers-reduced-motion is active', () => {
    const query = fakeMotionQuery(true);
    stubWindow(query);
    vi.stubGlobal('CSS', { escape: (s: string) => s });

    const layout = computeLayout({ width: 700, solar: true, grid: false, battery: false, devices: [] });
    const flowDom = fakeFlowDom();
    const root = {
      querySelector: (sel: string) => {
        if (sel === '[data-flow="solar_home"]') return flowDom.group;
        if (sel === '[data-gradient="solar_home"]') return flowDom.gradient;
        return null;
      },
    } as unknown as HTMLElement;

    const animator = new FlowAnimator();
    animator.connect();
    animator.update(
      layout,
      new Map([
        ['solar', true],
        ['home', true],
      ]),
      [makeFlow()],
      new Map(),
    );
    animator.bind(root);
    animator.step(0, true);
    const offset = flowDom.dots.attrs.get('stroke-dashoffset');

    expect(animator.step(0.05, false)).toBe(false);
    expect(flowDom.dots.attrs.get('stroke-dashoffset')).toBe(offset);
    animator.disconnect();
  });

  it('interpolates power counters, applies custom formatters, and shows a dash when unavailable', () => {
    vi.stubGlobal('CSS', { escape: (s: string) => s });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    const layout = computeLayout({ width: 700, solar: true, grid: false, battery: false, devices: [] });
    const numEl = { textContent: '' } as unknown as HTMLElement;
    const unitEl = { textContent: '' } as unknown as HTMLElement;
    const root = {
      querySelector: (sel: string) => {
        if (sel === '[data-num="solar"]') return numEl;
        if (sel === '[data-unit="solar"]') return unitEl;
        return null;
      },
    } as unknown as HTMLElement;

    const animator = new FlowAnimator();
    animator.setFormatter((w) => ({ value: String(Math.round(w)), unit: 'W' }));
    animator.update(layout, new Map([['solar', true]]), [], new Map([['solar', 100]]));
    animator.bind(root);
    animator.step(0, true);
    expect(numEl.textContent).toBe('100');
    expect(unitEl.textContent).toBe('W');

    // Target rises to 1000 W: a single frame moves partway rather than jumping immediately.
    animator.update(layout, new Map([['solar', true]]), [], new Map([['solar', 1000]]));
    expect(animator.step(0.05, false)).toBe(true);
    const mid = Number(numEl.textContent);
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(1000);

    // Unavailable value renders a dash and clears the unit.
    animator.update(layout, new Map([['solar', true]]), [], new Map([['solar', null]]));
    animator.step(0, true);
    expect(numEl.textContent).toBe('—');
    expect(unitEl.textContent).toBe('');
  });

  it('cancels and restarts requestAnimationFrame when visibility changes', () => {
    const raf = vi.fn(() => 42);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', cancel);

    const animator = new FlowAnimator();
    animator.setVisible(true);
    expect(raf).toHaveBeenCalledTimes(1);
    animator.setVisible(false);
    expect(cancel).toHaveBeenCalledWith(42);
    animator.setVisible(true);
    expect(raf).toHaveBeenCalledTimes(2);
  });
});
