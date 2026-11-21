import { apiRoute } from '@/server/api-route';
import {
  getProjectAddonSettings,
  updateProjectAddons,
} from '@/server/domain/project-addons';
import {
  getProjectSettings,
  updateProjectSettings,
  type UpdateProjectSettingsInput,
} from '@/server/domain/projects';
import { jsonError, jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

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

/** GET /api/projects/:id/settings — layout/view settings and add-on configuration. */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  return jsonOk({
    settings: getProjectSettings(db, accessUser, params.id),
    addons: getProjectAddonSettings(db, accessUser, params.id),
  });
});

/**
 * PUT /api/projects/:id/settings — merge layout/view settings and/or the
 * reserved `addons` configuration shape (docs/add-ons.md §3.2).
 */
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
    const hasSettings = Object.keys(input).length > 0;
    const hasAddons = 'addons' in body.data;
    if (!hasSettings && !hasAddons) {
      return jsonError(400, 'no_changes', 'No supported settings were provided.');
    }

    const settings = hasSettings
      ? updateProjectSettings(db, accessUser, params.id, input)
      : getProjectSettings(db, accessUser, params.id);
    const addons = hasAddons
      ? updateProjectAddons(db, accessUser, params.id, body.data.addons)
      : getProjectAddonSettings(db, accessUser, params.id);

    return jsonOk({ settings, addons });
  },
  { mutation: true },
);

export function POST() {
  return methodNotAllowed(['GET', 'PUT']);
}
