import { apiRoute } from '@/server/api-route';
import { getMoveInfo, moveProject, moveProjects } from '@/server/domain/projects';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/projects/:id/move — destinations and their workflows for the move dialog. */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  return jsonOk(getMoveInfo(db, accessUser, params.id));
});

/** POST /api/projects/:id/move — reparent with explicit status mapping. */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    // Bulk move for the Tree multiselect (product.md §4/§5). The single-project
    // contract is unchanged when `projectIds` is absent.
    if (Array.isArray(body.data.projectIds)) {
      const ids = new Set<string>([params.id]);
      for (const entry of body.data.projectIds) {
        if (typeof entry === 'string' && entry.length > 0) ids.add(entry);
      }
      const result = moveProjects(db, accessUser, [...ids], {
        destinationId: body.data.destinationId,
        mapping: body.data.mapping,
      });
      return jsonOk(result);
    }
    const project = moveProject(db, accessUser, params.id, {
      destinationId: body.data.destinationId,
      mapping: body.data.mapping,
    });
    return jsonOk({ project });
  },
  { mutation: true },
);

export function PUT() {
  return methodNotAllowed(['GET', 'POST']);
}
