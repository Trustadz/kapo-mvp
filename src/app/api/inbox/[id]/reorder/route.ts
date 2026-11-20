import { apiRoute } from '@/server/api-route';
import { reorderInboxProject } from '@/server/domain/inbox';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/**
 * POST /api/inbox/:id/reorder — move an Inbox capture before/after a target in
 * the single global project sequence (issue #53). The capture stays in the
 * Inbox with its status; `after` is resolved to the next visible project
 * server-side and delegated to the existing global reorder.
 */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const project = reorderInboxProject(db, accessUser, params.id, {
      targetId: body.data.targetId,
      edge: body.data.edge,
    });
    return jsonOk({ project });
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
