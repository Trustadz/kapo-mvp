import { setAppearanceCookie, setSessionCookie } from '@/server/auth/cookies';
import { findUserByUsername } from '@/server/auth/current-user';
import { getOidcConfig } from '@/server/auth/oidc';
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
import { resolveLandingHref } from '@/server/domain/users';
import { getI18n } from '@/i18n/server';

export const dynamic = 'force-dynamic';

/** POST /api/auth/login — JSON { username, password }. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return rejectCrossOrigin();

  const { t, locale } = await getI18n();

  if (!getOidcConfig().passwordLoginEnabled) {
    return jsonError(403, 'password_login_disabled', t('auth.passwordLoginDisabled'));
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const username = normalizeUsername(readStringField(body.data, 'username'));
  const password = readStringField(body.data, 'password');

  const fields: Record<string, string> = {};
  if (!username) fields.username = t('auth.usernameRequired');
  if (!password) fields.password = t('auth.passwordRequired');
  if (Object.keys(fields).length > 0) {
    return jsonError(422, 'validation_failed', t('common.checkFields'), fields);
  }

  const rateKey = loginAttemptKey(username, clientIp(request));
  const limit = checkLoginRateLimit(rateKey);
  if (!limit.allowed) {
    const response = jsonError(
      429,
      'rate_limited',
      t('auth.tooManyAttempts'),
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
    return jsonError(401, 'invalid_credentials', t('auth.invalidCredentials'));
  }

  const valid = await verifyPassword(password, record.passwordHash);
  if (!valid) {
    recordLoginFailure(rateKey);
    return jsonError(401, 'invalid_credentials', t('auth.invalidCredentials'));
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
    // Honour the account's landing page (build-spec §4 / profile settings).
    landingHref: resolveLandingHref(db, record),
  });
}

export function GET() {
  return methodNotAllowed(['POST']);
}
