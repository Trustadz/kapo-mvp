import { apiRoute } from '@/server/api-route';
import { jsonError, jsonOk, readJsonBody } from '@/server/http';
import {
  resolveLandingHref,
  updateOwnProfile,
  type UpdateOwnProfileInput,
} from '@/server/domain/users';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/me — current user + preferences (build-spec §7).
 * PATCH /api/me — profile, landing page, appearance, show_archived and the
 * dashboard layout for the signed-in user. Application role, avatar and
 * password are deliberately not accepted here.
 */
export const GET = apiRoute(async ({ db, user }) =>
  jsonOk({
    user,
    landingHref: resolveLandingHref(db, user),
  }),
);

type PatchBodyResult =
  | { ok: true; input: UpdateOwnProfileInput }
  | { ok: false; response: ReturnType<typeof jsonError> };

function readPatchBody(body: Record<string, unknown>): PatchBodyResult {
  const input: UpdateOwnProfileInput = {};
  const fields: Record<string, string> = {};

  for (const key of ['username', 'email', 'landingPage', 'appearance'] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== 'string') {
      fields[key] = 'Expected a text value.';
      continue;
    }
    input[key] = value;
  }

  if ('showArchived' in body) {
    if (typeof body.showArchived !== 'boolean') {
      fields.showArchived = 'Expected true or false.';
    } else {
      input.showArchived = body.showArchived;
    }
  }

  if ('dashboard' in body) {
    input.dashboard = body.dashboard;
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      response: jsonError(422, 'validation_failed', 'Check the highlighted fields.', fields),
    };
  }
  return { ok: true, input };
}

export const PATCH = apiRoute(
  async ({ db, request, user }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = readPatchBody(body.data);
    if (!parsed.ok) return parsed.response;

    const updated = updateOwnProfile(db, user.id, parsed.input);
    return jsonOk({
      user: updated,
      landingHref: resolveLandingHref(db, updated),
    });
  },
  { mutation: true },
);
