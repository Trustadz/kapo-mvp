import { setAppearanceCookie, setSessionCookie } from '@/server/auth/cookies';
import { createSession } from '@/server/auth/session';
import { hashPassword } from '@/server/auth/password';
import { createRootProject, insertDefaultSettings } from '@/server/db/bootstrap';
import { getDb } from '@/server/db/connection';
import { newId, nowIso } from '@/server/db/util';
import {
  isSameOrigin,
  jsonError,
  jsonOk,
  methodNotAllowed,
  readJsonBody,
  readStringField,
  rejectCrossOrigin,
} from '@/server/http';
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateUsername,
} from '@/lib/validation';

export const dynamic = 'force-dynamic';

class SetupCompleteError extends Error {}

function usersExist(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count > 0;
}

/**
 * POST /api/setup — creates the first application Admin, the Root project, the
 * default Root workflow and application settings, then signs the Admin in.
 * Only valid while the installation has zero users (build-spec §4, §7).
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return rejectCrossOrigin();

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const data = body.data;

  const username = normalizeUsername(readStringField(data, 'username'));
  const email = normalizeEmail(readStringField(data, 'email'));
  const password = readStringField(data, 'password');
  const confirmation = readStringField(data, 'confirmation');

  const fields: Record<string, string> = {};
  const usernameError = validateUsername(username);
  const emailError = validateEmail(email);
  const passwordError = validatePassword(password);
  const confirmationError = validatePasswordConfirmation(password, confirmation);
  if (usernameError) fields.username = usernameError;
  if (emailError) fields.email = emailError;
  if (passwordError) fields.password = passwordError;
  if (confirmationError) fields.confirmation = confirmationError;
  if (Object.keys(fields).length > 0) {
    return jsonError(422, 'validation_failed', 'Check the highlighted fields.', fields);
  }

  if (usersExist()) {
    return jsonError(409, 'setup_complete', 'This installation already has an account.');
  }

  const passwordHash = await hashPassword(password);
  const db = getDb();

  try {
    const result = db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
      if (count.count > 0) throw new SetupCompleteError();

      const createdAt = nowIso();
      const userId = newId();
      db.prepare(
        `INSERT INTO users (id, username, email, password_hash, app_role, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?)`,
      ).run(userId, username, email, passwordHash, createdAt);

      createRootProject(db, userId, createdAt);
      insertDefaultSettings(db);

      const session = createSession(db, userId);
      return { userId, token: session.token, expiresAt: session.expiresAt };
    })();

    await setSessionCookie(result.token, result.expiresAt);
    await setAppearanceCookie('system');
    return jsonOk(
      { user: { id: result.userId, username, appRole: 'admin' } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SetupCompleteError) {
      return jsonError(409, 'setup_complete', 'This installation already has an account.');
    }
    const code = (error as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT') {
      return jsonError(409, 'username_taken', 'That username is already taken.', {
        username: 'That username is already taken.',
      });
    }
    throw error;
  }
}

export function GET() {
  return methodNotAllowed(['POST']);
}
