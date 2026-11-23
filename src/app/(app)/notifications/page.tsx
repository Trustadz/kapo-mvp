import { NotificationsPage } from '@/components/notifications/NotificationsPage';
import { toAccessUser } from '@/server/api-route';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db/connection';
import { listNotifications } from '@/server/domain/notifications';
import { NOTIFICATION_PAGE_LIMIT } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/** Full notification history; the top-bar panel links here. */
export default async function NotificationsRoute() {
  const user = await requireUser();
  const page = listNotifications(getDb(), toAccessUser(user), { limit: NOTIFICATION_PAGE_LIMIT });
  return <NotificationsPage initial={page} />;
}
