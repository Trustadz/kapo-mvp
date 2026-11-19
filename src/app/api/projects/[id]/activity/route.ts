import { apiRoute } from '@/server/api-route';
import { listActivity } from '@/server/domain/audit';
import { canReadProject, loadAccessContext } from '@/server/domain/permissions';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/projects/:id/activity?cursor= — paginated, permission-filtered history. */
export const GET = apiRoute<Params>(async ({ db, accessUser, params, request }) => {
  const ctx = loadAccessContext(db, accessUser);
  if (!canReadProject(ctx, params.id)) {
    return jsonError(404, 'not_found', 'Project not found.');
  }
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  return jsonOk(
    listActivity(db, params.id, {
      cursor,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      canReadTarget: (targetId) => canReadProject(ctx, targetId),
      targetExists: (targetId) => ctx.projectById.has(targetId),
    }),
  );
});

export function POST() {
  return methodNotAllowed(['GET']);
}
