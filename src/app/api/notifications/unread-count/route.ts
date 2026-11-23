import { apiRoute } from '@/server/api-route';
import { countUnreadNotifications } from '@/server/domain/notifications';
import { jsonOk, methodNotAllowed } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/notifications/unread-count — badge polling endpoint. */
export const GET = apiRoute(async ({ db, accessUser }) =>
  jsonOk({ unreadCount: countUnreadNotifications(db, accessUser) }),
);

export function POST() {
  return methodNotAllowed(['GET']);
}
