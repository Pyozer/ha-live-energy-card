import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowAnimator } from '../src/animator';

/** A `matchMedia` result that records its listeners, as the browser keeps them alive. */
function fakeMotionQuery(matches = false) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  return {
    matches,
    listeners,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.delete(fn),
  };
}

function stubWindow(query: ReturnType<typeof fakeMotionQuery>) {
  vi.stubGlobal('window', { matchMedia: () => query });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
}

describe('FlowAnimator lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not listen to the reduced-motion preference before the card is connected', () => {
    const query = fakeMotionQuery();
    stubWindow(query);
    new FlowAnimator();
    expect(query.listeners.size).toBe(0);
  });

  it('stops listening when the card is disconnected, so a removed card can be collected', () => {
    const query = fakeMotionQuery();
    stubWindow(query);
    const animator = new FlowAnimator();
    animator.connect();
    expect(query.listeners.size).toBe(1);
    animator.disconnect();
    expect(query.listeners.size).toBe(0);
  });

  it('listens once, however many times the card is connected', () => {
    const query = fakeMotionQuery();
    stubWindow(query);
    const animator = new FlowAnimator();
    animator.connect();
    animator.connect();
    expect(query.listeners.size).toBe(1);
    animator.disconnect();
    animator.connect();
    expect(query.listeners.size).toBe(1);
  });

  it('works without a window (tests, server rendering)', () => {
    const animator = new FlowAnimator();
    expect(() => {
      animator.connect();
      animator.disconnect();
    }).not.toThrow();
    expect(animator.step(0.016)).toBe(false);
  });
});
