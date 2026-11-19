import { apiRoute } from '@/server/api-route';
import { canReadProject, loadAccessContext } from '@/server/domain/permissions';
import { getWorkflowData, replaceWorkflow } from '@/server/domain/workflow';
import { jsonError, jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/projects/:id/workflow — child workflow plus usage counts (read-only). */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  if (!canReadProject(loadAccessContext(db, accessUser), params.id)) {
    return jsonError(404, 'not_found', 'Project not found.');
  }
  return jsonOk(getWorkflowData(db, params.id));
});

/** PUT /api/projects/:id/workflow — statuses + explicit remapping. */
export const PUT = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    return jsonOk(
      replaceWorkflow(db, accessUser, params.id, body.data.statuses, body.data.mapping),
    );
  },
  { mutation: true },
);

export function POST() {
  return methodNotAllowed(['GET', 'PUT']);
}
