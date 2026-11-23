import { apiRoute } from '@/server/api-route';
import { markNotificationsRead } from '@/server/domain/notifications';
import { jsonError, jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/read — mark all visible unread notifications read,
 * or only `{ ids: [...] }`. Used when the notification panel closes and by the
 * full notifications page.
 */
export const POST = apiRoute(
  async ({ db, accessUser, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const rawIds = body.data.ids;
    if (rawIds !== undefined && !Array.isArray(rawIds)) {
      return jsonError(422, 'validation_failed', 'Check the highlighted fields.', {
        ids: 'Expected a list of notification ids.',
      });
    }
    const ids = Array.isArray(rawIds)
      ? [...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 100)
      : undefined;
    return jsonOk(markNotificationsRead(db, accessUser, ids));
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
