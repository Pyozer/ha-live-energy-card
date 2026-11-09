import type { UnitGroup } from './source-units';
import type { LineStyle } from './types';
import {
  blockHeight,
  feederLength,
  planUnits,
  UNIT_ROW_GAP,
  unitOffsets,
  type UnitPlan,
} from './unit-layout';

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
  /** Compact mode: rows of nodes closer together, for a shorter card. */
  compact?: boolean;
  /** Smaller nodes (and device pills). */
  smallBubbles?: boolean;
  /**
   * Ids of the visible units of the solar and battery nodes, when they are shown unit by unit. The
   * node is then a hub where the units meet (`HUB_SIZE`), with the units in rows next to it.
   */
  solarUnits?: string[];
  batteryUnits?: string[];
}

/** Size of the rect of a hub: a point, where the flows of the units meet. */
export const EDGE_INSET = 3;
export const HUB_SIZE = 2 * EDGE_INSET;

/** Share of the feeder length between the hub and the segment shared by the feeders (the stub). */
const STUB_SHARE = 0.6;

/** Where the feeders of a source shown unit by unit run side by side. */
export interface UnitsLayout {
  /** Diameter of the units. */
  size: number;
  /** Height of the horizontal segment shared by the feeders. */
  trunk: number;
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
  /** Narrow screen: the devices are below the diagram. */
  narrow: boolean;
  devices: DevicesArrangement;
  units: Partial<Record<UnitGroup, UnitsLayout>>;
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
  /** Arrangement of the units of the solar and battery nodes shown unit by unit. */
  plans: Partial<Record<UnitGroup, UnitPlan>>;
}

/**
 * Compact mode, as multiples of the node diameter: distance between the rows of nodes (default 1.3),
 * and the range of the distance between the columns (default 1.3 to 2.3).
 */
const COMPACT_ROW_SPACING = 0.9;
const COMPACT_COLUMN_SPACING = [1.2, 1.7] as const;
/** Small bubbles: the nodes stop growing at this diameter (default 92), the stacked device pills shrink. */
const SMALL_BUBBLE_SIZE = 74;

/** Room a battery caption (charge level) takes under a circle of diameter `size`. */
const captionHeight = (size: number): number => clamp(size * 0.28, 18, 24);

function diagramMetrics(input: LayoutInput, areaW: number): DiagramMetrics {
  const middle = input.solar || input.battery;
  const cols = (input.grid ? 1 : 0) + (middle ? 1 : 0) + 1;
  const fit = cols === 3 ? 3.9 : cols === 2 ? 2.7 : 1.3;
  const D = clamp(areaW / fit, 50, input.smallBubbles ? SMALL_BUBBLE_SIZE : 92);
  const Dh = Math.min(D * 1.16, 104);
  const [minSpacing, maxSpacing] = input.compact ? COMPACT_COLUMN_SPACING : ([1.3, 2.3] as const);
  const spacing = cols > 1 ? clamp((areaW - D / 2 - Dh / 2) / (cols - 1), D * minSpacing, D * maxSpacing) : 0;
  const width = cols > 1 ? D / 2 + spacing * (cols - 1) + Dh / 2 : Dh;
  // Distance between the home row and the solar / battery rows, as a multiple of the node diameter.
  const V = D * (input.compact ? COMPACT_ROW_SPACING : 1.3);
  const pillH = clamp(D * 0.56, 36, 46);
  const plans: DiagramMetrics['plans'] = {};
  if (input.solar && input.solarUnits?.length) plans.solar = planUnits(input.solarUnits.length, width, D);
  if (input.battery && input.batteryUnits?.length)
    plans.battery = planUnits(input.batteryUnits.length, width, D);
  const { solar, battery } = plans;
  return {
    D,
    Dh,
    spacing,
    width,
    V,
    // The nodes sit V from the home, the units beyond. Under a battery: room for its caption (charge level).
    above: input.solar ? (solar ? V + feederLength(solar.size) + blockHeight(solar) : D / 2 + V) : Dh / 2,
    below: input.battery
      ? battery
        ? V + feederLength(battery.size) + blockHeight(battery, captionHeight(battery.size))
        : V + D / 2 + captionHeight(D)
      : Dh / 2,
    pillH,
    pillGap: clamp(pillH * 0.22, 6, 10),
    plans,
  };
}

const stackHeight = (count: number, h: number, gap: number): number =>
  count > 0 ? count * h + (count - 1) * gap : 0;

/**
 * Positions of the grid, solar, battery and home nodes. A source shown unit by unit gets a hub where
 * its node would be, and its units in rows next to it (above the solar hub, below the battery hub).
 */
function placeSources(
  input: LayoutInput,
  m: DiagramMetrics,
  offsetX: number,
  yMid: number,
): Pick<Layout, 'nodes' | 'units'> {
  const { D, Dh, V, spacing } = m;
  const nodes: Record<string, Rect> = {};
  const units: Layout['units'] = {};
  let colX = offsetX + D / 2;
  if (input.grid) {
    nodes.grid = { x: colX, y: yMid, w: D, h: D };
    colX += spacing;
  }

  const place = (group: UnitGroup, ids: string[] | undefined, y: number, side: 1 | -1) => {
    const plan = m.plans[group];
    if (!plan || !ids) {
      nodes[group] = { x: colX, y, w: D, h: D };
      return;
    }
    nodes[group] = { x: colX, y, w: HUB_SIZE, h: HUB_SIZE };
    const feeder = feederLength(plan.size);
    // Under a battery, each row also holds the caption of its units.
    const row = plan.size + (group === 'battery' ? captionHeight(plan.size) : 0) + UNIT_ROW_GAP;
    const center = clamp(colX, offsetX + plan.width / 2, offsetX + m.width - plan.width / 2);
    unitOffsets(plan, side < 0).forEach(({ x, row: r }, i) => {
      nodes[ids[i]] = {
        x: center + x,
        y: y + side * (feeder + plan.size / 2 + r * row),
        w: plan.size,
        h: plan.size,
      };
    });
    // A little past the middle of the feeder: the stub between the hub and the shared segment must
    // leave room for the flows of the hub to turn off it with a visible curve.
    units[group] = { size: plan.size, trunk: y + side * feeder * STUB_SHARE };
  };
  if (input.solar) place('solar', input.solarUnits, yMid - V, -1);
  if (input.battery) place('battery', input.batteryUnits, yMid + V, 1);
  nodes.home = { x: offsetX + m.width - Dh / 2, y: yMid, w: Dh, h: Dh };
  return { nodes, units };
}

export function computeLayout(input: LayoutInput): Layout {
  const W = Math.max(240, input.width);
  const pad = 4;
  const n = input.devices.length;
  const narrow = W < 520;
  const mode = input.devicesLayout ?? 'auto';

  if (narrow && n > 0 && mode !== 'column') return stackLayout(input, W, pad);

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
      const minTile = narrow ? 118 : 136;
      const areaW = clamp(W * (narrow ? 0.52 : 0.47), 250, 460);
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

  const { nodes, units } = placeSources(input, m, offsetX, yMid);
  const { D } = m;

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
    narrow,
    devices: { mode: gridMode ? 'grid' : 'column', columns, above, bus: 13 },
    units,
  };
}

/** Narrow screens: full-width diagram, devices in a grid below. */
function stackLayout(input: LayoutInput, W: number, pad: number): Layout {
  const n = input.devices.length;
  const m = diagramMetrics(input, W - 2 * pad - 18);
  const { D } = m;
  const offsetX = pad + Math.max(0, (W - 2 * pad - 18 - m.width) / 2);
  const yMid = pad + m.above;
  const { nodes, units } = placeSources(input, m, offsetX, yMid);

  const bus = 13;
  const gutter = 22;
  const count = Math.min(n, W >= 300 ? 2 : 1, input.devicesColumns ?? 2);
  const pillH = input.smallBubbles ? 40 : 46;
  const pillGap = input.compact ? 6 : 8;
  const tileW = (W - 2 * pad - bus - (count - 1) * gutter) / count;
  const rows = Math.ceil(n / count);
  const top = yMid + m.below + (input.compact ? 22 : 30);
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
    narrow: true,
    devices: { mode: 'stack', columns, above: columns.map(() => 0), bus },
    units,
  };
}

export interface Point {
  x: number;
  y: number;
}

/** Point on a node's edge in direction `angle` (degrees, 0 = right, 90 = down). */
export function edgePoint(rect: Rect, angle: number, kind: 'circle' | 'pill', inset = EDGE_INSET): Point {
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

/**
 * Where the flows of a hub meet the stub, the vertical segment between the hub and the segment
 * shared by its feeders (`trunk`). The flows turn off the stub (or onto it) through a curve that
 * takes the half of the stub nearest the hub, the corner of the feeders taking the other half, so
 * that no right angle is left at the hub. `point` is the end of that curve on the stub: where the
 * feeders end and where the flows of the hub start (or end). With a null radius (square lines),
 * it is the hub itself.
 */
export function hubJunction(hub: Rect, trunk: number, radius: number): { point: Point; r: number } {
  const stub = trunk - hub.y;
  const r = Math.min(radius, Math.abs(stub) / 2);
  return { point: { x: hub.x, y: hub.y + Math.sign(stub) * r }, r };
}

export function sourceFlowPath(
  id: SourceFlowId,
  nodes: Record<string, Rect>,
  style: LineStyle = 'rounded',
  /** Diameter of the source nodes (a hub has none): the corner radius follows it. */
  size = nodes[SOURCE_FLOWS[id][0]]?.w,
  /** The units of the sources shown unit by unit: their hubs join the flows to their stub. */
  units?: Layout['units'],
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
  const radius = style === 'square' ? 0 : sourceCornerRadius(size);

  // A hub is a point: its flows start on (or end on) the stub of its feeders, not on the hub.
  const pt = (p: Point): string => `${f(p.x)},${f(p.y)}`;
  const stub = (node: string, rect: Rect, angle: number) => {
    const trunk = units?.[node as UnitGroup]?.trunk;
    const j = trunk === undefined ? null : hubJunction(rect, trunk, radius);
    if (!j || !j.r) return null;
    // Leaving (or reaching) the hub sideways: a curve off the stub. Along the stub: the stub itself.
    const side = Math.sign(Math.round(dir(angle).x));
    return {
      point: j.point,
      inner: side ? { x: rect.x + side * j.r, y: rect.y } : j.point,
      curve: side ? `Q${pt(rect)} ` : '',
    };
  };
  const ja = stub(a, ra, aAngle);
  const jb = stub(b, rb, bAngle);
  const elbow = elbowBetween(ja?.inner ?? from, aAngle, jb?.inner ?? to, bAngle, radius);
  if (!ja && !jb) return elbow;
  // With a curve at the start, the elbow's own `M` is dropped: the path begins on the stub.
  const head = ja?.curve ? `M${pt(ja.point)} ${ja.curve}${pt(ja.inner)} ` : '';
  return {
    d:
      (head ? head + elbow.d.slice(elbow.d.indexOf(' ') + 1) : elbow.d) +
      (jb?.curve ? ` ${jb.curve}${pt(jb.point)}` : ''),
    from: ja?.point ?? from,
    to: jb?.point ?? to,
  };
}

/**
 * Vertical, horizontal then vertical path, with rounded corners: from a unit down (or up) to the
 * segment shared by the feeders at height `trunk`, along it, then to the stub of the hub. Each
 * corner takes the room its end leaves it, so the one at the hub is as small as the stub is short.
 */
function zigzag(from: Point, to: Point, trunk: number, radius: number): PathGeometry {
  const dx = to.x - from.x;
  if (Math.abs(dx) < 0.5) return { d: `M${f(from.x)},${f(from.y)} L${f(to.x)},${f(to.y)}`, from, to };
  const r1 = Math.max(0, Math.min(radius, Math.abs(dx) / 2, Math.abs(trunk - from.y)));
  const r2 = Math.max(0, Math.min(radius, Math.abs(dx) / 2, Math.abs(to.y - trunk)));
  const sx = Math.sign(dx);
  const sy1 = Math.sign(trunk - from.y);
  const sy2 = Math.sign(to.y - trunk);
  return {
    d:
      `M${f(from.x)},${f(from.y)} L${f(from.x)},${f(trunk - sy1 * r1)} ` +
      `Q${f(from.x)},${f(trunk)} ${f(from.x + sx * r1)},${f(trunk)} L${f(to.x - sx * r2)},${f(trunk)} ` +
      `Q${f(to.x)},${f(trunk)} ${f(to.x)},${f(trunk + sy2 * r2)} L${f(to.x)},${f(to.y)}`,
    from,
    to,
  };
}

/**
 * Flow between a unit and its hub, in the direction of the power: toward the hub (`towardHub`, a
 * solar unit producing) or away from it (a battery unit charging). Both ends are on the vertical
 * of their center, the hub being a point.
 */
export function unitFlowPath(
  unit: Rect,
  hub: Rect,
  trunk: number,
  style: LineStyle,
  size: number,
  towardHub: boolean,
): PathGeometry {
  // Angle, seen from the unit, of the side facing the hub.
  const facing = hub.y > unit.y ? 90 : -90;
  const edge = edgePoint(unit, facing, 'circle');
  const [fromAngle, toAngle] = towardHub ? [facing, facing + 180] : [facing + 180, facing];
  if (style === 'straight' || style === 'curved') {
    const center = { x: hub.x, y: hub.y };
    const [from, to] = towardHub ? [edge, center] : [center, edge];
    return style === 'curved'
      ? curveBetween(from, fromAngle, to, toAngle)
      : { d: `M${f(from.x)},${f(from.y)} L${f(to.x)},${f(to.y)}`, from, to };
  }
  // Rounded lines: the feeder ends on the stub of the hub, where its flows start.
  const radius = style === 'square' ? 0 : sourceCornerRadius(size);
  const { point } = hubJunction(hub, trunk, radius);
  const [from, to] = towardHub ? [edge, point] : [point, edge];
  return zigzag(from, to, trunk, radius);
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
