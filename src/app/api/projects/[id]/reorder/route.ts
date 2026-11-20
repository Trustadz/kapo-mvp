import { apiRoute } from '@/server/api-route';
import { reorderProject } from '@/server/domain/projects';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** POST /api/projects/:id/reorder — global project-priority rewrite (two-phase). */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const project = reorderProject(db, accessUser, params.id, {
      statusId: body.data.statusId,
      beforeId: body.data.beforeId,
    });
    return jsonOk({ project });
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
