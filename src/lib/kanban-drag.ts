/**
 * Touch/pointer drag helpers for the Kanban view (issue #29).
 *
 * HTML5 drag and drop does not fire for touch, so the Kanban adds a Pointer
 * Events path: long-press to arm, then move. These helpers keep the gesture
 * thresholds and the horizontal autoscroll maths framework-free and testable.
 */

/** Long press needed before a touch pointer becomes a drag. */
export const KANBAN_LONG_PRESS_MS = 300;

/** Movement that turns a pending long press into a normal scroll gesture. */
export const KANBAN_TOUCH_TOLERANCE_PX = 10;

/** Width of the autoscroll band at each end of the Kanban strip. */
export const KANBAN_AUTOSCROLL_EDGE_PX = 64;

/** Fastest horizontal autoscroll step per animation frame. */
export const KANBAN_AUTOSCROLL_MAX_PX = 16;

/** Pointer types that get the long-press drag instead of HTML5 drag. */
export function isTouchLikePointer(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

/**
 * True once a pointer has moved far enough that the long-press gesture should
 * be abandoned. A small tolerance keeps a slightly shaky finger from cancelling
 * the press while still letting a vertical page scroll win immediately.
 */
export function movedBeyondTouchTolerance(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  tolerance: number = KANBAN_TOUCH_TOLERANCE_PX,
): boolean {
  const dx = clientX - startX;
  const dy = clientY - startY;
  return dx * dx + dy * dy > tolerance * tolerance;
}

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
  const width = rectRight - rectLeft;
  if (width <= 0 || edge <= 0 || max <= 0) return 0;
  const clamped = Math.min(Math.max(pointerX, rectLeft), rectRight);
  const distanceFromLeft = clamped - rectLeft;
  const distanceFromRight = rectRight - clamped;
  if (distanceFromLeft < edge) {
    return -Math.ceil(((edge - distanceFromLeft) / edge) * max);
  }
  if (distanceFromRight < edge) {
    return Math.ceil(((edge - distanceFromRight) / edge) * max);
  }
  return 0;
}
