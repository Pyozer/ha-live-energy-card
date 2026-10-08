import type { DevicesArrangement, PathGeometry, Point, Rect } from './layout';

/**
 * Réseau de distribution vers les appareils en mode grille :
 *
 *            │ [A]    │ [D]
 *            ├─[B]    ├─[E]
 *   Maison ──┴────────┴──────   ← bus principal (couloir central)
 *            ├─[C]    └─[F]
 *
 * Chaque segment transporte la somme des appareils situés en aval, si bien que l'épaisseur et
 * la vitesse des particules décroissent naturellement vers les extrémités.
 */

export interface TreeEdge {
  id: string;
  /** Appareils alimentés par ce segment. */
  downstream: string[];
  /** Appareil terminal, si le segment aboutit à une pastille. */
  leaf?: string;
  geometry: (rects: Record<string, Rect>) => PathGeometry | null;
}

const f = (v: number): string => (Math.round(v * 10) / 10).toString();

function line(a: Point, b: Point): PathGeometry {
  return { d: `M${f(a.x)},${f(a.y)} L${f(b.x)},${f(b.y)}`, from: a, to: b };
}

/** Segment vertical puis horizontal, avec un coin arrondi. */
function corner(a: Point, b: Point, radius = 9): PathGeometry {
  const dy = b.y - a.y;
  const r = Math.max(0, Math.min(radius, Math.abs(dy), b.x - a.x));
  const sy = Math.sign(dy) || 1;
  const d =
    `M${f(a.x)},${f(a.y)} L${f(a.x)},${f(b.y - sy * r)} ` +
    `Q${f(a.x)},${f(b.y)} ${f(a.x + r)},${f(b.y)} L${f(b.x)},${f(b.y)}`;
  return { d, from: a, to: b };
}

const INSET = 2;
const RADIUS = 9;

/** Fin d'un segment horizontal allant vers la gauche, qui tourne vers le bas en arrondi. */
const turnDown = (x: number, y: number): string =>
  `L${f(x + RADIUS)},${f(y)} Q${f(x)},${f(y)} ${f(x)},${f(y + RADIUS)}`;

export function buildDeviceTree(arr: DevicesArrangement): TreeEdge[] {
  const edges: TreeEdge[] = [];
  const cols = arr.columns;
  const busX = (rects: Record<string, Rect>, c: number): number | null => {
    const r = rects[cols[c][0]];
    return r ? r.x - r.w / 2 - arr.bus : null;
  };
  const tileLeft = (r: Rect): number => r.x - r.w / 2 + INSET;

  // Ligne du bus principal : couloir central (grille) ou ligne au-dessus des pastilles (empilé).
  const stacked = arr.mode === 'stack';
  const busY = (rects: Record<string, Rect>): number | null => {
    if (!stacked) return rects.home?.y ?? null;
    const first = rects[cols[0]?.[0]];
    return first ? first.y - first.h / 2 - 14 : null;
  };
  // En mode empilé, le bus s'arrête sur la première colonne et tourne vers le bas : sa branche
  // démarre donc après le virage.
  const branchStart = (rects: Record<string, Rect>, c: number): number | null => {
    const y = busY(rects);
    return y !== null && stacked && c === 0 ? y + RADIUS : y;
  };

  if (stacked) {
    // Descente depuis le flanc droit de la maison jusqu'au bus, puis vers la dernière colonne.
    const lastCol = cols.length - 1;
    edges.push({
      id: 'tree:trunk',
      downstream: cols.flat(),
      geometry: (rects) => {
        const home = rects.home;
        const y1 = busY(rects);
        const x1 = busX(rects, lastCol);
        if (!home || y1 === null || x1 === null) return null;
        const x0 = home.x + home.w / 2 - 3;
        const xt = x0 + 15;
        const r = RADIUS;
        // Avec une seule colonne, le tronc rejoint directement sa branche.
        const end = lastCol === 0 ? turnDown(x1, y1) : `L${f(x1)},${f(y1)}`;
        const d =
          `M${f(x0)},${f(home.y)} L${f(xt - r)},${f(home.y)} Q${f(xt)},${f(home.y)} ${f(xt)},${f(home.y + r)} ` +
          `L${f(xt)},${f(y1 - r)} Q${f(xt)},${f(y1)} ${f(xt - r)},${f(y1)} ${end}`;
        const to = lastCol === 0 ? { x: x1, y: y1 + r } : { x: x1, y: y1 };
        return { d, from: { x: x0, y: home.y }, to };
      },
    });
    for (let c = lastCol - 1; c >= 0; c--) {
      edges.push({
        id: `tree:spine:${c}`,
        downstream: cols.slice(0, c + 1).flat(),
        geometry: (rects) => {
          const y = busY(rects);
          const x0 = busX(rects, c + 1);
          const x1 = busX(rects, c);
          if (y === null || x0 === null || x1 === null) return null;
          if (c > 0) return line({ x: x0, y }, { x: x1, y });
          const d = `M${f(x0)},${f(y)} ${turnDown(x1, y)}`;
          return { d, from: { x: x0, y }, to: { x: x1, y: y + RADIUS } };
        },
      });
    }
  } else {
    // Bus principal, de la maison vers chaque colonne.
    cols.forEach((_, c) => {
      edges.push({
        id: `tree:spine:${c}`,
        downstream: cols.slice(c).flat(),
        geometry: (rects) => {
          const home = rects.home;
          const x1 = busX(rects, c);
          if (!home || x1 === null) return null;
          const x0 = c === 0 ? home.x + home.w / 2 - 3 : busX(rects, c - 1);
          if (x0 === null) return null;
          return line({ x: x0, y: home.y }, { x: x1, y: home.y });
        },
      });
    });
  }

  // Branches verticales de chaque colonne, vers le haut puis vers le bas.
  cols.forEach((ids, c) => {
    const up = arr.above[c] ?? 0;
    const branches: [string, string[]][] = [
      ['up', ids.slice(0, up).reverse()],
      ['down', ids.slice(up)],
    ];
    for (const [side, chain] of branches) {
      // `chain` part du couloir et s'en éloigne.
      chain.forEach((id, k) => {
        const last = k === chain.length - 1;
        const yAt = (rects: Record<string, Rect>, idx: number): number | null => {
          if (idx < 0) return branchStart(rects, c);
          return rects[chain[idx]]?.y ?? null;
        };
        // Tronçon de bus entre le nœud précédent et celui-ci (sauf pour le dernier, fusionné au coin).
        if (!last) {
          edges.push({
            id: `tree:bus:${c}:${side}:${k}`,
            downstream: chain.slice(k),
            geometry: (rects) => {
              const x = busX(rects, c);
              const y0 = yAt(rects, k - 1);
              const y1 = yAt(rects, k);
              if (x === null || y0 === null || y1 === null) return null;
              return line({ x, y: y0 }, { x, y: y1 });
            },
          });
        }
        edges.push({
          id: `flow:${id}`,
          downstream: [id],
          leaf: id,
          geometry: (rects) => {
            const x = busX(rects, c);
            const tile = rects[id];
            if (x === null || !tile) return null;
            const end = { x: tileLeft(tile), y: tile.y };
            if (!last) return line({ x, y: tile.y }, end);
            const y0 = yAt(rects, k - 1);
            if (y0 === null) return null;
            return corner({ x, y: y0 }, end);
          },
        });
      });
    }
  });

  return edges;
}
