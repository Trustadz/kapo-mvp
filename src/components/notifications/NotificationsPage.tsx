'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Notice } from '@/components/ui/Notice';
import { EmptyState } from '@/components/ui/EmptyState';
import { useI18n } from '@/i18n/client';
import {
  NOTIFICATION_PAGE_LIMIT,
  type NotificationItem,
  type NotificationPage,
} from '@/lib/notifications';
import {
  announceNotificationsChanged,
  fetchNotifications,
  markNotificationsRead,
} from './api';
import { NotificationList } from './NotificationList';
import styles from './notifications.module.css';

export interface NotificationsPageProps {
  initial: NotificationPage;
}

/** Paginated full notification history. The panel previews the newest items. */
export function NotificationsPage({ initial }: NotificationsPageProps) {
  const { t, plural } = useI18n();
  const [items, setItems] = useState<NotificationItem[]>(initial.notifications);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [unreadCount, setUnreadCount] = useState(initial.unreadCount);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadOlder = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    const result = await fetchNotifications({ cursor, limit: NOTIFICATION_PAGE_LIMIT });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setItems((current) => [...current, ...result.data.notifications]);
    setCursor(result.data.nextCursor);
    setUnreadCount(result.data.unreadCount);
  };

  const markOne = async (item: NotificationItem) => {
    if (item.readAt !== null) return;
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((candidate) => (candidate.id === item.id ? { ...candidate, readAt } : candidate)),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    const result = await markNotificationsRead([item.id]);
    if (result.ok) {
      if (!mountedRef.current) return;
      setUnreadCount(result.data.unreadCount);
      announceNotificationsChanged();
      return;
    }
    if (!mountedRef.current) return;
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, readAt: item.readAt } : candidate,
      ),
    );
    setUnreadCount((count) => count + 1);
  };

  const markAll = async () => {
    if (marking || unreadCount === 0) return;
    setMarking(true);
    setError(null);
    const result = await markNotificationsRead();
    setMarking(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
    );
    setUnreadCount(result.data.unreadCount);
    announceNotificationsChanged();
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{t('notifications.title')}</h1>
          <p className={styles.pageSummary}>
            {unreadCount > 0
              ? plural('plurals.notificationsUnread', unreadCount)
              : t('notifications.allRead')}
          </p>
        </div>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => void markAll()}
          loading={marking}
          disabled={unreadCount === 0}
        >
          {t('notifications.markAllRead')}
        </Button>
      </header>

      {error ? (
        <Notice tone="error">
          <span>{error}</span>
        </Notice>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon="notifications_off"
          title={t('notifications.emptyTitle')}
          description={t('notifications.emptyText')}
        />
      ) : (
        <>
          <NotificationList
            items={items}
            variant="page"
            onNavigate={(item) => void markOne(item)}
          />
          {cursor ? (
            <Button
              variant="ghost"
              size="sm"
              className={styles.loadMore}
              onClick={() => void loadOlder()}
              loading={loading}
              icon={<Icon name="history" size={18} />}
            >
              {t('notifications.loadOlder')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
