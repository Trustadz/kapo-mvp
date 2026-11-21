import { apiRoute } from '@/server/api-route';
import { getBackupStatus, rescheduleBackupScheduler } from '@/server/backup';
import { jsonError, jsonOk, readJsonBody } from '@/server/http';
import {
  listAddonApplicationConfigs,
  updateApplicationAddons,
} from '@/server/domain/project-addons';
import {
  getApplicationSettings,
  updateApplicationSettings,
  type UpdateApplicationSettingsInput,
} from '@/server/domain/settings';
import { assertApplicationAdmin } from '@/server/domain/users';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings — application settings and registered add-on modes
 * (Admin only).
 * PUT /api/settings — update defaults, the rolling backup schedule and the
 * Admin-chosen add-on modes (docs/add-ons.md §3.2).
 */
export const GET = apiRoute(async ({ db, user }) => {
  assertApplicationAdmin(user);
  return jsonOk({
    settings: getApplicationSettings(db),
    addons: listAddonApplicationConfigs(db),
  });
});

export const PUT = apiRoute(
  async ({ db, request, user }) => {
    assertApplicationAdmin(user);

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const data = body.data;

    const input: UpdateApplicationSettingsInput = {};
    if ('defaultAccountRole' in data) input.defaultAccountRole = data.defaultAccountRole;
    if ('enabledViews' in data) input.enabledViews = data.enabledViews;
    if ('trashPurgeEnabled' in data) input.trashPurgeEnabled = data.trashPurgeEnabled;
    if ('trashRetentionDays' in data) input.trashRetentionDays = data.trashRetentionDays;
    if ('installationName' in data) input.installationName = data.installationName;
    if ('backupEnabled' in data) input.backupEnabled = data.backupEnabled;
    if ('backupStartTime' in data) input.backupStartTime = data.backupStartTime;
    if ('backupRetention' in data) input.backupRetention = data.backupRetention;

    const hasSettings = Object.keys(input).length > 0;
    const hasAddons = 'addons' in data;
    if (!hasSettings && !hasAddons) {
      return jsonError(400, 'no_changes', 'No supported settings were provided.');
    }

    const settings = hasSettings ? updateApplicationSettings(db, input) : getApplicationSettings(db);
    const addons = hasAddons
      ? updateApplicationAddons(db, data.addons)
      : listAddonApplicationConfigs(db);
    if (hasSettings) rescheduleBackupScheduler();
    return jsonOk({ settings, backupStatus: getBackupStatus(db), addons });
  },
  { mutation: true },
);
