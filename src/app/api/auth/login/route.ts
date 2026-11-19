import { setAppearanceCookie, setSessionCookie } from '@/server/auth/cookies';
import { findUserByUsername } from '@/server/auth/current-user';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { deleteExpiredSessions, createSession } from '@/server/auth/session';
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  loginAttemptKey,
  recordLoginFailure,
} from '@/server/auth/rate-limit';
import { getDb } from '@/server/db/connection';
import {
  clientIp,
  isSameOrigin,
  jsonError,
  jsonOk,
  methodNotAllowed,
  readJsonBody,
  readStringField,
  rejectCrossOrigin,
} from '@/server/http';
import { normalizeUsername } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const INVALID_CREDENTIALS = 'Invalid username or password.';

/** POST /api/auth/login — JSON { username, password }. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return rejectCrossOrigin();

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const username = normalizeUsername(readStringField(body.data, 'username'));
  const password = readStringField(body.data, 'password');

  const fields: Record<string, string> = {};
  if (!username) fields.username = 'Enter your username.';
  if (!password) fields.password = 'Enter your password.';
  if (Object.keys(fields).length > 0) {
    return jsonError(422, 'validation_failed', 'Check the highlighted fields.', fields);
  }

  const rateKey = loginAttemptKey(username, clientIp(request));
  const limit = checkLoginRateLimit(rateKey);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    const response = jsonError(
      429,
      'rate_limited',
      `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
    response.headers.set('retry-after', String(limit.retryAfterSeconds));
    return response;
  }

  const db = getDb();
  deleteExpiredSessions(db);
  const record = findUserByUsername(db, username);

  if (!record) {
    // Spend comparable time whether or not the account exists.
    await hashPassword(password);
    recordLoginFailure(rateKey);
    return jsonError(401, 'invalid_credentials', INVALID_CREDENTIALS);
  }

  const valid = await verifyPassword(password, record.passwordHash);
  if (!valid) {
    recordLoginFailure(rateKey);
    return jsonError(401, 'invalid_credentials', INVALID_CREDENTIALS);
  }

  clearLoginAttempts(rateKey);
  const session = createSession(db, record.id);
  await setSessionCookie(session.token, session.expiresAt);
  await setAppearanceCookie(record.appearance);

  return jsonOk({
    user: {
      id: record.id,
      username: record.username,
      appRole: record.appRole,
      appearance: record.appearance,
    },
  });
}

export function GET() {
  return methodNotAllowed(['POST']);
}
