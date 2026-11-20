'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Small FLIP helper for reorderable collections (issue #56).
 *
 * The views keep their own order in React state/props. Before the reorder
 * lands we remember where every `[data-flip-key]` element is, and on the next
 * commit — after React has moved the nodes — we play the inverted delta back to
 * zero. This is presentation only: it never touches drop logic, the API or the
 * DOM order.
 *
 * The effect is deliberately dependency-free: it measures once per commit so
 * the stored positions always belong to the immediately preceding layout. The
 * animation only runs when the order signature actually changes and dragging is
 * not in progress, so the HTML5/pointer drag preview never fights it.
 */

export const FLIP_DURATION_MS = 160;
const FLIP_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
/** Ignore sub-pixel/rounding shifts so ordinary refreshes stay still. */
const MOVE_THRESHOLD_PX = 2;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface Position {
  left: number;
  top: number;
}

/** Respect the user's reduced-motion preference for JS-driven motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Stop any in-flight FLIP movement before a new drag starts measuring rects. */
export function cancelFlipAnimations(root?: ParentNode | null): void {
  if (typeof document === 'undefined') return;
  const scope = root ?? document;
  for (const node of scope.querySelectorAll<HTMLElement>('[data-flip-key]')) {
    if (typeof node.getAnimations !== 'function') continue;
    for (const animation of node.getAnimations()) animation.cancel();
  }
}

export function useFlipReorder(
  containerRef: RefObject<HTMLElement | null>,
  signature: string,
  enabled = true,
): void {
  const previous = useRef<Map<string, Position>>(new Map());
  const lastSignature = useRef<string | null>(null);
  const wasEnabled = useRef(enabled);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const nodes = container
      ? Array.from(container.querySelectorAll<HTMLElement>('[data-flip-key]'))
      : [];
    const next = new Map<string, Position>();
    for (const node of nodes) {
      const key = node.dataset.flipKey;
      if (!key) continue;
      const rect = node.getBoundingClientRect();
      next.set(key, { left: rect.left, top: rect.top });
    }

    const orderChanged = lastSignature.current !== null && lastSignature.current !== signature;
    const canAnimate =
      container !== null &&
      enabled &&
      wasEnabled.current &&
      orderChanged &&
      previous.current.size > 0 &&
      !prefersReducedMotion();

    if (canAnimate) {
      for (const node of nodes) {
        const key = node.dataset.flipKey;
        if (!key || typeof node.animate !== 'function') continue;
        const before = previous.current.get(key);
        const after = next.get(key);
        if (!before || !after) continue;
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) < MOVE_THRESHOLD_PX && Math.abs(dy) < MOVE_THRESHOLD_PX) continue;
        node.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: FLIP_DURATION_MS, easing: FLIP_EASING },
        );
      }
    }

    previous.current = next;
    lastSignature.current = signature;
    wasEnabled.current = enabled;
  });
}
