'use client';

import { useCallback, useRef, useState } from 'react';
import type { ToastTone } from './Toast';

export interface Announcement {
  message: string;
  sequence: number;
}

export interface Announcer {
  announcement: Announcement;
  /** Announce a message even when it is identical to the previous one. */
  announce: (message: string) => void;
  clear: () => void;
}

/**
 * Monotonic counter helpers for polite live regions (issue #33).
 *
 * The counter increments on every call, including repeated identical text, so
 * `LiveRegion` can alternate its two slots and reliably re-announce.
 */
export function useAnnouncer(): Announcer {
  const counter = useRef(0);
  const [announcement, setAnnouncement] = useState<Announcement>({
    message: '',
    sequence: 0,
  });

  const announce = useCallback((message: string) => {
    counter.current += 1;
    setAnnouncement({ message, sequence: counter.current });
  }, []);

  const clear = useCallback(() => {
    counter.current += 1;
    setAnnouncement({ message: '', sequence: counter.current });
  }, []);

  return { announcement, announce, clear };
}

export interface ToastMessage {
  message: string;
  tone: ToastTone;
  sequence: number;
}

export interface ToastController {
  toast: ToastMessage | null;
  /** Open (or refresh) the toast; repeated identical messages re-announce. */
  notify: (message: string, tone?: ToastTone) => void;
  dismiss: () => void;
}

/** State helper for the shared Toast: open with a tone and a fresh sequence. */
export function useToastMessage(): ToastController {
  const counter = useRef(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    counter.current += 1;
    setToast({ message, tone, sequence: counter.current });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return { toast, notify, dismiss };
}
