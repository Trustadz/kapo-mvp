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
}

const TONE_ICONS: Record<ToastTone, string> = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
};

/** Polite, dismissible status message for non-blocking feedback. */
export function Toast({ open, message, tone = 'success', onClose, duration = 4000 }: ToastProps) {
  useEffect(() => {
    if (!open || duration <= 0) return;
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [open, duration, onClose]);

  if (!open) return null;

  return (
    <div className={cn(styles.toast, styles[tone])} role="status" aria-live="polite">
      <Icon name={TONE_ICONS[tone]} size={20} className={styles.icon} />
      <span className={styles.message}>{message}</span>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Dismiss message">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
