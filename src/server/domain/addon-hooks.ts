import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { listAddons } from '@/server/addons';
import type { AddonFieldValue, AddonMode, AddonValidationIssue } from '@/server/addons';
import { parseJsonObject } from '@/server/db/util';
import { DomainError } from './permissions';

/**
 * Add-on lifecycle hooks (build-spec §12).
 *
 * The registry ships empty in the MVP, so these functions are no-ops today, but
 * every Inbox exit (release, status change, move, workflow remap) goes through
 * here so a future Required add-on can block refinement with inline issues
 * without core code changes. Core invariants always win.
 */

function addonModeFor(db: BetterSqliteDatabase, identifier: string): AddonMode {
  const row = db.prepare('SELECT mode FROM addons WHERE identifier = ?').get(identifier) as
    | { mode: AddonMode }
    | undefined;
  return row?.mode ?? 'optional';
}

function addonValuesFor(
  db: BetterSqliteDatabase,
  projectId: string,
): Record<string, Record<string, AddonFieldValue>> {
  const row = db.prepare('SELECT addon_data FROM projects WHERE id = ?').get(projectId) as
    | { addon_data: string }
    | undefined;
  const data = parseJsonObject(row?.addon_data);
  const values: Record<string, Record<string, AddonFieldValue>> = {};
  for (const [identifier, entry] of Object.entries(data)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    values[identifier] = entry as Record<string, AddonFieldValue>;
  }
  return values;
}

/**
 * Runs every registered add-on's `beforeLeaveInbox`/`validate` hook for a
 * project that is about to exit the Inbox. Throws a 422 with the issues when an
 * add-on rejects the transition.
 */
export function assertInboxExitAllowed(db: BetterSqliteDatabase, projectId: string): void {
  const addons = listAddons();
  if (addons.length === 0) return;
  const values = addonValuesFor(db, projectId);
  const issues: AddonValidationIssue[] = [];
  for (const addon of addons) {
    const addonValues = values[addon.identifier] ?? {};
    const mode = addonModeFor(db, addon.identifier);
    if (addon.hooks?.beforeLeaveInbox) {
      issues.push(...addon.hooks.beforeLeaveInbox({ projectId, values: addonValues, mode }));
    }
    if (addon.hooks?.validate) {
      issues.push(...addon.hooks.validate({ projectId, values: addonValues, mode }));
    }
  }
  if (issues.length > 0) {
    const fields: Record<string, string> = {};
    for (const issue of issues) {
      if (issue.field) fields[issue.field] = issue.message;
    }
    throw new DomainError(
      422,
      'addon_validation',
      issues.map((issue) => issue.message).join(' '),
      Object.keys(fields).length > 0 ? fields : undefined,
    );
  }
}
