'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  TOUCH_LONG_PRESS_MS,
  horizontalAutoscrollVelocity,
  isTouchLikePointer,
  movedBeyondTouchTolerance,
  verticalAutoscrollVelocity,
} from './touch-drag';
import { cancelFlipAnimations } from './use-flip-reorder';

/**
 * Long-press pointer drag for touch/pen (issue #79).
 *
 * Mirrors the Kanban gesture from issue #29 and generalises it for every
 * reorderable surface:
 *
 * 1. `pointerdown` arms a timer. Before activation nothing is prevented, so a
 *    normal vertical page scroll still wins (movement >10px or pointercancel
 *    clears the press).
 * 2. After ~300ms the press becomes a drag. From then on moves are prevented,
 *    touch scrolling is locked and `onDragMove` lets the view preview a target.
 * 3. `pointerup` delivers the drop; Escape/pointercancel reset without a drop.
 *
 * Mouse pointers are ignored outright so the existing HTML5 drag path is
 * untouched. The hook owns only gesture state; resolving the target under the
 * finger, rendering the ghost and calling the API stay with the view, which
 * keeps the drop semantics identical to the desktop handlers.
 */

export interface TouchDragPoint {
  x: number;
  y: number;
}

export interface TouchPendingPress<T> {
  pointerId: number;
  payload: T;
  startX: number;
  startY: number;
}

export interface TouchActiveDrag<T> extends TouchDragPoint {
  pointerId: number;
  payload: T;
  /** Autoscroll waits for the first move so a long press near an edge is still. */
  moved: boolean;
}

interface PendingInternal<T> extends TouchPendingPress<T> {
  timer: number;
}

export interface UseTouchDragOptions<T> {
  /** Set false to ignore presses (view-level pending state or permissions). */
  enabled: boolean;
  /** Extra per-payload gate after the shared interactive-target check. */
  canStart?: (event: ReactPointerEvent<HTMLElement>, payload: T) => boolean;
  /** The press became a drag; arms visual state and measures the first target. */
  onDragStart?: (payload: T, point: TouchDragPoint) => void;
  /** The finger moved; update the preview from the latest viewport point. */
  onDragMove?: (payload: T, point: TouchDragPoint) => void;
  /** The finger lifted; resolve and apply the drop. */
  onDrop: (payload: T, point: TouchDragPoint) => void;
  /** Escape, pointercancel or unmount reset; clear preview state. */
  onCancel?: (payload: T) => void;
  /** Vertical list scrolling is the default; Kanban passes 'horizontal'. */
  axis?: 'vertical' | 'horizontal';
  /**
   * Element that scrolls while the finger is parked near its edge. Omit to
   * scroll the document viewport (the normal case for lists/trees).
   */
  scrollerRef?: RefObject<HTMLElement | null>;
}

export interface UseTouchDragResult<T> {
  pending: TouchPendingPress<T> | null;
  active: TouchActiveDrag<T> | null;
  start: (event: ReactPointerEvent<HTMLElement>, payload: T) => void;
  handlePointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  handlePointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  handlePointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  handleContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  cancel: () => void;
}

/** Elements that own their press behaviour; a drag must never start there. */
const INTERACTIVE_SELECTOR =
  'a, button, select, input, textarea, label, [data-no-drag]';

export function useTouchDrag<T>(
  options: UseTouchDragOptions<T>,
): UseTouchDragResult<T> {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [pending, setPending] = useState<TouchPendingPress<T> | null>(null);
  const [active, setActive] = useState<TouchActiveDrag<T> | null>(null);
  const pendingRef = useRef<PendingInternal<T> | null>(null);
  const activeRef = useRef<TouchActiveDrag<T> | null>(null);

  const clearPending = useCallback(() => {
    const current = pendingRef.current;
    if (current) window.clearTimeout(current.timer);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const cancel = useCallback(() => {
    const currentPending = pendingRef.current;
    if (currentPending) window.clearTimeout(currentPending.timer);
    pendingRef.current = null;
    const currentActive = activeRef.current;
    activeRef.current = null;
    setPending(null);
    setActive(null);
    if (currentActive) optionsRef.current.onCancel?.(currentActive.payload);
  }, []);

  /** Finish the active drag exactly once, from the latest position. */
  const complete = useCallback(
    (x: number, y: number, pointerId: number) => {
      const current = activeRef.current;
      if (!current || current.pointerId !== pointerId) return;
      activeRef.current = null;
      pendingRef.current = null;
      setPending(null);
      setActive(null);
      optionsRef.current.onDrop(current.payload, { x, y });
    },
    [],
  );

  const start = useCallback(
    (event: ReactPointerEvent<HTMLElement>, payload: T) => {
      const opts = optionsRef.current;
      if (!opts.enabled || !isTouchLikePointer(event.pointerType)) return;
      if (event.button !== 0) return;
      if (typeof window === 'undefined' || !('PointerEvent' in window)) return;
      if (activeRef.current || pendingRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return;
      if (opts.canStart && !opts.canStart(event, payload)) return;

      cancelFlipAnimations();
      const { pointerId, clientX, clientY } = event;
      const element = event.currentTarget;
      try {
        element.setPointerCapture(pointerId);
      } catch {
        // Synthetic events and older browsers may not allow capture; the window
        // listeners below still receive the bubbled moves.
      }
      const timer = window.setTimeout(() => {
        const current = pendingRef.current;
        if (!current || current.pointerId !== pointerId) return;
        pendingRef.current = null;
        setPending(null);
        const next: TouchActiveDrag<T> = {
          pointerId,
          payload,
          x: current.startX,
          y: current.startY,
          moved: false,
        };
        activeRef.current = next;
        setActive(next);
        optionsRef.current.onDragStart?.(payload, { x: next.x, y: next.y });
      }, TOUCH_LONG_PRESS_MS);
      const press: PendingInternal<T> = {
        pointerId,
        payload,
        startX: clientX,
        startY: clientY,
        timer,
      };
      pendingRef.current = press;
      setPending({ pointerId, payload, startX: clientX, startY: clientY });
    },
    [],
  );

  const applyMove = useCallback((event: PointerEvent) => {
    const current = activeRef.current;
    if (!current || current.pointerId !== event.pointerId) return false;
    event.preventDefault();
    if (
      current.moved &&
      current.x === event.clientX &&
      current.y === event.clientY
    ) {
      return true;
    }
    const next: TouchActiveDrag<T> = {
      ...current,
      x: event.clientX,
      y: event.clientY,
      moved: true,
    };
    activeRef.current = next;
    setActive(next);
    optionsRef.current.onDragMove?.(next.payload, {
      x: next.x,
      y: next.y,
    });
    return true;
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const currentPending = pendingRef.current;
      if (currentPending && currentPending.pointerId === event.pointerId) {
        if (
          movedBeyondTouchTolerance(
            currentPending.startX,
            currentPending.startY,
            event.clientX,
            event.clientY,
          )
        ) {
          clearPending();
        }
        return;
      }
      applyMove(event.nativeEvent);
    },
    [applyMove, clearPending],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pendingRef.current?.pointerId === event.pointerId) {
        clearPending();
        return;
      }
      complete(event.clientX, event.clientY, event.pointerId);
    },
    [clearPending, complete],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pendingRef.current?.pointerId === event.pointerId) {
        clearPending();
        return;
      }
      if (activeRef.current?.pointerId === event.pointerId) cancel();
    },
    [cancel, clearPending],
  );

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (pendingRef.current || activeRef.current) event.preventDefault();
  }, []);

  // Clear a pending timer if the view unmounts mid-press.
  useEffect(
    () => () => {
      const current = pendingRef.current;
      if (current) window.clearTimeout(current.timer);
      pendingRef.current = null;
      activeRef.current = null;
    },
    [],
  );

  // Before activation, movement means the user is scrolling, not dragging.
  const pendingPointerId = pending?.pointerId;
  useEffect(() => {
    if (pendingPointerId === undefined) return;
    const onMove = (event: PointerEvent) => {
      const current = pendingRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (
        movedBeyondTouchTolerance(
          current.startX,
          current.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        clearPending();
      }
    };
    const onEnd = (event: PointerEvent) => {
      if (pendingRef.current?.pointerId === event.pointerId) clearPending();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearPending();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [clearPending, pendingPointerId]);

  // Active pointer drag: track the finger, block scrolling, finish or cancel.
  const activePointerId = active?.pointerId;
  useEffect(() => {
    if (activePointerId === undefined) return;
    const onMove = (event: PointerEvent) => applyMove(event);
    const onUp = (event: PointerEvent) =>
      complete(event.clientX, event.clientY, event.pointerId);
    const onCancel = (event: PointerEvent) => {
      if (activeRef.current?.pointerId === event.pointerId) cancel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    const stopTouchScroll = (event: TouchEvent) => event.preventDefault();
    const stopContextMenu = (event: MouseEvent) => event.preventDefault();
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('touchmove', stopTouchScroll, { passive: false });
    document.addEventListener('contextmenu', stopContextMenu, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('touchmove', stopTouchScroll);
      document.removeEventListener('contextmenu', stopContextMenu, true);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [activePointerId, applyMove, cancel, complete]);

  // Edge autoscroll while the finger is parked near a scroll edge.
  useEffect(() => {
    if (activePointerId === undefined) return;
    let frame = 0;
    const tick = () => {
      const current = activeRef.current;
      if (current?.moved) {
        const opts = optionsRef.current;
        let applied = false;
        if (opts.axis === 'horizontal') {
          const scroller = opts.scrollerRef?.current;
          if (scroller) {
            const rect = scroller.getBoundingClientRect();
            const delta = horizontalAutoscrollVelocity(
              current.x,
              rect.left,
              rect.right,
            );
            if (delta !== 0) {
              const previous = scroller.scrollLeft;
              scroller.scrollLeft = previous + delta;
              applied = scroller.scrollLeft !== previous;
            }
          }
        } else {
          const scroller = opts.scrollerRef?.current;
          if (scroller) {
            const rect = scroller.getBoundingClientRect();
            const delta = verticalAutoscrollVelocity(
              current.y,
              rect.top,
              rect.bottom,
            );
            if (delta !== 0) {
              const previous = scroller.scrollTop;
              scroller.scrollTop = previous + delta;
              applied = scroller.scrollTop !== previous;
            }
          } else {
            const delta = verticalAutoscrollVelocity(
              current.y,
              0,
              window.innerHeight,
            );
            if (delta !== 0) {
              const previous = window.scrollY;
              window.scrollBy(0, delta);
              applied = window.scrollY !== previous;
            }
          }
        }
        if (applied) {
          optionsRef.current.onDragMove?.(current.payload, {
            x: current.x,
            y: current.y,
          });
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [activePointerId]);

  return {
    pending,
    active,
    start,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleContextMenu,
    cancel,
  };
}
