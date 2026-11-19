import { apiRoute } from '@/server/api-route';
import { jsonError, jsonOk, readJsonBody, readStringField } from '@/server/http';
import { getDefaultAccountRole } from '@/server/domain/settings';
import {
  assertApplicationAdmin,
  createUser,
  listUsers,
  updateUser,
  type UpdateUserInput,
} from '@/server/domain/users';

export const dynamic = 'force-dynamic';

/**
 * GET   /api/users — account list (Admin only).
 * POST  /api/users — create account { username, email, password, appRole? }.
 * PATCH /api/users — edit account { id, username?, email?, appRole?, password? }.
 *
 * The last application Admin cannot be demoted; the 409 response names the
 * affected account. Application roles never bypass project permissions. New
 * User/Viewer accounts receive their Root project_roles grant in the domain.
 */
export const GET = apiRoute(async ({ db, user }) => {
  assertApplicationAdmin(user);
  return jsonOk({
    users: listUsers(db),
    defaultRole: getDefaultAccountRole(db),
  });
});

export const POST = apiRoute(
  async ({ db, request, user }) => {
    assertApplicationAdmin(user);

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const data = body.data;

    const fields: Record<string, string> = {};
    for (const key of ['username', 'email', 'password', 'appRole'] as const) {
      if (key in data && typeof data[key] !== 'string') fields[key] = 'Expected a text value.';
    }
    if (Object.keys(fields).length > 0) {
      return jsonError(422, 'validation_failed', 'Check the highlighted fields.', fields);
    }

    const created = await createUser(db, {
      username: readStringField(data, 'username'),
      email: readStringField(data, 'email'),
      password: readStringField(data, 'password'),
      ...(typeof data.appRole === 'string' && data.appRole.length > 0
        ? { appRole: data.appRole }
        : {}),
    });
    return jsonOk({ user: created }, { status: 201 });
  },
  { mutation: true },
);

export const PATCH = apiRoute(
  async ({ db, request, user }) => {
    assertApplicationAdmin(user);

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const data = body.data;

    const userId = readStringField(data, 'id');
    if (!userId) {
      return jsonError(422, 'validation_failed', 'Check the highlighted fields.', {
        id: 'Choose an account.',
      });
    }
    const fields: Record<string, string> = {};
    for (const key of ['username', 'email', 'appRole', 'password'] as const) {
      if (key in data && typeof data[key] !== 'string') fields[key] = 'Expected a text value.';
    }
    if (Object.keys(fields).length > 0) {
      return jsonError(422, 'validation_failed', 'Check the highlighted fields.', fields);
    }

    const input: UpdateUserInput = { id: userId };
    for (const key of ['username', 'email', 'appRole', 'password'] as const) {
      if (typeof data[key] === 'string') input[key] = data[key] as string;
    }

    const updated = await updateUser(db, input);
    return jsonOk({ user: updated });
  },
  { mutation: true },
);
