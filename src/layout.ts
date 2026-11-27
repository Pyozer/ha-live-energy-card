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
  /**
   * Parent group id of each visible member (`memberId → groupId`). Members stay attached to their
   * group in the same column and on the same side of the bus, inside a single unified card.
   */
  deviceParents?: Record<string, string>;
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

/** An expanded device group and its visible members, drawn together inside one card. */
export interface GroupFrame {
  id: string;
  members: string[];
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
  /** Expanded groups that have at least one visible member, in display order. */
  groups: GroupFrame[];
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

/** A fixed number of device columns: a whole number of at least 1, otherwise automatic. */
const fixedColumns = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;

/** Height of a member row inside an expanded group card: slightly slimmer than a top-level pill. */
export const memberHeight = (pillH: number): number => Math.max(36, pillH - 4);

/**
 * Atomic vertical unit of the device list: either a standalone device (or collapsed group), or an
 * expanded group together with its visible members. A block is never split across columns or across
 * the central corridor in grid mode.
 */
interface DeviceBlock {
  ids: string[];
  group?: GroupFrame;
}

function deviceBlocks(devices: string[], parents?: Record<string, string>): DeviceBlock[] {
  const blocks: DeviceBlock[] = [];
  for (let i = 0; i < devices.length;) {
    const id = devices[i];
    if (!parents?.[id]) {
      const members: string[] = [];
      let j = i + 1;
      while (j < devices.length && parents?.[devices[j]] === id) {
        members.push(devices[j]);
        j++;
      }
      blocks.push(members.length > 0 ? { ids: [id, ...members], group: { id, members } } : { ids: [id] });
      i = j;
    } else {
      blocks.push({ ids: [id] });
      i++;
    }
  }
  return blocks;
}

const deviceBlockHeight = (b: DeviceBlock, pillH: number, memH: number): number =>
  pillH + (b.ids.length - 1) * memH;

const blocksHeight = (blocks: DeviceBlock[], pillH: number, memH: number, gap: number): number =>
  blocks.length > 0
    ? blocks.reduce((acc, b) => acc + deviceBlockHeight(b, pillH, memH), 0) + (blocks.length - 1) * gap
    : 0;

/**
 * Splits ordered device blocks into `count` contiguous non-empty columns, minimizing the tallest
 * column. Ties favor slightly fuller columns on the left.
 */
function partitionColumns(
  blocks: DeviceBlock[],
  count: number,
  pillH: number,
  memH: number,
  gap: number,
): DeviceBlock[][] {
  const n = blocks.length;
  const k = Math.max(1, Math.min(count, n));
  if (k === 1) return n > 0 ? [blocks] : [];

  const heights = blocks.map((b) => deviceBlockHeight(b, pillH, memH));
  const prefix = [0];
  for (const h of heights) prefix.push(prefix[prefix.length - 1] + h);
  const rangeH = (l: number, r: number): number => prefix[r] - prefix[l] + Math.max(0, r - l - 1) * gap;

  // dp[c][i] = minimum tallest column height when partitioning the first `i` blocks into `c` columns.
  const dp: number[][] = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[1][i] = rangeH(0, i);

  for (let c = 2; c <= k; c++) {
    for (let i = c; i <= n; i++) {
      for (let j = c - 1; j < i; j++) {
        const cost = Math.max(dp[c - 1][j], rangeH(j, i));
        // `<=` prefers a larger `j`, i.e., fuller earlier columns on ties (e.g. [4, 3] over [3, 4]).
        if (cost <= dp[c][i]) {
          dp[c][i] = cost;
          cut[c][i] = j;
        }
      }
    }
  }

  const result: DeviceBlock[][] = Array.from({ length: k }, () => []);
  let end = n;
  for (let c = k; c >= 1; c--) {
    const start = c === 1 ? 0 : cut[c][end];
    result[c - 1] = blocks.slice(start, end);
    end = start;
  }
  return result;
}

/**
 * Picks the block boundary `s` (0..blocks.length) that splits a grid column into blocks above and
 * below the central corridor with the smallest maximum height, never splitting inside a group.
 */
function splitCorridor(blocks: DeviceBlock[], pillH: number, memH: number, gap: number): number {
  let best = 0;
  let bestMax = Infinity;
  let bestDiff = Infinity;
  for (let s = 0; s <= blocks.length; s++) {
    const up = blocksHeight(blocks.slice(0, s), pillH, memH, gap);
    const down = blocksHeight(blocks.slice(s), pillH, memH, gap);
    const max = Math.max(up, down);
    const diff = Math.abs(up - down);
    // On an exact tie, prefer more above the corridor (`up >= down`), matching `Math.ceil(rows / 2)`.
    const better =
      max < bestMax - 0.01 ||
      (Math.abs(max - bestMax) <= 0.01 &&
        (diff < bestDiff - 0.01 || (Math.abs(diff - bestDiff) <= 0.01 && up >= down)));
    if (better) {
      best = s;
      bestMax = max;
      bestDiff = diff;
    }
  }
  return best;
}

/** Places a vertical list of device blocks starting at `top`, touching inside each expanded group. */
function placeBlocks(
  blocks: DeviceBlock[],
  x: number,
  top: number,
  w: number,
  pillH: number,
  memH: number,
  gap: number,
  nodes: Record<string, Rect>,
): void {
  let y = top;
  blocks.forEach((b, bi) => {
    if (bi > 0) y += gap;
    b.ids.forEach((id, idx) => {
      const h = idx === 0 ? pillH : memH;
      nodes[id] = { x, y: y + h / 2, w, h };
      y += h;
    });
  });
}

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
  const blocks = deviceBlocks(input.devices, input.deviceParents);
  const groups = blocks.flatMap((b) => (b.group ? [b.group] : []));

  if (narrow && n > 0 && mode !== 'column') return stackLayout(input, W, pad, blocks, groups);

  // --- Column arrangement (reference) -----------------------------------------------------------
  let pillW = n > 0 ? clamp(W * 0.31, 112, 230) : 0;
  let devGap = n > 0 ? clamp(W * 0.075, 24, 72) : 0;
  let m = diagramMetrics(input, W - 2 * pad - pillW - devGap);
  let colBlocks: DeviceBlock[][] = blocks.length > 0 ? [blocks] : [];
  let gridMode = false;
  let tileGap = 0;

  // --- Grid arrangement: several columns fed by a bus -------------------------------------------
  if (n > 1 && mode !== 'column') {
    const columnH = blocksHeight(blocks, m.pillH, memberHeight(m.pillH), m.pillGap);
    const diagramH = m.above + m.below;
    const tooTall = columnH > Math.max(diagramH * 1.2, 4 * (m.pillH + m.pillGap));
    if (mode === 'grid' || tooTall) {
      const gutter = 26;
      const minTile = narrow ? 118 : 136;
      const areaW = clamp(W * (narrow ? 0.52 : 0.47), 250, 460);
      const gap = clamp(W * 0.05, 30, 56);
      const avail = W - 2 * pad - areaW - gap;
      const maxCols = Math.max(1, Math.floor((avail + gutter) / (minTile + gutter)));
      const maxGridCols = Math.min(maxCols, blocks.length);
      const fixed = fixedColumns(input.devicesColumns);
      let count: number;
      if (fixed) {
        count = Math.min(fixed, maxGridCols);
      } else {
        const corridor = clamp(m.pillH * 0.55, 20, 26);
        const memH = memberHeight(m.pillH);
        for (count = 2; count < maxGridCols; count++) {
          const cols = partitionColumns(blocks, count, m.pillH, memH, m.pillGap);
          const maxH = cols.reduce(
            (acc, col) => Math.max(acc, blocksHeight(col, m.pillH, memH, m.pillGap)),
            0,
          );
          if (maxH + corridor <= diagramH * 1.15) break;
        }
        count = Math.min(count, maxGridCols);
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
        colBlocks = partitionColumns(blocks, count, m.pillH, memberHeight(m.pillH), m.pillGap);
      }
    }
  }

  const columns = colBlocks.map((col) => col.flatMap((b) => b.ids));
  const devicesW = n > 0 ? columns.length * pillW + (columns.length - 1) * tileGap : 0;
  const totalW = m.width + (n > 0 ? devGap + devicesW : 0);
  const offsetX = pad + Math.max(0, (W - 2 * pad - totalW) / 2);

  // --- Vertical: home is aligned with the center of the devices (or the bus corridor) ----------
  const { pillH, pillGap } = m;
  const memH = memberHeight(pillH);
  const corridor = clamp(pillH * 0.55, 20, 26);
  const splits = gridMode ? colBlocks.map((col) => splitCorridor(col, pillH, memH, pillGap)) : [];
  let devAbove = 0;
  let devBelow = 0;
  if (gridMode) {
    colBlocks.forEach((col, c) => {
      const s = splits[c];
      devAbove = Math.max(devAbove, corridor / 2 + blocksHeight(col.slice(0, s), pillH, memH, pillGap));
      devBelow = Math.max(devBelow, corridor / 2 + blocksHeight(col.slice(s), pillH, memH, pillGap));
    });
  } else if (n > 0) {
    devAbove = devBelow = blocksHeight(blocks, pillH, memH, pillGap) / 2;
  }
  const yMid = pad + Math.max(m.above, devAbove);
  const height = yMid + Math.max(m.below, devBelow) + pad;

  const { nodes, units } = placeSources(input, m, offsetX, yMid);
  const { D } = m;

  const above: number[] = [];
  colBlocks.forEach((col, c) => {
    const x = offsetX + m.width + devGap + c * (pillW + tileGap) + pillW / 2;
    if (gridMode) {
      const s = splits[c];
      const upBlocks = col.slice(0, s);
      const downBlocks = col.slice(s);
      above.push(upBlocks.reduce((acc, b) => acc + b.ids.length, 0));
      const upH = blocksHeight(upBlocks, pillH, memH, pillGap);
      placeBlocks(upBlocks, x, yMid - corridor / 2 - upH, pillW, pillH, memH, pillGap, nodes);
      placeBlocks(downBlocks, x, yMid + corridor / 2, pillW, pillH, memH, pillGap, nodes);
    } else {
      const top = yMid - blocksHeight(col, pillH, memH, pillGap) / 2;
      placeBlocks(col, x, top, pillW, pillH, memH, pillGap, nodes);
      // Devices above the home, for the bus when the line style uses one.
      above.push(columns[c].filter((id) => nodes[id].y < yMid - 0.5).length);
    }
  });
  // A forced column that does not fit a narrow card falls back to the stack, as `auto` does.
  if (narrow && input.devices.some((id) => nodes[id].x + nodes[id].w / 2 > W))
    return stackLayout(input, W, pad, blocks, groups);

  return {
    width: W,
    height,
    nodes,
    size: D,
    narrow,
    devices: { mode: gridMode ? 'grid' : 'column', columns, above, bus: 13, groups },
    units,
  };
}

/** Narrow screens: full-width diagram, devices in a grid below. */
function stackLayout(
  input: LayoutInput,
  W: number,
  pad: number,
  blocks: DeviceBlock[],
  groups: GroupFrame[],
): Layout {
  const m = diagramMetrics(input, W - 2 * pad - 18);
  const { D } = m;
  const offsetX = pad + Math.max(0, (W - 2 * pad - 18 - m.width) / 2);
  const yMid = pad + m.above;
  const { nodes, units } = placeSources(input, m, offsetX, yMid);

  const bus = 13;
  const gutter = 22;
  const count = Math.min(blocks.length, W >= 300 ? 2 : 1, fixedColumns(input.devicesColumns) ?? 2);
  const pillH = input.smallBubbles ? 40 : 46;
  const memH = memberHeight(pillH);
  const pillGap = input.compact ? 6 : 8;
  const tileW = (W - 2 * pad - bus - (count - 1) * gutter) / count;
  const top = yMid + m.below + (input.compact ? 22 : 30);
  const colBlocks = partitionColumns(blocks, count, pillH, memH, pillGap);
  const columns = colBlocks.map((col) => col.flatMap((b) => b.ids));
  let maxColH = 0;
  colBlocks.forEach((col, c) => {
    const x = pad + bus + c * (tileW + gutter) + tileW / 2;
    placeBlocks(col, x, top, tileW, pillH, memH, pillGap, nodes);
    maxColH = Math.max(maxColH, blocksHeight(col, pillH, memH, pillGap));
  });
  return {
    width: W,
    height: top + maxColH + pad,
    nodes,
    size: D,
    narrow: true,
    devices: { mode: 'stack', columns, above: columns.map(() => 0), bus, groups },
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
