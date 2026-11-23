'use client';

import { postJson, requestJson, type ApiResult } from '@/lib/api-client';
import type { NotificationPage } from '@/lib/notifications';

/** Client-side calls for the notification center and project watch toggle. */

export const NOTIFICATIONS_CHANGED_EVENT = 'kapo:notifications-changed';

/** Lets the shell badge react immediately after the page or panel marks items read. */
export function announceNotificationsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

export function fetchNotifications(options: {
  limit?: number;
  cursor?: string | null;
} = {}): Promise<ApiResult<NotificationPage>> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  return requestJson(`/api/notifications${query ? `?${query}` : ''}`, {
    method: 'GET',
    cache: 'no-store',
  });
}

export function fetchUnreadCount(): Promise<ApiResult<{ unreadCount: number }>> {
  return requestJson('/api/notifications/unread-count', {
    method: 'GET',
    cache: 'no-store',
  });
}

export function markNotificationsRead(
  ids?: readonly string[],
): Promise<ApiResult<{ unreadCount: number }>> {
  return postJson('/api/notifications/read', ids ? { ids } : {}, { keepalive: true });
}

export function setProjectWatch(
  projectId: string,
  watch: boolean | null,
): Promise<ApiResult<{ watching: boolean }>> {
  return postJson(`/api/projects/${projectId}/watch`, { watch });
}
