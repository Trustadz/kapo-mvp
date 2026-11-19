import { apiRoute } from '@/server/api-route';
import { trashProjects } from '@/server/domain/trash';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/**
 * POST /api/projects/:id/trash — trash the project and its live descendants.
 * Body: { actionId?: string, projectIds?: string[] } for batch operations.
 */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const ids = new Set<string>([params.id]);
    if (Array.isArray(body.data.projectIds)) {
      for (const entry of body.data.projectIds) {
        if (typeof entry === 'string' && entry.length > 0) ids.add(entry);
      }
    }
    const actionId = typeof body.data.actionId === 'string' ? body.data.actionId : null;
    return jsonOk(trashProjects(db, accessUser, [...ids], actionId));
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
