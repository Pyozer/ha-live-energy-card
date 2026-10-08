import { flowVisual, type FlowVisual } from './intensity';
import { deviceFlowPath, sourceFlowPath, type Layout, type Rect } from './layout';
import type { LineStyle } from './types';
import type { FlowModel } from './model';

/**
 * Animation engine: positions nodes, draws flows and moves particles.
 * It works directly on the DOM rendered by Lit (no re-render) every frame, with exponential
 * smoothing of every value for soft, interruptible transitions.
 */

interface FlowEls {
  group: SVGGElement;
  gradient: SVGLinearGradientElement;
  track: SVGPathElement;
  halo: SVGPathElement;
  dots: SVGPathElement;
}

interface FlowState {
  model: FlowModel;
  els?: FlowEls;
  visual: FlowVisual;
  target: FlowVisual;
  offset: number;
  trackAlpha: number;
  dotAlpha: number;
  geometryKey: string;
  applied: string;
}

interface NodeState {
  el?: HTMLElement;
  rect?: Rect;
  target?: Rect;
  visible: boolean;
  applied: string;
}

interface ValueState {
  target: number | null;
  current: number | null;
  numEl?: HTMLElement;
  unitEl?: HTMLElement;
  text: string;
}

export type ValueFormatter = (watts: number) => { value: string; unit: string };

const exp = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);
const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) < eps;
const r1 = (v: number): number => Math.round(v * 10) / 10;

export class FlowAnimator {
  private nodes = new Map<string, NodeState>();
  private flows = new Map<string, FlowState>();
  private values = new Map<string, ValueState>();
  private stage?: HTMLElement;
  private height = { current: 0, target: 0 };
  private scale = 1;
  /** Incremented whenever the geometry may have changed (moved nodes, new layout). */
  private geomVersion = 0;
  private raf = 0;
  private last = 0;
  private visible = true;
  private reducedMotion = false;
  private lineStyle: LineStyle = 'rounded';
  private motionQuery?: MediaQueryList;
  private format: ValueFormatter = (w) => ({ value: String(Math.round(w)), unit: 'W' });

  constructor() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.motionQuery.matches;
      this.motionQuery.addEventListener?.('change', this.onMotionChange);
    }
  }

  private onMotionChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
    this.kick();
  };

  setFormatter(format: ValueFormatter): void {
    this.format = format;
    for (const v of this.values.values()) v.text = '';
    this.kick();
  }

  /** Binds the engine to the elements rendered by Lit (after each render). */
  bind(root: ShadowRoot | HTMLElement): void {
    this.stage = root.querySelector<HTMLElement>('.stage') ?? undefined;
    for (const [id, state] of this.nodes) {
      state.el = root.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`) ?? undefined;
      state.applied = '';
    }
    for (const [id, state] of this.flows) {
      const group = root.querySelector<SVGGElement>(`[data-flow="${CSS.escape(id)}"]`);
      const gradient = root.querySelector<SVGLinearGradientElement>(`[data-gradient="${CSS.escape(id)}"]`);
      if (group && gradient) {
        const q = (cls: string) => group.querySelector<SVGPathElement>(`.${cls}`)!;
        const changed = state.els?.group !== group;
        state.els = {
          group,
          gradient,
          track: q('track'),
          halo: q('halo'),
          dots: q('dots'),
        };
        if (changed) {
          state.geometryKey = '';
          state.applied = '';
        }
      } else {
        state.els = undefined;
      }
    }
    for (const [id, state] of this.values) {
      state.numEl = root.querySelector<HTMLElement>(`[data-num="${CSS.escape(id)}"]`) ?? undefined;
      state.unitEl = root.querySelector<HTMLElement>(`[data-unit="${CSS.escape(id)}"]`) ?? undefined;
      state.text = '';
    }
    this.kick();
  }

  /** New targets: layout, flows and values. */
  update(
    layout: Layout,
    nodeVisibility: Map<string, boolean>,
    flows: FlowModel[],
    values: Map<string, number | null>,
    lineStyle: LineStyle = 'rounded',
  ): void {
    this.lineStyle = lineStyle;
    this.scale = layout.size / 80;
    this.height.target = layout.height;
    if (this.height.current === 0) this.height.current = layout.height;

    for (const [id, visible] of nodeVisibility) {
      let state = this.nodes.get(id);
      if (!state) {
        state = { visible, applied: '' };
        this.nodes.set(id, state);
      }
      const target = layout.nodes[id];
      if (visible && target) {
        // A reappearing node jumps straight to its position instead of sliding.
        if (!state.visible || !state.rect) state.rect = { ...target };
        state.target = { ...target };
      }
      state.visible = visible && !!target;
    }
    for (const id of [...this.nodes.keys()]) if (!nodeVisibility.has(id)) this.nodes.delete(id);

    const seen = new Set<string>();
    for (const model of flows) {
      seen.add(model.id);
      const target = flowVisual(model.intensity, model.toggles, this.scale);
      let state = this.flows.get(model.id);
      if (!state) {
        state = {
          model,
          visual: { ...target },
          target,
          offset: Math.random() * target.gap,
          trackAlpha: 0,
          dotAlpha: 0,
          geometryKey: '',
          applied: '',
        };
        this.flows.set(model.id, state);
      }
      state.model = model;
      // A flow turning off keeps its look during the fade-out.
      if (model.active) state.target = target;
    }
    for (const id of [...this.flows.keys()]) if (!seen.has(id)) this.flows.delete(id);

    for (const [id, watts] of values) {
      let state = this.values.get(id);
      if (!state) {
        state = { target: watts, current: watts, text: '' };
        this.values.set(id, state);
      }
      if (state.current === null || watts === null) state.current = watts;
      state.target = watts;
    }
    for (const id of [...this.values.keys()]) if (!values.has(id)) this.values.delete(id);

    this.geomVersion++;
    this.kick();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.kick();
    else this.stop();
  }

  destroy(): void {
    this.stop();
    this.motionQuery?.removeEventListener?.('change', this.onMotionChange);
  }

  private kick(): void {
    if (this.raf || !this.visible) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    const first = this.last === 0;
    this.last = now;
    const busy = this.step(dt, first);
    if (busy && this.visible) this.raf = requestAnimationFrame(this.frame);
  };

  /** Advances the animation by `dt` seconds. Returns `true` while something is still moving. */
  step(dt: number, snap = false): boolean {
    let busy = false;
    const kPos = snap ? 1 : exp(dt, 0.1);
    const kVis = snap ? 1 : exp(dt, 0.45);
    const kFade = snap ? 1 : exp(dt, 0.16);
    const kNum = snap ? 1 : exp(dt, 0.14);

    // Stage height.
    const h = this.height;
    h.current += (h.target - h.current) * kPos;
    if (near(h.current, h.target, 0.3)) h.current = h.target;
    else busy = true;
    if (this.stage) {
      const px = `${r1(h.current)}px`;
      if (this.stage.style.height !== px) this.stage.style.height = px;
    }

    // Nodes.
    const rects: Record<string, Rect> = {};
    let moved = snap;
    for (const [id, n] of this.nodes) {
      if (n.rect && n.target) {
        const r = n.rect;
        const t = n.target;
        r.x += (t.x - r.x) * kPos;
        r.y += (t.y - r.y) * kPos;
        r.w += (t.w - r.w) * kPos;
        r.h += (t.h - r.h) * kPos;
        if (near(r.x, t.x, 0.2) && near(r.y, t.y, 0.2) && near(r.w, t.w, 0.2) && near(r.h, t.h, 0.2)) {
          n.rect = { ...t };
        } else {
          busy = true;
        }
        rects[id] = n.rect;
      }
      if (n.el && n.rect) {
        const r = n.rect;
        const key = `${r1(r.x)}|${r1(r.y)}|${r1(r.w)}|${r1(r.h)}`;
        if (key !== n.applied) {
          n.applied = key;
          moved = true;
          const s = n.el.style;
          s.transform = `translate(${r1(r.x - r.w / 2)}px, ${r1(r.y - r.h / 2)}px)`;
          s.width = `${r1(r.w)}px`;
          s.height = `${r1(r.h)}px`;
          s.setProperty('--s', `${r1(r.w)}px`);
          s.setProperty('--ph', `${r1(r.h)}px`);
        }
      }
    }

    if (moved) this.geomVersion++;

    // Flows.
    const motion = !this.reducedMotion;
    for (const f of this.flows.values()) {
      const m = f.model;
      const trackTarget = m.active ? 1 : m.idle ? 0.45 : 0;
      const dotTarget = m.active ? 1 : 0;
      f.trackAlpha += (trackTarget - f.trackAlpha) * kFade;
      f.dotAlpha += (dotTarget - f.dotAlpha) * kFade;
      if (near(f.trackAlpha, trackTarget, 0.005)) f.trackAlpha = trackTarget;
      else busy = true;
      if (near(f.dotAlpha, dotTarget, 0.005)) f.dotAlpha = dotTarget;
      else busy = true;

      const v = f.visual;
      const t = f.target;
      // The phase is kept proportional to the spacing so particles do not jump when the
      // density changes.
      const frac = v.gap > 0 ? f.offset / v.gap : 0;
      for (const key of ['speed', 'width', 'gap', 'dot', 'glow'] as const) {
        v[key] += (t[key] - v[key]) * kVis;
        if (!near(v[key], t[key], key === 'glow' ? 0.003 : 0.05)) busy = true;
        else v[key] = t[key];
      }

      f.offset = frac * v.gap;
      if (motion && f.dotAlpha > 0) {
        f.offset = (f.offset + v.speed * dt) % Math.max(4, v.gap);
        busy = true;
      }

      const els = f.els;
      if (!els) continue;

      const from = rects[m.from];
      const to = rects[m.to];
      if (!from || !to) {
        if (f.applied !== 'hidden') {
          els.group.style.opacity = '0';
          f.applied = 'hidden';
        }
        continue;
      }

      const gKey = String(this.geomVersion);
      if (gKey !== f.geometryKey) {
        f.geometryKey = gKey;
        const geom = m.geometry
          ? m.geometry(rects)
          : m.source
            ? sourceFlowPath(m.source, rects, this.lineStyle)
            : deviceFlowPath(from, to, this.lineStyle);
        if (geom) {
          for (const p of [els.track, els.halo, els.dots]) p.setAttribute('d', geom.d);
          els.gradient.setAttribute('x1', String(r1(geom.from.x)));
          els.gradient.setAttribute('y1', String(r1(geom.from.y)));
          // Avoids a degenerate gradient on perfectly vertical or horizontal paths.
          els.gradient.setAttribute('x2', String(r1(geom.to.x) + 0.01));
          els.gradient.setAttribute('y2', String(r1(geom.to.y) + 0.01));
        }
      }

      const gap = Math.max(4, v.gap);
      const pos = f.offset % gap;
      const dotOffset = -pos;
      const state = [
        f.trackAlpha.toFixed(3),
        f.dotAlpha.toFixed(3),
        v.width.toFixed(2),
        v.dot.toFixed(2),
        gap.toFixed(2),
        v.glow.toFixed(3),
        pos.toFixed(2),
      ].join('|');
      if (state === f.applied) continue;
      f.applied = state;

      els.group.style.opacity = f.trackAlpha > 0.001 || f.dotAlpha > 0.001 ? '1' : '0';
      els.track.setAttribute('stroke-width', v.width.toFixed(2));
      els.track.style.opacity = (f.trackAlpha * (m.active ? 0.34 : 0.5)).toFixed(3);

      const dash = `0 ${gap.toFixed(2)}`;
      els.dots.setAttribute('stroke-width', v.dot.toFixed(2));
      els.dots.setAttribute('stroke-dasharray', dash);
      els.dots.setAttribute('stroke-dashoffset', dotOffset.toFixed(2));
      els.dots.style.opacity = f.dotAlpha.toFixed(3);

      // Optional glow: blurred light around particles, stronger as power increases.
      els.halo.setAttribute('stroke-width', (v.dot * 2).toFixed(2));
      els.halo.setAttribute('stroke-dasharray', dash);
      els.halo.setAttribute('stroke-dashoffset', dotOffset.toFixed(2));
      els.halo.style.opacity = (f.dotAlpha * v.glow * 0.4).toFixed(3);
    }

    // Displayed values (animated counter).
    for (const v of this.values.values()) {
      if (v.target === null) {
        v.current = null;
      } else if (v.current !== null) {
        v.current += (v.target - v.current) * kNum;
        if (near(v.current, v.target, Math.max(0.05, Math.abs(v.target) * 0.001))) v.current = v.target;
        else busy = true;
      }
      const formatted = v.current === null ? { value: '—', unit: '' } : this.format(v.current);
      const text = `${formatted.value}|${formatted.unit}`;
      if (text !== v.text) {
        v.text = text;
        if (v.numEl) v.numEl.textContent = formatted.value;
        if (v.unitEl) v.unitEl.textContent = formatted.unit;
      }
    }

    return busy;
  }
}
