import { apiRoute } from '@/server/api-route';
import { listInbox } from '@/server/domain/inbox';
import { jsonOk, methodNotAllowed } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/inbox — permission-filtered queue with parent context (read-only). */
export const GET = apiRoute(async ({ db, accessUser }) => {
  return jsonOk({ items: listInbox(db, accessUser) });
});

export function POST() {
  return methodNotAllowed(['GET']);
}
