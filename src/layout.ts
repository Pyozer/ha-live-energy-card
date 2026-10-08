import type { LineStyle } from './types';

/**
 * Node placement (in px) and flow paths.
 *
 *            Solar
 *   Grid              Home  ──►  Devices
 *           Battery
 */

export interface Rect {
  /** Center. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DevicesLayout = 'auto' | 'column' | 'grid';

export interface LayoutInput {
  width: number;
  solar: boolean;
  grid: boolean;
  battery: boolean;
  /** Visible device ids, in display order. */
  devices: string[];
  devicesLayout?: DevicesLayout;
  /** Forced number of columns in grid mode. */
  devicesColumns?: number;
}

export interface DevicesArrangement {
  /** `stack`: devices below the diagram (narrow screens). */
  mode: 'column' | 'grid' | 'stack';
  /** Devices per column, top to bottom. */
  columns: string[][];
  /** Number of devices above the central corridor, per column (grid mode). */
  above: number[];
  /** Distance between the vertical bus and the left edge of the pills (grid mode). */
  bus: number;
}

export interface Layout {
  width: number;
  height: number;
  nodes: Record<string, Rect>;
  /** Source node diameter. */
  size: number;
  compact: boolean;
  devices: DevicesArrangement;
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

interface DiagramMetrics {
  D: number;
  Dh: number;
  spacing: number;
  width: number;
  V: number;
  /** Distances from the home center to the top / bottom edges of the diagram. */
  above: number;
  below: number;
  pillH: number;
  pillGap: number;
}

function diagramMetrics(input: LayoutInput, areaW: number): DiagramMetrics {
  const middle = input.solar || input.battery;
  const cols = (input.grid ? 1 : 0) + (middle ? 1 : 0) + 1;
  const fit = cols === 3 ? 3.9 : cols === 2 ? 2.7 : 1.3;
  const D = clamp(areaW / fit, 50, 92);
  const Dh = Math.min(D * 1.16, 104);
  const spacing = cols > 1 ? clamp((areaW - D / 2 - Dh / 2) / (cols - 1), D * 1.3, D * 2.3) : 0;
  const width = cols > 1 ? D / 2 + spacing * (cols - 1) + Dh / 2 : Dh;
  // Space reserved below the battery for its caption (charge level).
  const caption = input.battery ? clamp(D * 0.28, 18, 24) : 0;
  const V = D * 1.3;
  const pillH = clamp(D * 0.56, 36, 46);
  return {
    D,
    Dh,
    spacing,
    width,
    V,
    above: input.solar ? D / 2 + V : Dh / 2,
    below: input.battery ? V + D / 2 + caption : Dh / 2,
    pillH,
    pillGap: clamp(pillH * 0.22, 6, 10),
  };
}

const stackHeight = (count: number, h: number, gap: number): number =>
  count > 0 ? count * h + (count - 1) * gap : 0;

export function computeLayout(input: LayoutInput): Layout {
  const W = Math.max(240, input.width);
  const pad = 4;
  const n = input.devices.length;
  const compact = W < 520;
  const mode = input.devicesLayout ?? 'auto';

  if (compact && n > 0 && mode !== 'column') return stackLayout(input, W, pad);

  // --- Column arrangement (reference) -----------------------------------------------------------
  let pillW = n > 0 ? clamp(W * 0.31, 112, 230) : 0;
  let devGap = n > 0 ? clamp(W * 0.075, 24, 72) : 0;
  let m = diagramMetrics(input, W - 2 * pad - pillW - devGap);
  let columns = n > 0 ? [input.devices] : [];
  let gridMode = false;
  let tileGap = 0;

  // --- Grid arrangement: several columns fed by a bus -------------------------------------------
  if (n > 1 && mode !== 'column') {
    const columnH = stackHeight(n, m.pillH, m.pillGap);
    const diagramH = m.above + m.below;
    const tooTall = columnH > Math.max(diagramH * 1.2, 4 * (m.pillH + m.pillGap));
    if (mode === 'grid' || tooTall) {
      const gutter = 26;
      const minTile = compact ? 118 : 136;
      const areaW = clamp(W * (compact ? 0.52 : 0.47), 250, 460);
      const gap = clamp(W * 0.05, 30, 56);
      const avail = W - 2 * pad - areaW - gap;
      const maxCols = Math.max(1, Math.floor((avail + gutter) / (minTile + gutter)));
      let count: number;
      if (input.devicesColumns && input.devicesColumns > 0) {
        count = Math.min(input.devicesColumns, maxCols, n);
      } else {
        const corridor = clamp(m.pillH * 0.55, 20, 26);
        for (count = 2; count < Math.min(maxCols, n); count++) {
          const rows = Math.ceil(n / count);
          if (stackHeight(rows, m.pillH, m.pillGap) + corridor <= diagramH * 1.15) break;
        }
        count = Math.min(count, maxCols, n);
      }
      if (count >= 2 || mode === 'grid') {
        gridMode = true;
        tileGap = gutter;
        pillW = Math.min(240, (avail - (count - 1) * gutter) / count);
        devGap = gap;
        const devicesW = count * pillW + (count - 1) * gutter;
        m = diagramMetrics(input, W - 2 * pad - devGap - devicesW);
        // Two-line pills (name then value): slightly taller.
        m.pillH = Math.max(m.pillH, 44);
        const rows = Math.ceil(n / count);
        columns = [];
        for (let c = 0; c < count; c++) {
          const slice = input.devices.slice(c * rows, (c + 1) * rows);
          if (slice.length) columns.push(slice);
        }
      }
    }
  }

  const devicesW = n > 0 ? columns.length * pillW + (columns.length - 1) * tileGap : 0;
  const totalW = m.width + (n > 0 ? devGap + devicesW : 0);
  const offsetX = pad + Math.max(0, (W - 2 * pad - totalW) / 2);

  // --- Vertical: home is aligned with the center of the devices (or the bus corridor) ----------
  const { pillH, pillGap } = m;
  const corridor = clamp(pillH * 0.55, 20, 26);
  const rows = columns.reduce((acc, c) => Math.max(acc, c.length), 0);
  const aboveCount = gridMode ? Math.ceil(rows / 2) : 0;
  let devAbove = 0;
  let devBelow = 0;
  if (gridMode) {
    devAbove = corridor / 2 + stackHeight(aboveCount, pillH, pillGap);
    devBelow = corridor / 2 + stackHeight(rows - aboveCount, pillH, pillGap);
  } else if (n > 0) {
    devAbove = devBelow = stackHeight(n, pillH, pillGap) / 2;
  }
  const yMid = pad + Math.max(m.above, devAbove);
  const height = yMid + Math.max(m.below, devBelow) + pad;

  const nodes: Record<string, Rect> = {};
  const { D, Dh, V, spacing } = m;
  const middle = input.solar || input.battery;
  let colX = offsetX + D / 2;
  if (input.grid) {
    nodes.grid = { x: colX, y: yMid, w: D, h: D };
    colX += spacing;
  }
  if (middle) {
    if (input.solar) nodes.solar = { x: colX, y: yMid - V, w: D, h: D };
    if (input.battery) nodes.battery = { x: colX, y: yMid + V, w: D, h: D };
  }
  const homeX = offsetX + m.width - Dh / 2;
  nodes.home = { x: homeX, y: yMid, w: Dh, h: Dh };

  const above: number[] = [];
  columns.forEach((ids, c) => {
    const x = offsetX + m.width + devGap + c * (pillW + tileGap) + pillW / 2;
    if (gridMode) {
      const up = Math.min(ids.length, aboveCount);
      above.push(up);
      ids.forEach((id, i) => {
        const y =
          i < up
            ? yMid - corridor / 2 - (up - 1 - i) * (pillH + pillGap) - pillH / 2
            : yMid + corridor / 2 + (i - up) * (pillH + pillGap) + pillH / 2;
        nodes[id] = { x, y, w: pillW, h: pillH };
      });
    } else {
      const top = yMid - stackHeight(ids.length, pillH, pillGap) / 2;
      ids.forEach((id, i) => {
        nodes[id] = { x, y: top + pillH / 2 + i * (pillH + pillGap), w: pillW, h: pillH };
      });
      // Devices above the home, for the bus when the line style uses one.
      above.push(ids.filter((id) => nodes[id].y < yMid - 0.5).length);
    }
  });

  return {
    width: W,
    height,
    nodes,
    size: D,
    compact,
    devices: { mode: gridMode ? 'grid' : 'column', columns, above, bus: 13 },
  };
}

/** Narrow screens: full-width diagram, devices in a grid below. */
function stackLayout(input: LayoutInput, W: number, pad: number): Layout {
  const n = input.devices.length;
  const m = diagramMetrics(input, W - 2 * pad - 18);
  const { D, Dh, V, spacing } = m;
  const offsetX = pad + Math.max(0, (W - 2 * pad - 18 - m.width) / 2);
  const yMid = pad + m.above;
  const nodes: Record<string, Rect> = {};
  let colX = offsetX + D / 2;
  if (input.grid) {
    nodes.grid = { x: colX, y: yMid, w: D, h: D };
    colX += spacing;
  }
  if (input.solar) nodes.solar = { x: colX, y: yMid - V, w: D, h: D };
  if (input.battery) nodes.battery = { x: colX, y: yMid + V, w: D, h: D };
  nodes.home = { x: offsetX + m.width - Dh / 2, y: yMid, w: Dh, h: Dh };

  const bus = 13;
  const gutter = 22;
  const count = Math.min(n, W >= 300 ? 2 : 1, input.devicesColumns ?? 2);
  const pillH = 46;
  const pillGap = 8;
  const tileW = (W - 2 * pad - bus - (count - 1) * gutter) / count;
  const rows = Math.ceil(n / count);
  const top = yMid + m.below + 30;
  const columns: string[][] = [];
  for (let c = 0; c < count; c++) {
    const ids = input.devices.slice(c * rows, (c + 1) * rows);
    if (!ids.length) continue;
    columns.push(ids);
    const x = pad + bus + c * (tileW + gutter) + tileW / 2;
    ids.forEach((id, i) => {
      nodes[id] = { x, y: top + pillH / 2 + i * (pillH + pillGap), w: tileW, h: pillH };
    });
  }
  return {
    width: W,
    height: top + stackHeight(rows, pillH, pillGap) + pad,
    nodes,
    size: D,
    compact: true,
    devices: { mode: 'stack', columns, above: columns.map(() => 0), bus },
  };
}

export interface Point {
  x: number;
  y: number;
}

/** Point on a node's edge in direction `angle` (degrees, 0 = right, 90 = down). */
export function edgePoint(rect: Rect, angle: number, kind: 'circle' | 'pill', inset = 3): Point {
  const rad = (angle * Math.PI) / 180;
  if (kind === 'pill') {
    // Devices are always connected by their left edge.
    return { x: rect.x - rect.w / 2 + inset, y: rect.y };
  }
  const r = rect.w / 2 - inset;
  return { x: rect.x + Math.cos(rad) * r, y: rect.y + Math.sin(rad) * r };
}

export interface PathGeometry {
  d: string;
  from: Point;
  to: Point;
}

const dir = (angle: number): Point => {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
};

const f = (v: number): string => (Math.round(v * 10) / 10).toString();

/**
 * Bézier curve between two edges. Control points extend the outgoing normal of each end,
 * producing soft quarter arcs or straight lines depending on orientation.
 */
export function curveBetween(
  from: Point,
  fromAngle: number,
  to: Point,
  toAngle: number,
  tension = 0.55,
): PathGeometry {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const d0 = dir(fromAngle);
  const d1 = dir(toAngle);
  const k0 = (Math.abs(d0.x) * dx + Math.abs(d0.y) * dy) * tension;
  const k1 = (Math.abs(d1.x) * dx + Math.abs(d1.y) * dy) * tension;
  const c0 = { x: from.x + d0.x * k0, y: from.y + d0.y * k0 };
  const c1 = { x: to.x + d1.x * k1, y: to.y + d1.y * k1 };
  return {
    d: `M${f(from.x)},${f(from.y)} C${f(c0.x)},${f(c0.y)} ${f(c1.x)},${f(c1.y)} ${f(to.x)},${f(to.y)}`,
    from,
    to,
  };
}

export type SourceFlowId =
  | 'solar_home'
  | 'solar_grid'
  | 'solar_battery'
  | 'grid_home'
  | 'grid_battery'
  | 'battery_home'
  | 'battery_grid';

/** Source flow anchors: [node, exit angle, node, entry angle]. */
export const SOURCE_FLOWS: Record<SourceFlowId, [string, number, string, number]> = {
  solar_home: ['solar', 0, 'home', -90],
  solar_grid: ['solar', 180, 'grid', -90],
  solar_battery: ['solar', 90, 'battery', -90],
  grid_home: ['grid', 0, 'home', 180],
  grid_battery: ['grid', 90, 'battery', 180],
  battery_home: ['battery', 0, 'home', 90],
  battery_grid: ['battery', 180, 'grid', 90],
};

/**
 * Right-angle path with a rounded corner, in the same style as the distribution bus. Used when the
 * two ends are perpendicular (horizontal exit, vertical entry or the opposite). Parallel ends are
 * joined by a straight line.
 */
export function elbowBetween(
  from: Point,
  fromAngle: number,
  to: Point,
  toAngle: number,
  radius: number,
): PathGeometry {
  const d0 = dir(fromAngle);
  const d1 = dir(toAngle);
  const horizontalExit = Math.abs(d0.x) > 0.5;
  const verticalEntry = Math.abs(d1.y) > 0.5;
  if (horizontalExit !== verticalEntry) {
    return { d: `M${f(from.x)},${f(from.y)} L${f(to.x)},${f(to.y)}`, from, to };
  }
  const corner = horizontalExit ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  const inLen = Math.hypot(corner.x - from.x, corner.y - from.y);
  const outLen = Math.hypot(to.x - corner.x, to.y - corner.y);
  const r = Math.max(0, Math.min(radius, inLen, outLen));
  // Unit vectors along the incoming and outgoing segments.
  const ui = inLen > 0 ? { x: (corner.x - from.x) / inLen, y: (corner.y - from.y) / inLen } : d0;
  const uo =
    outLen > 0 ? { x: (to.x - corner.x) / outLen, y: (to.y - corner.y) / outLen } : { x: -d1.x, y: -d1.y };
  const a = { x: corner.x - ui.x * r, y: corner.y - ui.y * r };
  const b = { x: corner.x + uo.x * r, y: corner.y + uo.y * r };
  return {
    d:
      `M${f(from.x)},${f(from.y)} L${f(a.x)},${f(a.y)} ` +
      `Q${f(corner.x)},${f(corner.y)} ${f(b.x)},${f(b.y)} L${f(to.x)},${f(to.y)}`,
    from,
    to,
  };
}

/** Corner radius of the source flows, proportional to the node size. */
export const sourceCornerRadius = (size: number): number => clamp(size * 0.3, 12, 26);

export function sourceFlowPath(
  id: SourceFlowId,
  nodes: Record<string, Rect>,
  style: LineStyle = 'rounded',
): PathGeometry | null {
  const [a, aAngle, b, bAngle] = SOURCE_FLOWS[id];
  const ra = nodes[a];
  const rb = nodes[b];
  if (!ra || !rb) return null;
  if (style === 'straight') {
    // Center to center, starting and ending on the circles' edges.
    const angle = (Math.atan2(rb.y - ra.y, rb.x - ra.x) * 180) / Math.PI;
    const from = edgePoint(ra, angle, 'circle');
    const to = edgePoint(rb, angle + 180, 'circle');
    return { d: `M${f(from.x)},${f(from.y)} L${f(to.x)},${f(to.y)}`, from, to };
  }
  const from = edgePoint(ra, aAngle, 'circle');
  const to = edgePoint(rb, bAngle, 'circle');
  if (style === 'curved') return curveBetween(from, aAngle, to, bAngle);
  return elbowBetween(from, aAngle, to, bAngle, style === 'square' ? 0 : sourceCornerRadius(ra.w));
}

/**
 * Home → device flow in column mode, when the style does not use the distribution bus: a soft curve
 * (`curved`) or a direct line (`straight`). Starts on the home circle, pointing toward the device.
 */
export function deviceFlowPath(home: Rect, device: Rect, style: LineStyle = 'curved'): PathGeometry {
  const to = edgePoint(device, 180, 'pill');
  const raw = (Math.atan2(to.y - home.y, to.x - home.x) * 180) / Math.PI;
  const angle = clamp(raw, -58, 58);
  const from = edgePoint(home, angle, 'circle');
  if (style === 'straight') return { d: `M${f(from.x)},${f(from.y)} L${f(to.x)},${f(to.y)}`, from, to };
  return curveBetween(from, angle, to, 180, 0.5);
}

/** Styles that feed column devices through the distribution bus (right angles). */
export const usesBus = (style: LineStyle): boolean => style === 'rounded' || style === 'square';

/** Radius of the bus corners toward each device. */
export function busCornerRadius(style: LineStyle): number {
  if (style === 'rounded') return 9;
  if (style === 'curved') return 40;
  return 0;
}
