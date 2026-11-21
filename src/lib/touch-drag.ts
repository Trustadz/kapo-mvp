/**
 * Shared touch/pointer drag helpers (issue #79).
 *
 * HTML5 drag and drop does not fire for touch or pen, so every reorderable
 * surface adds a Pointer Events path: press and hold to arm, then move. The
 * Kanban path from issue #29 introduced the gesture; this module holds the
 * framework-free primitives so Inbox Card/Tree and the project Card/Tree/List
 * views reuse exactly the same thresholds, hit testing and autoscroll maths.
 *
 * Nothing here touches React or the DOM except the small, guarded measurement
 * helpers at the bottom, which lets the thresholds and geometry stay
 * unit-testable.
 */

import { dropZoneAt, type DropZone, type ReorderEdge } from './reorder';

/** Long press needed before a touch pointer becomes a drag. */
export const TOUCH_LONG_PRESS_MS = 300;

/** Movement that turns a pending long press into a normal scroll gesture. */
export const TOUCH_MOVE_TOLERANCE_PX = 10;

/** Width of the autoscroll band at each end of a scrollable axis. */
export const TOUCH_AUTOSCROLL_EDGE_PX = 72;

/** Fastest autoscroll step per animation frame. */
export const TOUCH_AUTOSCROLL_MAX_PX = 16;

/** Pointer types that get the long-press drag instead of HTML5 drag. */
export function isTouchLikePointer(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

/**
 * True once a pointer has moved far enough that the long-press gesture should
 * be abandoned. A small tolerance keeps a slightly shaky finger from cancelling
 * the press while still letting a page scroll win immediately.
 */
export function movedBeyondTouchTolerance(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  tolerance: number = TOUCH_MOVE_TOLERANCE_PX,
): boolean {
  const dx = clientX - startX;
  const dy = clientY - startY;
  return dx * dx + dy * dy > tolerance * tolerance;
}

/**
 * Signed autoscroll velocity along one axis.
 *
 * Returns pixels per animation frame: negative scrolls towards the start of the
 * axis, positive towards the end, 0 in the middle or for invalid geometry. The
 * velocity ramps up linearly inside the edge band and is capped at `max`.
 */
export function axisAutoscrollVelocity(
  pointer: number,
  start: number,
  end: number,
  edge: number = TOUCH_AUTOSCROLL_EDGE_PX,
  max: number = TOUCH_AUTOSCROLL_MAX_PX,
): number {
  const span = end - start;
  if (span <= 0 || edge <= 0 || max <= 0) return 0;
  const clamped = Math.min(Math.max(pointer, start), end);
  const distanceFromStart = clamped - start;
  const distanceFromEnd = end - clamped;
  if (distanceFromStart < edge) {
    return -Math.ceil(((edge - distanceFromStart) / edge) * max);
  }
  if (distanceFromEnd < edge) {
    return Math.ceil(((edge - distanceFromEnd) / edge) * max);
  }
  return 0;
}

/** Autoscroll velocity for a vertically scrolling list. */
export function verticalAutoscrollVelocity(
  pointerY: number,
  rectTop: number,
  rectBottom: number,
  edge: number = TOUCH_AUTOSCROLL_EDGE_PX,
  max: number = TOUCH_AUTOSCROLL_MAX_PX,
): number {
  return axisAutoscrollVelocity(pointerY, rectTop, rectBottom, edge, max);
}

/** Autoscroll velocity for a horizontally scrolling strip (Kanban). */
export function horizontalAutoscrollVelocity(
  pointerX: number,
  rectLeft: number,
  rectRight: number,
  edge: number = TOUCH_AUTOSCROLL_EDGE_PX,
  max: number = TOUCH_AUTOSCROLL_MAX_PX,
): number {
  return axisAutoscrollVelocity(pointerX, rectLeft, rectRight, edge, max);
}

/** A viewport rect, narrowed so tests do not need a real DOMRect. */
export interface TouchRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** True when a viewport point falls inside a rect, optionally padded. */
export function pointInRect(
  x: number,
  y: number,
  rect: TouchRect,
  padding = 0,
): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.left + rect.width + padding &&
    y >= rect.top - padding &&
    y <= rect.top + rect.height + padding
  );
}

/** Vertical bounds of one reorderable row/card. */
export interface TouchRowBounds {
  id: string;
  top: number;
  height: number;
}

/** A before/after reorder resolved from a pointer position. */
export interface TouchReorderTarget {
  id: string;
  edge: ReorderEdge;
}

/** A before/after/inside drop resolved from a pointer position. */
export interface TouchDropTarget {
  id: string;
  zone: DropZone;
}

/**
 * The row whose vertical span contains the pointer, if any.
 *
 * Used for "is the finger actually over a row" checks; unlike
 * `reorderTargetAt` it never falls back to the nearest edge.
 */
export function rowAtPoint(
  clientY: number,
  rows: readonly TouchRowBounds[],
): TouchRowBounds | null {
  for (const row of rows) {
    if (row.height <= 0) continue;
    if (clientY >= row.top && clientY <= row.top + row.height) return row;
  }
  return null;
}

/**
 * Resolve a pointer to a before/after insertion on a vertical list.
 *
 * Rows are split at their midpoint: the first row whose midpoint is below the
 * pointer gets "before"; past the last row means "after the last row". This is
 * the same rule `reorderEdgeAt` uses, but expressed as a target so a List (and
 * the Inbox Card global sequence) can drop even in the gaps between rows.
 */
export function reorderTargetAt(
  clientY: number,
  rows: readonly TouchRowBounds[],
): TouchReorderTarget | null {
  let last: TouchRowBounds | null = null;
  for (const row of rows) {
    if (row.height <= 0) continue;
    last = row;
    if (clientY < row.top + row.height / 2) {
      return { id: row.id, edge: 'before' };
    }
  }
  return last ? { id: last.id, edge: 'after' } : null;
}

/**
 * Resolve a pointer to a row drop target.
 *
 * Over a row the 25% top/bottom bands reorder and the middle means "inside"
 * (reparent / move dialog). In a gap, or above/below the list, the nearest
 * insertion edge is used so a drop never becomes ambiguous.
 */
export function touchDropTargetAt(
  clientY: number,
  rows: readonly TouchRowBounds[],
  edgeRatio = 0.25,
): TouchDropTarget | null {
  const row = rowAtPoint(clientY, rows);
  if (row) {
    return {
      id: row.id,
      zone: dropZoneAt(clientY, row.top, row.height, edgeRatio),
    };
  }
  const edge = reorderTargetAt(clientY, rows);
  return edge ? { id: edge.id, zone: edge.edge } : null;
}

/**
 * Measure every touch drop row inside a container.
 *
 * Rows opt in with `data-touch-target` and carry their id in `data-touch-id`.
 * The dragged row is excluded so the measured list describes the state after
 * the move. Hidden/zero-height rows are skipped by the geometry helpers.
 */
export function measureTouchRows(
  container: HTMLElement,
  excludeId?: string,
): TouchRowBounds[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-touch-target][data-touch-id]'),
  )
    .filter((element) => element.dataset.touchId !== excludeId)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.touchId as string,
        top: rect.top,
        height: rect.height,
      };
    });
}

/** The closest element matching a selector under a viewport point. */
export function touchElementAt(
  x: number,
  y: number,
  selector: string,
): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const element = document.elementFromPoint(x, y);
  const match = element?.closest<HTMLElement>(selector);
  return match ?? null;
}
