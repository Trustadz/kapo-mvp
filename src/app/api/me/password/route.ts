import { apiRoute } from '@/server/api-route';
import { readSessionToken } from '@/server/auth/cookies';
import { jsonError, jsonOk, readJsonBody, readStringField } from '@/server/http';
import { changeOwnPassword } from '@/server/domain/users';

export const dynamic = 'force-dynamic';

/**
 * POST /api/me/password — change the signed-in user's password.
 *
 * The current password is always required and verified with scrypt. Other
 * sessions for the account are revoked; the session that made the change stays
 * signed in.
 */
export const POST = apiRoute(
  async ({ db, request, user }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const data = body.data;
    for (const key of ['currentPassword', 'newPassword', 'confirmation'] as const) {
      if (key in data && typeof data[key] !== 'string') {
        return jsonError(422, 'validation_failed', 'Check the highlighted fields.', {
          [key]: 'Expected a text value.',
        });
      }
    }

    const sessionToken = await readSessionToken();
    await changeOwnPassword(db, user.id, sessionToken, {
      currentPassword: readStringField(data, 'currentPassword'),
      newPassword: readStringField(data, 'newPassword'),
      confirmation:
        'confirmation' in data ? readStringField(data, 'confirmation') : undefined,
    });
    return jsonOk({ ok: true });
  },
  { mutation: true },
);
