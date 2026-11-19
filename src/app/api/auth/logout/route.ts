import { clearSessionCookie, readSessionToken } from '@/server/auth/cookies';
import { deleteSessionByToken } from '@/server/auth/session';
import { getDb } from '@/server/db/connection';
import {
  isSameOrigin,
  jsonOk,
  methodNotAllowed,
  rejectCrossOrigin,
} from '@/server/http';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — deletes the database session and clears the cookie. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return rejectCrossOrigin();

  const token = await readSessionToken();
  if (token) {
    deleteSessionByToken(getDb(), token);
  }
  await clearSessionCookie();
  return jsonOk({ ok: true });
}

export function GET() {
  return methodNotAllowed(['POST']);
}
