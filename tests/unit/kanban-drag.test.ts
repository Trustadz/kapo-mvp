import { describe, expect, it } from 'vitest';
import {
  KANBAN_AUTOSCROLL_EDGE_PX,
  KANBAN_AUTOSCROLL_MAX_PX,
  KANBAN_TOUCH_TOLERANCE_PX,
  autoscrollVelocity,
  isTouchLikePointer,
  movedBeyondTouchTolerance,
} from '@/lib/kanban-drag';

/**
 * Kanban touch gesture (issue #29).
 *
 * The component uses these to decide when a press becomes a drag (so normal
 * page scrolling still works first) and how fast the horizontal strip scrolls
 * when the pointer is held near an edge.
 */

describe('isTouchLikePointer', () => {
  it('recognises touch and pen but leaves the mouse on HTML5 drag', () => {
    expect(isTouchLikePointer('touch')).toBe(true);
    expect(isTouchLikePointer('pen')).toBe(true);
    expect(isTouchLikePointer('mouse')).toBe(false);
    expect(isTouchLikePointer('')).toBe(false);
  });
});

describe('movedBeyondTouchTolerance', () => {
  it('allows a small shaky movement before activation', () => {
    expect(movedBeyondTouchTolerance(10, 10, 10, 10)).toBe(false);
    expect(movedBeyondTouchTolerance(10, 10, 10 + KANBAN_TOUCH_TOLERANCE_PX, 10)).toBe(false);
    expect(movedBeyondTouchTolerance(10, 10, 10, 10 - KANBAN_TOUCH_TOLERANCE_PX)).toBe(false);
  });

  it('cancels the long press once scrolling starts', () => {
    expect(movedBeyondTouchTolerance(10, 10, 10 + KANBAN_TOUCH_TOLERANCE_PX + 1, 10)).toBe(
      true,
    );
    expect(movedBeyondTouchTolerance(10, 10, 10, 10 + KANBAN_TOUCH_TOLERANCE_PX + 1)).toBe(
      true,
    );
    expect(movedBeyondTouchTolerance(0, 0, 8, 8)).toBe(true);
  });

  it('supports an explicit tolerance', () => {
    expect(movedBeyondTouchTolerance(0, 0, 30, 40, 50)).toBe(false);
    expect(movedBeyondTouchTolerance(0, 0, 30, 40, 49)).toBe(true);
  });
});

describe('autoscrollVelocity', () => {
  const left = 100;
  const right = 500;

  it('does not scroll away from the edges', () => {
    expect(autoscrollVelocity(300, left, right)).toBe(0);
    expect(autoscrollVelocity(left + KANBAN_AUTOSCROLL_EDGE_PX, left, right)).toBe(0);
    expect(autoscrollVelocity(right - KANBAN_AUTOSCROLL_EDGE_PX, left, right)).toBe(0);
  });

  it('scrolls left near the left edge and ramps up towards it', () => {
    const shallow = autoscrollVelocity(left + KANBAN_AUTOSCROLL_EDGE_PX / 2, left, right);
    const deep = autoscrollVelocity(left + 1, left, right);
    expect(shallow).toBeLessThan(0);
    expect(deep).toBeLessThan(shallow);
    expect(deep).toBeGreaterThanOrEqual(-KANBAN_AUTOSCROLL_MAX_PX);
  });

  it('scrolls right near the right edge and ramps up towards it', () => {
    const shallow = autoscrollVelocity(right - KANBAN_AUTOSCROLL_EDGE_PX / 2, left, right);
    const deep = autoscrollVelocity(right - 1, left, right);
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBeLessThanOrEqual(KANBAN_AUTOSCROLL_MAX_PX);
  });

  it('clamps a pointer that leaves the strip', () => {
    expect(autoscrollVelocity(left - 100, left, right)).toBe(-KANBAN_AUTOSCROLL_MAX_PX);
    expect(autoscrollVelocity(right + 100, left, right)).toBe(KANBAN_AUTOSCROLL_MAX_PX);
  });

  it('does nothing for a zero-width strip or invalid tuning', () => {
    expect(autoscrollVelocity(0, 100, 100)).toBe(0);
    expect(autoscrollVelocity(0, 100, 90)).toBe(0);
    expect(autoscrollVelocity(101, left, right, 0)).toBe(0);
    expect(autoscrollVelocity(101, left, right, KANBAN_AUTOSCROLL_EDGE_PX, 0)).toBe(0);
  });
});
