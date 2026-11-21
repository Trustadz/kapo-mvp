import { apiRoute } from '@/server/api-route';
import { writeAddonValues } from '@/server/domain/project-addons';
import { jsonError, jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string; identifier: string };

/**
 * PATCH /api/projects/:id/addons/:identifier — partial merge of an add-on's
 * values (docs/add-ons.md §3.2). Core field-type validation, the add-on's
 * `validate` hook, audit and FTS all run inside the write transaction.
 */
export const PATCH = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    if (!('values' in body.data)) {
      return jsonError(422, 'validation_failed', 'Provide add-on values.', {
        values: 'Provide at least one value.',
      });
    }
    const result = writeAddonValues(
      db,
      accessUser,
      params.id,
      params.identifier,
      body.data.values,
    );
    return jsonOk({ addon: result });
  },
  { mutation: true },
);

export function GET() {
  return methodNotAllowed(['PATCH']);
}
