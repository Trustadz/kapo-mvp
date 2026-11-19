import { apiRoute } from '@/server/api-route';
import {
  getProjectSettings,
  updateProjectSettings,
  type UpdateProjectSettingsInput,
} from '@/server/domain/projects';
import { jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

const SETTING_KEYS = [
  'inherit_layout',
  'child_position',
  'default_view',
  'enabled_views',
  'hidden_statuses',
  'skip_inbox',
  'layout_template',
  'view_fields',
] as const;

/** GET /api/projects/:id/settings — layout and view settings. */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  return jsonOk({ settings: getProjectSettings(db, accessUser, params.id) });
});

/** PUT /api/projects/:id/settings — merge layout/view settings. */
export const PUT = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const input: UpdateProjectSettingsInput = {};
    for (const key of SETTING_KEYS) {
      if (key in body.data) {
        (input as Record<string, unknown>)[key] = body.data[key];
      }
    }
    return jsonOk({ settings: updateProjectSettings(db, accessUser, params.id, input) });
  },
  { mutation: true },
);

export function POST() {
  return methodNotAllowed(['GET', 'PUT']);
}
