/**
 * Arrangement of the units of a source shown unit by unit (see `source-units.ts`). Pure geometry,
 * relative to the center of the block:
 *
 *   one row         two rows (staggered, so a unit's feeder passes between the units of the other row)
 *   ◯  ◯  ◯            ◯  ◯  ◯
 *                         ◯  ◯
 *
 * The units sit on one side of the hub, row 0 being the nearest. Rows are never more than two: a
 * third one would hide the feeders of the first.
 */

export interface UnitPlan {
  /** Diameter of a unit. */
  size: number;
  /** Distance between the centers of two neighbors in a row. */
  pitch: number;
  /** Units per row, row 0 first. */
  rows: number[];
  /** The second row is shifted by half a pitch, to stagger it with the first. */
  shifted: boolean;
  /** Width of the block. */
  width: number;
}

/** Smallest size units are given before they wrap on a second row. */
export const UNIT_MIN_SIZE = 44;
/** Space between two units of a row. */
export const UNIT_GAP = 12;
/** Space between the two rows. */
export const UNIT_ROW_GAP = 8;

/** Plans `count` units in `span` px: one row if they fit at the minimum size, two staggered rows otherwise. */
export function planUnits(
  count: number,
  span: number,
  maxSize: number,
  minSize = UNIT_MIN_SIZE,
  gap = UNIT_GAP,
): UnitPlan {
  const fitOnOneRow = Math.max(2, Math.floor((span + gap) / (minSize + gap)));
  const first = count <= fitOnOneRow ? count : Math.ceil(count / 2);
  const rows = first === count ? [count] : [first, count - first];
  // Two rows of the same length are shifted by half a pitch, which takes half a slot more.
  const shifted = rows.length === 2 && rows[0] === rows[1];
  const slots = rows[0] + (shifted ? 0.5 : 0);
  const size = Math.min(maxSize, (span - (slots - 1) * gap) / slots);
  return { size, pitch: size + gap, rows, shifted, width: slots * size + (slots - 1) * gap };
}

/**
 * Center of each unit, in unit order: `x` from the center of the block, and the row. The units fill
 * the rows from the farthest one with `farthestFirst`, so that they read from the top down when the
 * rows are above the hub.
 */
export function unitOffsets(plan: UnitPlan, farthestFirst = false): { x: number; row: number }[] {
  const order = plan.rows.map((_, row) => row);
  if (farthestFirst) order.reverse();
  return order.flatMap((row) =>
    Array.from({ length: plan.rows[row] }, (_, j) => ({
      x:
        (j - (plan.rows[row] - 1) / 2) * plan.pitch +
        (plan.shifted ? (row === 0 ? -1 : 1) * (plan.pitch / 4) : 0),
      row,
    })),
  );
}

/** Height of the rows, `extra` being what each row takes below its units (a caption). */
export const blockHeight = (plan: UnitPlan, extra = 0): number =>
  plan.rows.length * (plan.size + extra) + (plan.rows.length - 1) * UNIT_ROW_GAP;

/** Distance between the hub and the nearest row, where the feeders run side by side. */
export const feederLength = (size: number): number => Math.min(34, Math.max(22, size * 0.5));
