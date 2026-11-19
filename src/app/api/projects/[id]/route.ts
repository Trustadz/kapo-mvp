import { apiRoute } from '@/server/api-route';
import { getProjectPageData, updateProject, type UpdateProjectInput } from '@/server/domain/projects';
import { jsonError, jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/projects/:id — project, children, statuses, permissions and activity page. */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  const data = getProjectPageData(db, accessUser, params.id);
  if (!data) return jsonError(404, 'not_found', 'Project not found.');
  return jsonOk(data);
});

/** PATCH /api/projects/:id — title / status / archived (build-spec §7). */
export const PATCH = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const patch: UpdateProjectInput = {};
    if ('title' in body.data) patch.title = body.data.title;
    if ('statusId' in body.data) patch.statusId = body.data.statusId;
    if ('archived' in body.data) patch.archived = body.data.archived;
    if (Object.keys(patch).length === 0) {
      return jsonError(422, 'validation_failed', 'Provide a title, status or archived flag.');
    }
    const result = updateProject(db, accessUser, params.id, patch);
    return jsonOk({ project: result.project });
  },
  { mutation: true },
);

export function PUT() {
  return methodNotAllowed(['GET', 'PATCH']);
}
