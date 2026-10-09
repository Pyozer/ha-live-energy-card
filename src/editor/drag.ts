import type { DropTarget } from './device-list';

/**
 * Geometry of the device list while dragging: where a pointer at height `y` would drop the dragged
 * device. Pure (heights in, target out); the editor measures the blocks and shows the result.
 */

export interface Span {
  top: number;
  bottom: number;
}

/** A block measured on screen, with its index in the device list. */
export interface IndexedSpan extends Span {
  index: number;
}

/**
 * A top-level device: its whole block, its header, and the blocks of its members (a group). The
 * block being dragged is left out, so indices can skip it.
 */
export interface DragBlock {
  index: number;
  block: Span;
  head: Span;
  group: boolean;
  members: IndexedSpan[];
}

/** Share of a group header, from its top, that drops before the group instead of into it. */
const BEFORE_BAND = 0.3;
/** Height (px) at the bottom of a group that drops after it. */
const AFTER_BAND = 12;

const middle = (s: Span): number => (s.top + s.bottom) / 2;

/** Index of the span holding `y`, otherwise of the nearest one. */
function nearest(spans: readonly Span[], y: number): number {
  let best = 0;
  let distance = Infinity;
  spans.forEach((s, i) => {
    const d = y < s.top ? s.top - y : y > s.bottom ? y - s.bottom : 0;
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}

/**
 * Drop target for a pointer at height `y`. A group header takes a device in its middle (at the end
 * of its members), its top edge drops before it and its bottom edge after it; among members the
 * device lands before or after the nearest one. A dragged group only moves among the top-level
 * blocks.
 */
export function dropTargetAt(
  blocks: readonly DragBlock[],
  y: number,
  draggingGroup: boolean,
): DropTarget | undefined {
  if (blocks.length === 0) return undefined;
  const b =
    blocks[
      nearest(
        blocks.map((b) => b.block),
        y,
      )
    ];
  const i = b.index;
  const side = (s: Span) => (y < middle(s) ? 'before' : 'after');

  if (draggingGroup || !b.group) return { path: [i], position: side(b.block) };
  if (y < b.head.top + (b.head.bottom - b.head.top) * BEFORE_BAND) return { path: [i], position: 'before' };
  if (y > b.block.bottom - AFTER_BAND) return { path: [i], position: 'after' };
  if (y <= b.head.bottom || b.members.length === 0) return { path: [i], position: 'into' };
  const m = b.members[nearest(b.members, y)];
  return { path: [i, m.index], position: side(m) };
}
