'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';
import styles from './Toast.module.css';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastProps {
  open: boolean;
  message: string;
  tone?: ToastTone;
  onClose: () => void;
  /** Auto-dismiss delay in ms; 0 keeps the toast until dismissed. */
  duration?: number;
  /**
   * Monotonic key supplied by `useToastMessage`. It keys the live toast so a
   * repeated identical message remounts the region and is announced again.
   */
  announcementKey?: number;
}

const TONE_ICONS: Record<ToastTone, string> = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
};

/**
 * Dismissible status message for non-blocking feedback.
 *
 * The toast itself is the live region and is keyed on `announcementKey`: a
 * single region that keeps the same text node may not re-announce an identical
 * message, while a remounted one does (issue #33). Success/info are polite and
 * errors are assertive. Feedback never relies on colour alone: each tone uses
 * its own icon shape and the message carries the outcome in words.
 */
export function Toast({
  open,
  message,
  tone = 'success',
  onClose,
  duration = 4000,
  announcementKey = 0,
}: ToastProps) {
  useEffect(() => {
    if (!open || duration <= 0) return;
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [open, duration, onClose, message, announcementKey]);

  if (!open) return null;

  return (
    <div
      key={announcementKey}
      className={cn(styles.toast, styles[tone])}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-toast={tone}
      data-live-region=""
      data-live-sequence={announcementKey}
    >
      <Icon name={TONE_ICONS[tone]} size={20} className={styles.icon} />
      <span className={styles.message} data-toast-message="">
        {message}
      </span>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Dismiss message">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
