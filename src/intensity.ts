import type { AnimationToggles, PowerCurve } from './types';

/** Maps a power to [0, 1] according to the chosen range and curve. */
export function normalizePower(watts: number, min: number, max: number, curve: PowerCurve = 'sqrt'): number {
  const lo = Math.max(0, min);
  const hi = Math.max(lo + 1, max);
  const clamped = Math.min(hi, Math.max(lo, watts));
  const t = (clamped - lo) / (hi - lo);
  switch (curve) {
    case 'linear':
      return t;
    case 'log':
      return Math.log1p(t * 99) / Math.log(100);
    case 'sqrt':
    default:
      return Math.sqrt(t);
  }
}

export interface FlowVisual {
  /** Particle speed (px/s). */
  speed: number;
  /** Background path thickness (px). */
  width: number;
  /** Spacing between two particles (px). */
  gap: number;
  /** Particle diameter (px). */
  dot: number;
  /** Glow intensity, from 0 to 1. */
  glow: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const DEFAULT_TOGGLES: Required<AnimationToggles> = {
  speed: true,
  thickness: true,
  density: true,
  glow: false,
};

/**
 * Visual parameters of a flow for an intensity `t` (0..1).
 * A disabled effect stays fixed at a neutral median value.
 * `scale` adapts dimensions to the node size (1 = 80 px node).
 */
export function flowVisual(t: number, toggles: Required<AnimationToggles>, scale = 1): FlowVisual {
  const k = Math.min(1, Math.max(0, t));
  const s = Math.min(1.3, Math.max(0.7, scale));
  const width = (toggles.thickness ? lerp(1.4, 4.2, k) : 2) * s;
  return {
    speed: (toggles.speed ? lerp(16, 110, k) : 45) * s,
    width,
    gap: (toggles.density ? lerp(60, 20, k) : 34) * s,
    dot: toggles.thickness ? width + 2 * s : 4.4 * s,
    glow: toggles.glow ? lerp(0.4, 1, k) : 0,
  };
}

export function resolveToggles(...layers: (AnimationToggles | undefined)[]): Required<AnimationToggles> {
  const out = { ...DEFAULT_TOGGLES };
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(DEFAULT_TOGGLES) as (keyof AnimationToggles)[]) {
      if (typeof layer[key] === 'boolean') out[key] = layer[key] as boolean;
    }
  }
  return out;
}
