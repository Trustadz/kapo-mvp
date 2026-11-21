import { describe, expect, it } from 'vitest';
import {
  TOUCH_AUTOSCROLL_EDGE_PX,
  TOUCH_AUTOSCROLL_MAX_PX,
  TOUCH_LONG_PRESS_MS,
  TOUCH_MOVE_TOLERANCE_PX,
  axisAutoscrollVelocity,
  horizontalAutoscrollVelocity,
  isTouchLikePointer,
  movedBeyondTouchTolerance,
  pointInRect,
  reorderTargetAt,
  rowAtPoint,
  touchDropTargetAt,
  verticalAutoscrollVelocity,
  type TouchRowBounds,
} from '@/lib/touch-drag';

/**
 * Shared touch drag primitives (issue #79).
 *
 * Every list/tree/card view uses these thresholds, hit tests and autoscroll
 * values. The Kanban aliases are covered by their own test file; this one pins
 * the shared contract and the vertical-list geometry the new surfaces use.
 */

describe('touch drag constants', () => {
  it('arms after a 300ms press and tolerates 10px of finger shake', () => {
    expect(TOUCH_LONG_PRESS_MS).toBe(300);
    expect(TOUCH_MOVE_TOLERANCE_PX).toBe(10);
  });

  it('uses a 72px edge band and a 16px per-frame autoscroll cap', () => {
    expect(TOUCH_AUTOSCROLL_EDGE_PX).toBe(72);
    expect(TOUCH_AUTOSCROLL_MAX_PX).toBe(16);
  });
});

describe('pointer detection and press tolerance', () => {
  it('treats touch and pen as touch-like but leaves the mouse alone', () => {
    expect(isTouchLikePointer('touch')).toBe(true);
    expect(isTouchLikePointer('pen')).toBe(true);
    expect(isTouchLikePointer('mouse')).toBe(false);
    expect(isTouchLikePointer('')).toBe(false);
  });

  it('cancels the pending press once movement exceeds the tolerance', () => {
    expect(movedBeyondTouchTolerance(100, 100, 100, 100)).toBe(false);
    expect(movedBeyondTouchTolerance(100, 100, 110, 100)).toBe(false);
    expect(movedBeyondTouchTolerance(100, 100, 111, 100)).toBe(true);
    expect(movedBeyondTouchTolerance(100, 100, 100, 89)).toBe(true);
    // Diagonal movement compares squared distance, not each axis separately.
    expect(movedBeyondTouchTolerance(0, 0, 8, 8)).toBe(true);
    expect(movedBeyondTouchTolerance(0, 0, 8, 0, 10)).toBe(false);
  });
});

describe('autoscroll velocity', () => {
  it('is motionless outside the edge bands', () => {
    expect(verticalAutoscrollVelocity(400, 0, 800)).toBe(0);
    expect(verticalAutoscrollVelocity(TOUCH_AUTOSCROLL_EDGE_PX, 0, 800)).toBe(0);
    expect(
      verticalAutoscrollVelocity(800 - TOUCH_AUTOSCROLL_EDGE_PX, 0, 800),
    ).toBe(0);
  });

  it('scrolls up near the top edge and ramps towards the edge', () => {
    const shallow = verticalAutoscrollVelocity(
      TOUCH_AUTOSCROLL_EDGE_PX / 2,
      0,
      800,
    );
    const deep = verticalAutoscrollVelocity(1, 0, 800);
    expect(shallow).toBeLessThan(0);
    expect(deep).toBeLessThan(shallow);
    expect(deep).toBeGreaterThanOrEqual(-TOUCH_AUTOSCROLL_MAX_PX);
  });

  it('scrolls down near the bottom edge and ramps towards the edge', () => {
    const shallow = verticalAutoscrollVelocity(
      800 - TOUCH_AUTOSCROLL_EDGE_PX / 2,
      0,
      800,
    );
    const deep = verticalAutoscrollVelocity(799, 0, 800);
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBeLessThanOrEqual(TOUCH_AUTOSCROLL_MAX_PX);
  });

  it('clamps a finger that leaves the viewport', () => {
    expect(verticalAutoscrollVelocity(-100, 0, 800)).toBe(
      -TOUCH_AUTOSCROLL_MAX_PX,
    );
    expect(verticalAutoscrollVelocity(900, 0, 800)).toBe(
      TOUCH_AUTOSCROLL_MAX_PX,
    );
  });

  it('does nothing for invalid geometry or tuning', () => {
    expect(axisAutoscrollVelocity(0, 100, 100)).toBe(0);
    expect(axisAutoscrollVelocity(0, 100, 90)).toBe(0);
    expect(axisAutoscrollVelocity(101, 0, 800, 0)).toBe(0);
    expect(axisAutoscrollVelocity(101, 0, 800, 72, 0)).toBe(0);
  });

  it('is axis-agnostic: horizontal is the Kanban equivalent', () => {
    expect(horizontalAutoscrollVelocity(100 + 1, 100, 500)).toBeLessThan(0);
    expect(horizontalAutoscrollVelocity(500 - 1, 100, 500)).toBeGreaterThan(0);
    expect(horizontalAutoscrollVelocity(300, 100, 500)).toBe(0);
  });
});

describe('pointInRect', () => {
  const rect = { left: 100, top: 200, width: 300, height: 100 };

  it('accepts points inside and on the edges', () => {
    expect(pointInRect(250, 250, rect)).toBe(true);
    expect(pointInRect(100, 200, rect)).toBe(true);
    expect(pointInRect(400, 300, rect)).toBe(true);
  });

  it('rejects points outside unless padding covers them', () => {
    expect(pointInRect(99, 250, rect)).toBe(false);
    expect(pointInRect(250, 301, rect)).toBe(false);
    expect(pointInRect(99, 299, rect, 2)).toBe(true);
    expect(pointInRect(250, 303, rect, 4)).toBe(true);
  });
});

describe('vertical hit testing', () => {
  const rows: TouchRowBounds[] = [
    { id: 'a', top: 100, height: 40 },
    { id: 'b', top: 140, height: 40 },
    { id: 'c', top: 180, height: 40 },
  ];

  it('finds the row whose span contains the pointer', () => {
    expect(rowAtPoint(100, rows)?.id).toBe('a');
    expect(rowAtPoint(130, rows)?.id).toBe('a');
    expect(rowAtPoint(141, rows)?.id).toBe('b');
    expect(rowAtPoint(200, rows)?.id).toBe('c');
    expect(rowAtPoint(99, rows)).toBeNull();
    expect(rowAtPoint(221, rows)).toBeNull();
  });

  it('ignores zero-height rows', () => {
    const withHidden = [
      { id: 'hidden', top: 100, height: 0 },
      ...rows,
    ];
    expect(rowAtPoint(105, withHidden)?.id).toBe('a');
    expect(reorderTargetAt(105, withHidden)?.id).toBe('a');
  });

  it('splits rows at the midpoint for before/after reorder', () => {
    expect(reorderTargetAt(110, rows)).toEqual({ id: 'a', edge: 'before' });
    expect(reorderTargetAt(125, rows)).toEqual({ id: 'b', edge: 'before' });
    expect(reorderTargetAt(170, rows)).toEqual({ id: 'c', edge: 'before' });
  });

  it('falls back to the nearest edge above and below the list', () => {
    expect(reorderTargetAt(0, rows)).toEqual({ id: 'a', edge: 'before' });
    expect(reorderTargetAt(999, rows)).toEqual({ id: 'c', edge: 'after' });
    expect(reorderTargetAt(0, [])).toBeNull();
  });

  it('maps over-row drops to 25% edge reorder and middle inside', () => {
    expect(touchDropTargetAt(105, rows)).toEqual({ id: 'a', zone: 'before' });
    expect(touchDropTargetAt(120, rows)).toEqual({ id: 'a', zone: 'inside' });
    expect(touchDropTargetAt(138, rows)).toEqual({ id: 'a', zone: 'after' });
    expect(touchDropTargetAt(141, rows)).toEqual({ id: 'b', zone: 'before' });
    expect(touchDropTargetAt(160, rows)).toEqual({ id: 'b', zone: 'inside' });
    expect(touchDropTargetAt(179, rows)).toEqual({ id: 'b', zone: 'after' });
  });

  it('uses insertion edges in gaps and supports a custom edge ratio', () => {
    const gapped: TouchRowBounds[] = [
      { id: 'a', top: 100, height: 30 },
      { id: 'b', top: 140, height: 30 },
    ];
    expect(touchDropTargetAt(135, gapped)).toEqual({ id: 'b', zone: 'before' });
    expect(touchDropTargetAt(130, rows, 0.5)).toEqual({ id: 'a', zone: 'after' });
    expect(touchDropTargetAt(150, rows, 0.5)).toEqual({ id: 'b', zone: 'before' });
  });

  it('resolves above/below the list without an inside zone', () => {
    expect(touchDropTargetAt(-10, rows)).toEqual({ id: 'a', zone: 'before' });
    expect(touchDropTargetAt(300, rows)).toEqual({ id: 'c', zone: 'after' });
    expect(touchDropTargetAt(300, [])).toBeNull();
  });
});
