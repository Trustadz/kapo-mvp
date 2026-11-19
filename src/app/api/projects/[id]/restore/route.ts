import { apiRoute } from '@/server/api-route';
import { getRestoreInfo, restoreProject } from '@/server/domain/trash';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/projects/:id/restore — restore preview with deferred mappings. */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  return jsonOk(getRestoreInfo(db, accessUser, params.id));
});

/** POST /api/projects/:id/restore — undo the trash action for its subtree. */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    return jsonOk(restoreProject(db, accessUser, params.id, body.data.mapping));
  },
  { mutation: true },
);

export function PUT() {
  return methodNotAllowed(['GET', 'POST']);
}
