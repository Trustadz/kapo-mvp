import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { listAddons } from '@/server/addons';
import type { AddonDefinition, AddonFieldValue, AddonValidationIssue } from '@/server/addons';
import { parseJsonObject } from '@/server/db/util';
import { getAddonMode } from './project-addons';
import { DomainError } from './permissions';

/**
 * Add-on lifecycle hooks (build-spec §12; docs/add-ons.md §4.1/§11).
 *
 * Every Inbox exit (release, status change, move, workflow remap) goes through
 * here so a Required add-on can block refinement with inline issues without
 * core code changes. Core invariants always win. Hooks are isolated per add-on:
 * a throwing hook is logged and converted into a validation failure instead of
 * taking the request down with a 500.
 */

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

function runHook(
  definition: AddonDefinition,
  hook: 'beforeLeaveInbox' | 'validate',
  context: {
    projectId: string;
    values: Record<string, AddonFieldValue>;
    mode: ReturnType<typeof getAddonMode>;
  },
): AddonValidationIssue[] {
  const fn = definition.hooks?.[hook];
  if (!fn) return [];
  try {
    return fn(context) ?? [];
  } catch (error) {
    console.error(`[kapo:addons] "${definition.identifier}" ${hook} hook failed`, error);
    return [{ message: `${definition.name} could not validate this project. Try again.` }];
  }
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
    const mode = getAddonMode(db, addon.identifier);
    const context = { projectId, values: addonValues, mode };
    issues.push(...runHook(addon, 'beforeLeaveInbox', context));
    issues.push(...runHook(addon, 'validate', context));
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
