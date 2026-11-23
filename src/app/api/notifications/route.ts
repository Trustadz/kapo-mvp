import { apiRoute } from '@/server/api-route';
import { listNotifications, NOTIFICATION_LIST_LIMIT } from '@/server/domain/notifications';
import { jsonOk, methodNotAllowed } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/notifications?cursor=&limit= — the signed-in user's notifications. */
export const GET = apiRoute(async ({ db, accessUser, request }) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : NOTIFICATION_LIST_LIMIT;
  return jsonOk(listNotifications(db, accessUser, { cursor, limit }));
});

export function POST() {
  return methodNotAllowed(['GET']);
}
