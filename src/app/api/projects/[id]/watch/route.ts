import { apiRoute } from '@/server/api-route';
import { setProjectWatch } from '@/server/domain/notifications';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** POST /api/projects/:id/watch — toggle, or set explicitly with { watch }. */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const watch = typeof body.data.watch === 'boolean' ? body.data.watch : null;
    return jsonOk(setProjectWatch(db, accessUser, params.id, watch));
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
