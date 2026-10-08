import type { AnimationToggles, PowerCurve } from './types';

/** Ramène une puissance dans [0, 1] selon la plage et la courbe choisies. */
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
  /** Vitesse des particules (px/s). */
  speed: number;
  /** Épaisseur du tracé de fond (px). */
  width: number;
  /** Espacement entre deux particules (px). */
  gap: number;
  /** Diamètre des particules (px). */
  dot: number;
  /** Intensité du halo, de 0 à 1. */
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
 * Paramètres visuels d'un flux pour une intensité `t` (0..1).
 * Chaque effet désactivé reste figé sur une valeur médiane neutre.
 * `scale` adapte les dimensions à la taille des nœuds (1 = nœud de 80 px).
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
