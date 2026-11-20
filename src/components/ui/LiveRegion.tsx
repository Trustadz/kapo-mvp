'use client';

import { cn } from '@/lib/cn';

export type LiveTone = 'polite' | 'assertive';

export interface LiveRegionProps {
  /** Text to announce. Empty strings render nothing instead of an empty status. */
  message: string;
  /**
   * Monotonic announcement counter used as the React key. Every bump remounts
   * the live region, so an identical message repeated inside the toast window
   * is announced again (issue #33).
   */
  sequence?: number;
  tone?: LiveTone;
  className?: string;
}

/**
 * Screen-reader-only live region.
 *
 * A single live region that receives the same text twice may not re-announce
 * it: the text node does not change, so assistive technology sees no mutation.
 * Keying the region on the caller's monotonic `sequence` remounts it for every
 * announcement, including repeated identical messages. Nothing is rendered for
 * an empty message, so closed toasts never leave empty status landmarks behind.
 */
export function LiveRegion({
  message,
  sequence = 0,
  tone = 'polite',
  className,
}: LiveRegionProps) {
  if (!message) return null;
  return (
    <span
      key={sequence}
      className={cn('visually-hidden', className)}
      role={tone === 'assertive' ? 'alert' : 'status'}
      aria-live={tone}
      aria-atomic="true"
      data-live-region=""
      data-live-sequence={sequence}
    >
      {message}
    </span>
  );
}
