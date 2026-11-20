import { apiRoute } from '@/server/api-route';
import { getBackupStatus, rescheduleBackupScheduler } from '@/server/backup';
import { jsonError, jsonOk, readJsonBody } from '@/server/http';
import {
  getApplicationSettings,
  updateApplicationSettings,
  type UpdateApplicationSettingsInput,
} from '@/server/domain/settings';
import { assertApplicationAdmin } from '@/server/domain/users';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings — application settings (Admin only).
 * PUT /api/settings — update default account role, enabled views and the
 * rolling backup schedule (enabled, local start time, retention).
 *
 * Trash retention is fixed at 30 days by product decision (build-spec §1); a
 * different value is rejected rather than silently ignored. Saving backup
 * settings reschedules the in-process daily backup job without a restart.
 */
export const GET = apiRoute(async ({ db, user }) => {
  assertApplicationAdmin(user);
  return jsonOk({ settings: getApplicationSettings(db) });
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
    if ('trashRetentionDays' in data) input.trashRetentionDays = data.trashRetentionDays;
    if ('installationName' in data) input.installationName = data.installationName;
    if ('backupEnabled' in data) input.backupEnabled = data.backupEnabled;
    if ('backupStartTime' in data) input.backupStartTime = data.backupStartTime;
    if ('backupRetention' in data) input.backupRetention = data.backupRetention;

    if (Object.keys(input).length === 0) {
      return jsonError(400, 'no_changes', 'No supported settings were provided.');
    }

    const settings = updateApplicationSettings(db, input);
    rescheduleBackupScheduler();
    return jsonOk({ settings, backupStatus: getBackupStatus(db) });
  },
  { mutation: true },
);
