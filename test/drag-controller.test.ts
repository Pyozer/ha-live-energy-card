import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragController, measureBlocks, type DragSpec } from '../src/editor/drag-controller';
import type { DropTarget } from '../src/editor/device-list';

/** The few browser APIs the controller touches, faked: the tests run in Node, without a DOM. */
beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('window', { innerHeight: 800 });
  vi.stubGlobal('document', { scrollingElement: null });
});
afterEach(() => vi.unstubAllGlobals());

const rect = (top: number, bottom: number, left = 0) => ({
  top,
  bottom,
  left,
  right: left + 300,
  width: 300,
  height: bottom - top,
});

interface FakeBlock {
  dataset: { path: string };
  classList: { contains: (c: string) => boolean };
  getBoundingClientRect: () => ReturnType<typeof rect>;
  querySelector: (selector: string) => FakeBlock | null;
  querySelectorAll: (selector: string) => FakeBlock[];
  style: Record<string, string>;
}

const block = (
  path: string,
  top: number,
  bottom: number,
  opts: { group?: boolean; members?: FakeBlock[] } = {},
): FakeBlock => {
  const self: FakeBlock = {
    dataset: { path },
    classList: { contains: (c) => c === 'group' && !!opts.group },
    getBoundingClientRect: () => rect(top, bottom),
    // The header of a block is the first rows of it.
    querySelector: () => ({ ...self, getBoundingClientRect: () => rect(top, top + 40) }),
    querySelectorAll: () => opts.members ?? [],
    style: {},
  };
  return self;
};

describe('measureBlocks', () => {
  it('measures the blocks of a list with their index, and the members of a group', () => {
    const member = block('1.0', 150, 190);
    const list = {
      querySelectorAll: () => [block('0', 0, 100), block('1', 110, 200, { group: true, members: [member] })],
    };
    expect(measureBlocks(list as never)).toEqual([
      { index: 0, block: { top: 0, bottom: 100 }, head: { top: 0, bottom: 40 }, group: false, members: [] },
      {
        index: 1,
        block: { top: 110, bottom: 200 },
        head: { top: 110, bottom: 150 },
        group: true,
        members: [{ index: 0, top: 150, bottom: 190 }],
      },
    ]);
  });

  it('has nothing to measure without a list', () => {
    expect(measureBlocks(null)).toEqual([]);
  });
});

describe('DragController', () => {
  const lifted = block('2', 200, 260);
  const handle = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    closest: () => lifted,
  };
  const pointer = (y: number, extra: Partial<PointerEvent> = {}) =>
    ({
      clientX: 40,
      clientY: y,
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      currentTarget: handle,
      preventDefault: vi.fn(),
      ...extra,
    }) as unknown as PointerEvent;

  const setup = (target: DropTarget | null = { path: [0], position: 'before' }) => {
    const host = {
      addController: vi.fn(),
      requestUpdate: vi.fn(),
      parentNode: null,
      getRootNode: () => ({ host: null }),
    };
    const spec = {
      list: () => ({ getBoundingClientRect: () => rect(100, 500, 20), clientLeft: 1, clientTop: 1 }) as never,
      target: vi.fn(() => target ?? undefined),
      drop: vi.fn(),
    } satisfies DragSpec;
    const drag = new DragController(host as never, spec);
    return { host, spec, drag };
  };

  it('registers with its host', () => {
    const { host, drag } = setup();
    expect(host.addController).toHaveBeenCalledWith(drag);
  });

  it('lifts the block at its size, leaving a gap of the same height, and follows the pointer', () => {
    const { drag, spec, host } = setup();
    drag.start(pointer(210), '2');
    expect(drag.dragging).toBe('2');
    expect(drag.slotHeight).toBe(60);
    expect(lifted.style.width).toBe('300px');
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    expect(host.requestUpdate).toHaveBeenCalled();

    drag.move(pointer(300));
    // The block keeps the point it was grabbed at (10 px under its top), relative to the list.
    expect(lifted.style.top).toBe(`${300 - 10 - 100 - 1}px`);
    expect(lifted.style.left).toBe(`${40 - 40 - 20 - 1}px`);
    expect(spec.target).toHaveBeenLastCalledWith('2', 300);
    expect(drag.target).toEqual({ path: [0], position: 'before' });
  });

  it('only asks its host to render again when the target changes', () => {
    const { drag, host } = setup();
    drag.start(pointer(210), '2');
    drag.move(pointer(300));
    const renders = host.requestUpdate.mock.calls.length;
    drag.move(pointer(305));
    expect(host.requestUpdate).toHaveBeenCalledTimes(renders);
  });

  it('drops where the pointer is released, and puts everything back', () => {
    const { drag, spec } = setup();
    drag.start(pointer(210), '2');
    drag.move(pointer(300));
    drag.end(pointer(120));
    expect(spec.target).toHaveBeenLastCalledWith('2', 120);
    expect(spec.drop).toHaveBeenCalledWith('2', { path: [0], position: 'before' });
    expect(drag.dragging).toBe('');
    expect(drag.target).toBeUndefined();
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('drops nothing when cancelled, or where a drop is not allowed', () => {
    const cancelled = setup();
    cancelled.drag.start(pointer(210), '2');
    cancelled.drag.end(pointer(120), true);
    expect(cancelled.spec.drop).not.toHaveBeenCalled();

    const refused = setup(null);
    refused.drag.start(pointer(210), '2');
    refused.drag.end(pointer(120));
    expect(refused.spec.drop).not.toHaveBeenCalled();
    expect(refused.drag.dragging).toBe('');
  });

  it('ignores a second drag, a click of another button, and moves without a drag', () => {
    const { drag, spec } = setup();
    drag.start(pointer(210, { pointerType: 'mouse', button: 2 }), '2');
    expect(drag.dragging).toBe('');
    drag.move(pointer(300));
    drag.end(pointer(300));
    expect(spec.target).not.toHaveBeenCalled();

    drag.start(pointer(210), '2');
    drag.start(pointer(210), '3');
    expect(drag.dragging).toBe('2');
  });

  it('forgets a drag in progress when its host goes away', () => {
    const { drag } = setup();
    drag.start(pointer(210), '2');
    drag.hostDisconnected();
    expect(drag.dragging).toBe('');
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
