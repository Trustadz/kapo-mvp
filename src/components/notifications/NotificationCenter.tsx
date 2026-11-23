'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Icon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/client';
import { NOTIFICATION_PREVIEW_LIMIT, type NotificationItem } from '@/lib/notifications';
import { cn } from '@/lib/cn';
import {
  announceNotificationsChanged,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  NOTIFICATIONS_CHANGED_EVENT,
} from './api';
import { NotificationList } from './NotificationList';
import styles from './notifications.module.css';

export interface NotificationCenterProps {
  initialUnreadCount: number;
}

const POLL_INTERVAL_MS = 60_000;

function badgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function focusableIn(panel: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => element.offsetParent !== null,
  );
}

/**
 * Bell + unread badge + overflow notification panel.
 *
 * Opening loads the newest page; closing marks every visible unread
 * notification read (the product's chosen panel-close behaviour). The full
 * `/notifications` page owns the paginated history.
 */
export function NotificationCenter({ initialUnreadCount }: NotificationCenterProps) {
  const { t, plural } = useI18n();
  const panelId = `kapo-notifications-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const unreadRef = useRef(unreadCount);
  unreadRef.current = unreadCount;
  const loadSeq = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const readVersion = useRef(0);

  const refreshUnread = useCallback(async () => {
    const version = readVersion.current;
    const result = await fetchUnreadCount();
    // A poll that started before mark-all-read must not restore the old badge.
    if (version !== readVersion.current) return;
    if (result.ok) setUnreadCount(result.data.unreadCount);
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    const result = await fetchNotifications({ limit: NOTIFICATION_PREVIEW_LIMIT });
    // A close or a newer open invalidates this response; never let a stale
    // load restore the badge after the panel already marked things read.
    if (seq !== loadSeq.current || !openRef.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setItems(result.data.notifications);
    setUnreadCount(result.data.unreadCount);
  }, []);

  const markAllRead = useCallback(async () => {
    const previous = unreadRef.current;
    if (previous === 0) return;
    readVersion.current += 1;
    setUnreadCount(0);
    const result = await markNotificationsRead();
    readVersion.current += 1;
    if (!result.ok) {
      setUnreadCount(previous);
      return;
    }
    setUnreadCount(result.data.unreadCount);
    announceNotificationsChanged();
  }, []);

  const closePanel = useCallback(
    (options: { focusTrigger?: boolean; markRead?: boolean } = {}) => {
      loadSeq.current += 1;
      openRef.current = false;
      setOpen(false);
      if (options.focusTrigger) {
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
      if (options.markRead !== false) void markAllRead();
    },
    [markAllRead],
  );

  const openPanel = useCallback(() => {
    openRef.current = true;
    setOpen(true);
    void load();
  }, [load]);

  // Badge freshness: initial sync, 60s polling while visible, and immediate
  // refresh when the window regains focus or another view changes read state.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      // Keep an open panel current so a notification that arrives while it is
      // visible is actually shown before the close marks everything read.
      if (openRef.current) void load();
      else void refreshUnread();
    };
    void refreshUnread();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, [load, refreshUnread]);

  // Outside click closes without stealing focus from the element the user
  // clicked; Escape and the close button return focus to the bell.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        closePanel({ markRead: true });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, closePanel]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel({ focusTrigger: true });
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = focusableIn(panelRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (!panelRef.current.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  };

  const unreadLabel =
    unreadCount > 0
      ? plural('plurals.notificationsUnread', unreadCount)
      : t('notifications.open');

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={unreadLabel}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => (open ? closePanel({ focusTrigger: true }) : openPanel())}
      >
        <Icon name="notifications" size={22} />
        {unreadCount > 0 ? (
          <span className={styles.badge} aria-hidden="true">
            {badgeLabel(unreadCount)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.panel}
          role="dialog"
          aria-label={t('notifications.title')}
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
        >
          <div className={styles.header}>
            <div className={styles.headerText}>
              <h2 className={styles.title}>{t('notifications.title')}</h2>
              <p className={styles.unreadSummary}>
                {unreadCount > 0
                  ? plural('plurals.notificationsUnread', unreadCount)
                  : t('notifications.allRead')}
              </p>
            </div>
            <div className={styles.headerActions}>
              <Link
                href="/notifications"
                className={styles.viewAll}
                onClick={() => closePanel({ markRead: true })}
              >
                {t('notifications.viewAll')}
              </Link>
              <button
                type="button"
                className={styles.close}
                onClick={() => closePanel({ focusTrigger: true })}
                aria-label={t('common.close')}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          </div>

          {loading && items.length === 0 ? (
            <p className={styles.loading} role="status">
              {t('common.loading')}
            </p>
          ) : error ? (
            <div>
              <p className={styles.error} role="alert">
                {error}
              </p>
              <div className={styles.footer}>
                <button type="button" className={styles.loadOlder} onClick={() => void load()}>
                  {t('common.retry')}
                </button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <Icon name="notifications_off" size={20} />
              </span>
              <p className={styles.emptyTitle}>{t('notifications.emptyTitle')}</p>
              <p className={styles.emptyText}>{t('notifications.emptyText')}</p>
            </div>
          ) : (
            <NotificationList
              items={items}
              onNavigate={() => closePanel({ markRead: true })}
            />
          )}

          <div className={cn(styles.footer, styles.panelFooter)}>
            <span>{t('notifications.closeMarksRead')}</span>
            <span className="visually-hidden" aria-live="polite">
              {unreadCount > 0 ? plural('plurals.notificationsUnread', unreadCount) : ''}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
