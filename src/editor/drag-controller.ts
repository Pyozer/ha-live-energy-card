import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { DropTarget } from './device-list';
import type { DragBlock, Span } from './drag';

/**
 * Drag and drop of the blocks of a list, with pointer events (mouse, touch and pen) on a handle: the
 * list can be nested and grows with the config, so the geometry is measured on pointer move and the
 * result shown as a gap where the block would land. The block being dragged is lifted out of the
 * list and follows the pointer, while the others close up around the gap.
 *
 * The controller owns the gesture; what is dragged and where it can land is told by a `DragSpec`.
 */

export interface DragSpec {
  /** The list element, which is positioned: the lifted block is placed relative to it. */
  list(): HTMLElement | null;
  /** Where a pointer at height `y` would drop the block `source`, `undefined` when it cannot. */
  target(source: string, y: number): DropTarget | undefined;
  /** Applies a drop. */
  drop(source: string, target: DropTarget): void;
}

interface Gesture {
  el: HTMLElement;
  scroller: HTMLElement | null;
  grabX: number;
  grabY: number;
  x: number;
  y: number;
}

const sameTarget = (a: DropTarget | undefined, b: DropTarget | undefined): boolean =>
  a?.position === b?.position && a?.path.join('.') === b?.path.join('.');

/** Blocks as laid out on screen, with their members when they have some. The lifted one is left out. */
export function measureBlocks(list: ParentNode | null): DragBlock[] {
  const span = (el: Element | null): Span => {
    const r = el!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  };
  const indexOf = (el: Element) => Number((el as HTMLElement).dataset.path!.split('.').pop());
  return [...(list?.querySelectorAll(':scope > .device:not(.lifted)') ?? [])].map((el) => ({
    index: indexOf(el),
    block: span(el),
    head: span(el.querySelector(':scope > .device-head')),
    group: el.classList.contains('group'),
    members: [...el.querySelectorAll(':scope > .members > .device:not(.lifted)')].map((m) => ({
      index: indexOf(m),
      ...span(m),
    })),
  }));
}

export class DragController implements ReactiveController {
  /** Key of the block being dragged, empty when none. */
  dragging = '';
  /** Where the block would land, `undefined` when it cannot be dropped there. */
  target?: DropTarget;
  /** Height (px) of the gap left for the dragged block. */
  slotHeight = 0;
  private gesture?: Gesture;
  private frame = 0;

  constructor(
    private readonly host: ReactiveControllerHost & HTMLElement,
    private readonly spec: DragSpec,
  ) {
    host.addController(this);
  }

  hostDisconnected(): void {
    cancelAnimationFrame(this.frame);
    this.gesture = undefined;
    this.dragging = '';
    this.target = undefined;
  }

  start(ev: PointerEvent, key: string): void {
    if (this.dragging || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    ev.preventDefault();
    const handle = ev.currentTarget as HTMLElement;
    handle.setPointerCapture(ev.pointerId);
    const el = handle.closest('.device') as HTMLElement;
    const box = el.getBoundingClientRect();
    this.gesture = {
      el,
      scroller: this.scrollParent(),
      grabX: ev.clientX - box.left,
      grabY: ev.clientY - box.top,
      x: ev.clientX,
      y: ev.clientY,
    };
    // Lifted out of the list at its current size; a gap of the same size stays in its place.
    el.style.width = `${box.width}px`;
    this.slotHeight = box.height;
    this.dragging = key;
    this.host.requestUpdate();
    this.loop();
  }

  move(ev: PointerEvent): void {
    if (!this.gesture) return;
    this.gesture.x = ev.clientX;
    this.gesture.y = ev.clientY;
    this.follow();
    this.updateTarget();
  }

  end(ev: PointerEvent, cancel = false): void {
    const g = this.gesture;
    if (!g) return;
    cancelAnimationFrame(this.frame);
    // The release point decides, even if no frame ran since the last move.
    g.y = ev.clientY;
    this.updateTarget();
    (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
    g.el.style.cssText = '';
    const source = this.dragging;
    const target = cancel ? undefined : this.target;
    this.gesture = undefined;
    this.dragging = '';
    this.target = undefined;
    this.host.requestUpdate();
    if (target) this.spec.drop(source, target);
  }

  /** While dragging: scrolls near the edges, and keeps the block and the gap current. */
  private loop = (): void => {
    if (!this.gesture) return;
    this.scrollNearEdge();
    this.follow();
    this.updateTarget();
    this.frame = requestAnimationFrame(this.loop);
  };

  private updateTarget(): void {
    const target = this.spec.target(this.dragging, this.gesture!.y);
    if (sameTarget(target, this.target)) return;
    this.target = target;
    this.host.requestUpdate();
  }

  /** Makes the lifted block follow the pointer, wherever the list is scrolled to. */
  private follow(): void {
    const g = this.gesture!;
    const list = this.spec.list()!;
    const box = list.getBoundingClientRect();
    g.el.style.left = `${g.x - g.grabX - box.left - list.clientLeft}px`;
    g.el.style.top = `${g.y - g.grabY - box.top - list.clientTop}px`;
  }

  /** Closest scrollable ancestor, crossing shadow roots (the editor lives in a dialog), else the page. */
  private scrollParent(): HTMLElement | null {
    let node: Node | null = this.host.parentNode ?? (this.host.getRootNode() as ShadowRoot).host;
    while (node) {
      if (node instanceof HTMLElement) {
        const overflow = getComputedStyle(node).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight)
          return node;
      }
      node = node.parentNode ?? (node as ShadowRoot).host ?? null;
    }
    return document.scrollingElement as HTMLElement | null;
  }

  private scrollNearEdge(): void {
    const g = this.gesture!;
    const el = g.scroller;
    // The page itself scrolls when no ancestor does: its edges are the window's.
    const rect =
      el && el !== document.scrollingElement
        ? el.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    const step = g.y < top + 48 ? -12 : g.y > bottom - 48 ? 12 : 0;
    if (step) el?.scrollBy(0, step);
  }
}
