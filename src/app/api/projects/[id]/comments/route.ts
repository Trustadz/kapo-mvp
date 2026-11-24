import { apiRoute } from '@/server/api-route';
import {
  addProjectComment,
  getProjectCommentsForUser,
} from '@/server/domain/comments';
import { jsonOk, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/**
 * GET  /api/projects/:id/comments — comments, active provider and edit access.
 * POST /api/projects/:id/comments — add a comment through the active provider.
 */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  return jsonOk({ comments: getProjectCommentsForUser(db, accessUser, params.id) });
});

export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    return jsonOk({
      comment: addProjectComment(db, accessUser, params.id, body.data),
    });
  },
  { mutation: true },
);
