import { apiRoute } from '@/server/api-route';
import { setProjectFavorite } from '@/server/domain/projects';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** POST /api/projects/:id/favorite — toggle, or set explicitly with { favorite }. */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const favorite = typeof body.data.favorite === 'boolean' ? body.data.favorite : null;
    return jsonOk(setProjectFavorite(db, accessUser, params.id, favorite));
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
