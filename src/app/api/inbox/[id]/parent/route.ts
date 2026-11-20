import { apiRoute } from '@/server/api-route';
import { changeInboxParent } from '@/server/domain/inbox';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/**
 * POST /api/inbox/:id/parent — reparent a capture, keep it in the Inbox and
 * move it to the destination's Start status (issue #15).
 */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const project = changeInboxParent(db, accessUser, params.id, {
      destinationId: body.data.destinationId,
    });
    return jsonOk({ project });
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
