import { apiRoute } from '@/server/api-route';
import { releaseInboxProject } from '@/server/domain/inbox';
import { jsonOk, methodNotAllowed } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** POST /api/inbox/:id/release — clear the Inbox flag, keep the status. */
export const POST = apiRoute<Params>(
  async ({ db, accessUser, params }) => {
    return jsonOk({ project: releaseInboxProject(db, accessUser, params.id) });
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['POST']);
}
