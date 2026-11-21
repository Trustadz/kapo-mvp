'use client';

import { createPortal } from 'react-dom';
import styles from './touch-drag.module.css';

/**
 * Decorative label that follows a long-press drag (issue #79).
 *
 * The insertion line in the list is the real drop preview; the ghost only
 * confirms which row/card is being carried. It is aria-hidden, pointer-events
 * none and rendered in a portal so overflow containers never clip it.
 */
export function TouchDragGhost({
  x,
  y,
  label,
}: {
  x: number;
  y: number;
  label: string;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={styles.ghost}
      data-touch-ghost=""
      aria-hidden="true"
      style={{ transform: `translate3d(${x + 14}px, ${y + 14}px, 0)` }}
    >
      {label}
    </div>,
    document.body,
  );
}
