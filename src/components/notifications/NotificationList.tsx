'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/client';
import { cn } from '@/lib/cn';
import {
  notificationIcon,
  notificationText,
  type NotificationItem,
} from '@/lib/notifications';
import styles from './notifications.module.css';

export interface NotificationListProps {
  items: readonly NotificationItem[];
  variant?: 'panel' | 'page';
  /** Called when a notification link is activated, before navigation. */
  onNavigate?: (item: NotificationItem) => void;
}

/** Shared one-line-per-event list used by the panel and the full page. */
export function NotificationList({ items, variant = 'panel', onNavigate }: NotificationListProps) {
  const { t, locale, formatRelative, formatDateTime } = useI18n();

  return (
    <ul className={cn(styles.list, variant === 'page' && styles.listPage)}>
      {items.map((item) => {
        const message = notificationText(item, locale);
        const icon = notificationIcon(item);
        const unread = item.readAt === null;
        const content = (
          <>
            <span className={styles.itemIcon} aria-hidden="true">
              <Icon name={icon} size={18} />
            </span>
            <span className={styles.itemBody}>
              <span className={styles.message}>{message}</span>
              <span className={styles.meta}>
                <span className={styles.origin}>
                  <Icon
                    name={
                      item.originType === 'project'
                        ? 'folder'
                        : item.originType === 'addon'
                          ? 'extension'
                          : 'campaign'
                    }
                    size={14}
                  />
                  <span>{item.origin}</span>
                </span>
                <time
                  className={styles.time}
                  dateTime={item.createdAt}
                  title={formatDateTime(item.createdAt)}
                >
                  {formatRelative(item.createdAt)}
                </time>
              </span>
            </span>
            {unread ? (
              <>
                <span className={styles.unreadDot} aria-hidden="true" />
                <span className="visually-hidden">{t('notifications.unread')}</span>
              </>
            ) : null}
          </>
        );

        return (
          <li key={item.id} className={cn(styles.item, unread && styles.unread)}>
            {item.href ? (
              <Link href={item.href} className={styles.itemLink} onClick={() => onNavigate?.(item)}>
                {content}
              </Link>
            ) : (
              <div className={styles.itemLink}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
