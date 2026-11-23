import { apiRoute } from '@/server/api-route';
import {
  getProjectDescriptionForUser,
  saveProjectDescription,
} from '@/server/domain/description';
import { jsonOk, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/**
 * GET   /api/projects/:id/description — current record and active provider.
 * PATCH /api/projects/:id/description — save through the active provider.
 *
 * Core owns the record, permissions and plaintext fallback. The provider only
 * supplies `body`, `format` and `plaintext` (docs/add-on-platform.md §4).
 */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  return jsonOk({
    description: getProjectDescriptionForUser(db, accessUser, params.id),
  });
});

export const PATCH = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    return jsonOk({
      description: saveProjectDescription(db, accessUser, params.id, body.data),
    });
  },
  { mutation: true },
);
