/**
 * Touch/pointer drag helpers for the Kanban view (issue #29).
 *
 * HTML5 drag and drop does not fire for touch, so the Kanban adds a Pointer
 * Events path: long-press to arm, then move. The shared gesture primitives live
 * in `touch-drag.ts` (issue #79); this module keeps the Kanban-specific names
 * and defaults so existing imports and tests remain stable.
 */

import {
  TOUCH_LONG_PRESS_MS,
  TOUCH_MOVE_TOLERANCE_PX,
  axisAutoscrollVelocity,
  isTouchLikePointer,
  movedBeyondTouchTolerance,
} from './touch-drag';

export { isTouchLikePointer, movedBeyondTouchTolerance };

/** Long press needed before a touch pointer becomes a drag. */
export const KANBAN_LONG_PRESS_MS = TOUCH_LONG_PRESS_MS;

/** Movement that turns a pending long press into a normal scroll gesture. */
export const KANBAN_TOUCH_TOLERANCE_PX = TOUCH_MOVE_TOLERANCE_PX;

/** Width of the autoscroll band at each end of the Kanban strip. */
export const KANBAN_AUTOSCROLL_EDGE_PX = 64;

/** Fastest horizontal autoscroll step per animation frame. */
export const KANBAN_AUTOSCROLL_MAX_PX = 16;

/**
 * Horizontal scroll velocity for a pointer near the strip edges.
 *
 * Returns a signed number of pixels per animation frame: negative scrolls left,
 * positive scrolls right, 0 means no autoscroll. The velocity ramps up linearly
 * as the pointer moves into the edge band and is capped at `max`.
 */
export function autoscrollVelocity(
  pointerX: number,
  rectLeft: number,
  rectRight: number,
  edge: number = KANBAN_AUTOSCROLL_EDGE_PX,
  max: number = KANBAN_AUTOSCROLL_MAX_PX,
): number {
  return axisAutoscrollVelocity(pointerX, rectLeft, rectRight, edge, max);
}
