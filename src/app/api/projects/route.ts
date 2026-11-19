import { apiRoute } from '@/server/api-route';
import { createProject } from '@/server/domain/projects';
import { methodNotAllowed, readJsonBody, readStringField, jsonOk } from '@/server/http';

export const dynamic = 'force-dynamic';

/** POST /api/projects — capture a project under a parent (build-spec §7). */
export const POST = apiRoute(
  async ({ db, accessUser, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const project = createProject(db, accessUser, {
      parentId: readStringField(body.data, 'parentId'),
      title: readStringField(body.data, 'title'),
    });
    return jsonOk({ project }, { status: 201 });
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
