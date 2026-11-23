import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { AUDIT_ACTIONS, AUDIT_FIELDS } from '@/lib/audit';
import type { Status } from '@/lib/types';
import { DEFAULT_CHILD_WORKFLOW, insertWorkflow, type WorkflowStatusRow } from '@/server/db/bootstrap';
import { parseJsonObject } from '@/server/db/util';
import { assertInboxExitAllowed } from './addon-hooks';
import { recordAuditEvent } from './audit';
import { reindexProjectAddonSearch } from './project-addons';
import { newId, nowIso } from '@/server/db/util';
import {
  DomainError,
  canAdminProject,
  loadAccessContext,
  type AccessUser,
} from './permissions';

/**
 * Child workflow ownership (product.md §3, build-spec §6 rule 5).
 *
 * Every project owns the workflow its children use. Exactly one Start and one
 * Finish must exist. Removing or replacing a status that live children use
 * requires an explicit remap; statuses used only by trashed projects are
 * retired in place and mapped when the project is restored.
 */

export const WORKFLOW_STATUS_MAX_LENGTH = 60;
export const WORKFLOW_MAX_STATUSES = 40;

export interface WorkflowStatusInput {
  id?: string | null;
  name: string;
  isStart?: boolean;
  isFinish?: boolean;
}

export interface WorkflowUsage {
  live: number;
  trashed: number;
}

export interface RetiredStatus {
  id: string;
  name: string;
  position: number;
}

interface StatusRow {
  id: string;
  parent_id: string;
  name: string;
  position: number;
  is_start: number;
  is_finish: number;
}

const RETIRED_KEY = 'retired_statuses';

function mapStatusRow(row: StatusRow): Status {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    position: row.position,
    isStart: row.is_start === 1,
    isFinish: row.is_finish === 1,
  };
}

function readSettingsJson(db: BetterSqliteDatabase, projectId: string): Record<string, unknown> {
  const row = db.prepare('SELECT settings FROM projects WHERE id = ?').get(projectId) as
    | { settings: string }
    | undefined;
  if (!row) return {};
  return parseJsonObject(row.settings);
}

export function loadRetiredStatuses(
  db: BetterSqliteDatabase,
  parentId: string,
): RetiredStatus[] {
  const raw = readSettingsJson(db, parentId)[RETIRED_KEY];
  if (!Array.isArray(raw)) return [];
  const retired: RetiredStatus[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { id?: unknown; name?: unknown; position?: unknown };
    if (typeof candidate.id !== 'string') continue;
    retired.push({
      id: candidate.id,
      name: typeof candidate.name === 'string' ? candidate.name : 'Removed status',
      position: typeof candidate.position === 'number' ? candidate.position : 0,
    });
  }
  return retired;
}

function writeRetiredStatuses(
  db: BetterSqliteDatabase,
  parentId: string,
  retired: readonly RetiredStatus[],
): void {
  const settings = readSettingsJson(db, parentId);
  if (retired.length === 0) delete settings[RETIRED_KEY];
  else settings[RETIRED_KEY] = retired;
  db.prepare('UPDATE projects SET settings = ? WHERE id = ?').run(
    JSON.stringify(settings),
    parentId,
  );
}

function retiredLabel(name: string, id: string): string {
  const suffix = id.slice(0, 8);
  const label = `${name} (removed ${suffix})`;
  return label.length > WORKFLOW_STATUS_MAX_LENGTH + 32
    ? `${label.slice(0, WORKFLOW_STATUS_MAX_LENGTH + 31)}`
    : label;
}

/** All statuses, including retired rows kept only for trashed projects. */
function loadAllStatusRows(db: BetterSqliteDatabase, parentId: string): StatusRow[] {
  return db
    .prepare(
      `SELECT id, parent_id, name, position, is_start, is_finish
         FROM statuses WHERE parent_id = ? ORDER BY position ASC, rowid ASC`,
    )
    .all(parentId) as StatusRow[];
}

/** Active statuses in workflow order (retired rows are excluded). */
export function listWorkflow(db: BetterSqliteDatabase, parentId: string): Status[] {
  const retired = new Set(loadRetiredStatuses(db, parentId).map((entry) => entry.id));
  return loadAllStatusRows(db, parentId)
    .filter((row) => !retired.has(row.id))
    .map(mapStatusRow)
    .sort((a, b) => a.position - b.position);
}

/**
 * Returns the project's child workflow, seeding the To do / Done default when
 * the project has no statuses yet (projects created before they had children).
 */
export function ensureWorkflow(db: BetterSqliteDatabase, parentId: string): Status[] {
  const rows = loadAllStatusRows(db, parentId);
  if (rows.length === 0) {
    insertWorkflow(db, parentId, DEFAULT_CHILD_WORKFLOW);
    return listWorkflow(db, parentId);
  }
  return listWorkflow(db, parentId);
}

export function startStatus(db: BetterSqliteDatabase, parentId: string): Status | null {
  const statuses = listWorkflow(db, parentId);
  return statuses.find((status) => status.isStart) ?? statuses[0] ?? null;
}

export function finishStatus(db: BetterSqliteDatabase, parentId: string): Status | null {
  const statuses = listWorkflow(db, parentId);
  return statuses.find((status) => status.isFinish) ?? null;
}

export function statusUsage(db: BetterSqliteDatabase, parentId: string): Record<string, WorkflowUsage> {
  const rows = db
    .prepare(
      `SELECT status_id,
              SUM(CASE WHEN trashed_at IS NULL THEN 1 ELSE 0 END) AS live,
              SUM(CASE WHEN trashed_at IS NOT NULL THEN 1 ELSE 0 END) AS trashed
         FROM projects
        WHERE parent_id = ?
        GROUP BY status_id`,
    )
    .all(parentId) as Array<{ status_id: string | null; live: number | null; trashed: number | null }>;
  const usage: Record<string, WorkflowUsage> = {};
  for (const row of rows) {
    if (!row.status_id) continue;
    usage[row.status_id] = { live: row.live ?? 0, trashed: row.trashed ?? 0 };
  }
  return usage;
}

export interface WorkflowData {
  statuses: Status[];
  usage: Record<string, WorkflowUsage>;
  retired: RetiredStatus[];
}

export function getWorkflowData(db: BetterSqliteDatabase, parentId: string): WorkflowData {
  // Read-only (AR-032/AR-052): default workflows are seeded when a project is
  // created or when its first child is added, never from a GET/page path.
  const statuses = listWorkflow(db, parentId);
  return {
    statuses,
    usage: statusUsage(db, parentId),
    retired: loadRetiredStatuses(db, parentId),
  };
}

export interface WorkflowValidationResult {
  statuses: Array<WorkflowStatusInput & { id: string | null; name: string; isStart: boolean; isFinish: boolean }>;
}

function validateWorkflowInput(input: unknown): WorkflowValidationResult {
  if (!Array.isArray(input) || input.length === 0) {
    throw new DomainError(422, 'validation_failed', 'A workflow needs at least one status.');
  }
  if (input.length > WORKFLOW_MAX_STATUSES) {
    throw new DomainError(422, 'validation_failed', `A workflow can have at most ${WORKFLOW_MAX_STATUSES} statuses.`);
  }
  const statuses: WorkflowValidationResult['statuses'] = [];
  const names = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) {
      throw new DomainError(422, 'validation_failed', 'Each status must be an object.');
    }
    const candidate = entry as { id?: unknown; name?: unknown; isStart?: unknown; isFinish?: unknown };
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    if (!name) {
      throw new DomainError(422, 'validation_failed', 'Every status needs a name.', {
        name: 'Enter a status name.',
      });
    }
    if (name.length > WORKFLOW_STATUS_MAX_LENGTH) {
      throw new DomainError(422, 'validation_failed', `Status names are limited to ${WORKFLOW_STATUS_MAX_LENGTH} characters.`, {
        name: `Use at most ${WORKFLOW_STATUS_MAX_LENGTH} characters.`,
      });
    }
    const normalized = name.toLowerCase();
    if (names.has(normalized)) {
      throw new DomainError(422, 'validation_failed', 'Status names must be unique.', {
        name: 'Status names must be unique.',
      });
    }
    names.add(normalized);
    const id = typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : null;
    statuses.push({
      id,
      name,
      isStart: candidate.isStart === true,
      isFinish: candidate.isFinish === true,
    });
  }
  const starts = statuses.filter((status) => status.isStart).length;
  const finishes = statuses.filter((status) => status.isFinish).length;
  if (starts !== 1) {
    throw new DomainError(422, 'validation_failed', 'Choose exactly one Start status.');
  }
  if (finishes !== 1) {
    throw new DomainError(422, 'validation_failed', 'Choose exactly one Finish status.');
  }
  return { statuses };
}

function parseMapping(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DomainError(422, 'validation_failed', 'Status mapping must be an object.');
  }
  const mapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 0) mapping[key] = value;
  }
  return mapping;
}

export interface ReplaceWorkflowResult {
  workflow: WorkflowData;
  remappedChildren: number;
  retiredStatuses: number;
}

/**
 * Replaces a project's child workflow. Live children of removed statuses are
 * remapped (required); trashed children of removed statuses defer the mapping
 * until restore and keep a retired status row.
 */
export function replaceWorkflow(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  parentId: string,
  rawStatuses: unknown,
  rawMapping: unknown,
): ReplaceWorkflowResult {
  const parent = db
    .prepare('SELECT id, title, parent_id, trashed_at FROM projects WHERE id = ?')
    .get(parentId) as { id: string; title: string; parent_id: string | null; trashed_at: string | null } | undefined;
  if (!parent) throw new DomainError(404, 'not_found', 'Project not found.');
  if (parent.trashed_at !== null) {
    throw new DomainError(409, 'trashed_read_only', 'Restore this project before editing its workflow.');
  }
  const ctx = loadAccessContext(db, actor);
  if (!canAdminProject(ctx, parentId)) {
    throw new DomainError(403, 'forbidden', 'You must be a project Admin to edit the workflow.');
  }

  const validation = validateWorkflowInput(rawStatuses);
  const mapping = parseMapping(rawMapping);
  const existing = loadAllStatusRows(db, parentId);
  const activeExisting = listWorkflow(db, parentId);
  const activeIds = new Set(activeExisting.map((status) => status.id));
  const allIds = new Set(existing.map((row) => row.id));
  const finalIds = new Set<string>();

  for (const status of validation.statuses) {
    if (status.id) {
      if (!allIds.has(status.id)) {
        throw new DomainError(422, 'validation_failed', 'One of the statuses no longer exists.');
      }
      if (!activeIds.has(status.id)) {
        throw new DomainError(
          422,
          'validation_failed',
          'A removed status cannot be reused. Add it as a new status instead.',
        );
      }
      if (finalIds.has(status.id)) {
        throw new DomainError(422, 'validation_failed', 'The same status appears twice.');
      }
      finalIds.add(status.id);
    }
  }

  const removed = activeExisting.filter((status) => !finalIds.has(status.id));

  // Live children of a removed status must be remapped to a kept status.
  const childrenOf = db.prepare(
    `SELECT id, title, trashed_at, status_id, inbox FROM projects WHERE parent_id = ?`,
  );
  const children = childrenOf.all(parentId) as Array<{
    id: string;
    title: string;
    trashed_at: string | null;
    status_id: string | null;
    inbox: number;
  }>;
  const removedIds = new Set(removed.map((status) => status.id));
  const liveOrTrashed = children.filter(
    (child) => child.status_id !== null && removedIds.has(child.status_id),
  );
  const liveAffected = liveOrTrashed.filter((child) => child.trashed_at === null);
  const trashedAffected = liveOrTrashed.filter((child) => child.trashed_at !== null);

  const missing: string[] = [];
  for (const status of removed) {
    const usesLive = liveAffected.some((child) => child.status_id === status.id);
    if (!usesLive) continue;
    const target = mapping[status.id];
    if (!target || !finalIds.has(target)) missing.push(status.name);
  }
  if (missing.length > 0) {
    throw new DomainError(
      422,
      'mapping_required',
      `Choose where existing children of these statuses should go: ${missing.join(', ')}.`,
      { mapping: 'Choose a destination status for each removed status.' },
    );
  }

  const transaction = db.transaction((): ReplaceWorkflowResult => {
    // Two-phase position rewrite: UNIQUE(parent_id, position) is immediate.
    db.prepare('UPDATE statuses SET position = position + 100000 WHERE parent_id = ?').run(parentId);
    db.prepare('UPDATE statuses SET is_start = 0, is_finish = 0 WHERE parent_id = ?').run(parentId);

    // Two-phase names (PO P1): retire removed rows *before* keeping or inserting
    // final rows, otherwise replacing an in-use status with a new status of the
    // same name violates UNIQUE(parent_id, name) mid-transaction even though the
    // old row is removed by the end of it.
    const retireName = db.prepare('UPDATE statuses SET name = ? WHERE id = ?');
    for (const status of removed) {
      retireName.run(retiredLabel(status.name, status.id), status.id);
    }

    const update = db.prepare(
      'UPDATE statuses SET name = ?, position = ?, is_start = ?, is_finish = ? WHERE id = ?',
    );
    const insert = db.prepare(
      `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    validation.statuses.forEach((status, position) => {
      if (status.id) {
        update.run(
          status.name,
          position,
          status.isStart ? 1 : 0,
          status.isFinish ? 1 : 0,
          status.id,
        );
      } else {
        insert.run(
          newId(),
          parentId,
          status.name,
          position,
          status.isStart ? 1 : 0,
          status.isFinish ? 1 : 0,
        );
      }
    });

    let remappedChildren = 0;
    const statusNameById = new Map(activeExisting.map((status) => [status.id, status.name]));
    const finalNameById = new Map(validation.statuses.filter((status) => status.id).map((status) => [status.id as string, status.name]));
    for (const status of removed) {
      const target = mapping[status.id];
      if (!target) continue;
      const affectedLive = liveAffected.filter((child) => child.status_id === status.id);
      if (affectedLive.length === 0) continue;
      const updateChild = db.prepare(
        'UPDATE projects SET status_id = ?, inbox = 0, updated_at = ? WHERE id = ?',
      );
      const reindex = db.prepare('SELECT id, title FROM projects WHERE id = ?');
      const targetName = finalNameById.get(target) ?? statusNameById.get(target) ?? 'New status';
      const timestamp = nowIso();
      for (const child of affectedLive) {
        // A workflow remap is still a status change, so it exits the Inbox and
        // runs the same add-on gate as any other status change (AR-036).
        if (child.inbox === 1) assertInboxExitAllowed(db, child.id);
        updateChild.run(target, timestamp, child.id);
        recordChildStatusAudit(
          db,
          actor,
          child.id,
          status.name,
          targetName,
          JSON.stringify({ fromId: status.id, toId: target }),
          timestamp,
        );
        const row = reindex.get(child.id) as { id: string; title: string } | undefined;
        if (row) reindexProjectAddonSearch(db, row.id);
        remappedChildren += 1;
      }
    }

    // Retire removed statuses that trashed projects still reference; delete
    // those that nothing references.
    const previousRetired = loadRetiredStatuses(db, parentId);
    const nextRetired = new Map(previousRetired.map((entry) => [entry.id, entry]));
    let retiredCount = 0;
    for (const status of removed) {
      const usedByTrashed = trashedAffected.some((child) => child.status_id === status.id);
      const references = db
        .prepare('SELECT COUNT(*) AS count FROM projects WHERE status_id = ?')
        .get(status.id) as { count: number };
      if (usedByTrashed || references.count > 0) {
        const retiredEntry: RetiredStatus = {
          id: status.id,
          name: status.name,
          position: 100000 + nextRetired.size,
        };
        nextRetired.set(status.id, retiredEntry);
        db.prepare(
          'UPDATE statuses SET name = ?, position = ?, is_start = 0, is_finish = 0 WHERE id = ?',
        ).run(retiredLabel(status.name, status.id), 100000 + nextRetired.size, status.id);
        retiredCount += 1;
      } else {
        db.prepare('DELETE FROM statuses WHERE id = ?').run(status.id);
      }
    }

    // Drop retired rows once nothing references them any more (e.g. after a
    // restore mapped the project to a live status).
    for (const entry of [...nextRetired.values()]) {
      const references = db
        .prepare('SELECT COUNT(*) AS count FROM projects WHERE status_id = ?')
        .get(entry.id) as { count: number };
      if (references.count === 0) {
        db.prepare('DELETE FROM statuses WHERE id = ?').run(entry.id);
        nextRetired.delete(entry.id);
      }
    }
    writeRetiredStatuses(db, parentId, [...nextRetired.values()]);

    const timestamp = nowIso();
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, parentId);
    const previousNames = new Set(activeExisting.map((status) => status.name));
    const added = validation.statuses.filter((status) => !previousNames.has(status.name)).map((status) => status.name);
    const detail =
      added.length > 0
        ? `Added status${added.length === 1 ? '' : 'es'}: ${added.join(', ')}`
        : 'Updated child workflow';
    recordAuditEvent(db, {
      projectId: parentId,
      actor,
      action: AUDIT_ACTIONS.workflowUpdated,
      detail,
      createdAt: timestamp,
    });

    return {
      workflow: getWorkflowData(db, parentId),
      remappedChildren,
      retiredStatuses: retiredCount,
    };
  });

  return transaction();
}

function recordChildStatusAudit(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  projectId: string,
  oldValue: string,
  newValue: string,
  detail: string,
  timestamp: string,
): void {
  recordAuditEvent(db, {
    projectId,
    actor,
    action: AUDIT_ACTIONS.projectStatusChanged,
    field: AUDIT_FIELDS.status,
    oldValue,
    newValue,
    detail,
    createdAt: timestamp,
  });
}

/** Maps a status id to its human name for audit/display purposes. */
export function statusName(
  db: BetterSqliteDatabase,
  statusId: string | null,
): string | null {
  if (!statusId) return null;
  const row = db.prepare('SELECT name FROM statuses WHERE id = ?').get(statusId) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

export type { WorkflowStatusRow };

/**
 * Removes retired status rows that no project references any more (for example
 * after the last trashed project using one was restored to a live status).
 */
export function pruneRetiredStatuses(db: BetterSqliteDatabase, parentId: string): number {
  const retired = loadRetiredStatuses(db, parentId);
  if (retired.length === 0) return 0;
  const remaining: RetiredStatus[] = [];
  let removed = 0;
  const references = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE status_id = ?');
  for (const entry of retired) {
    const count = references.get(entry.id) as { count: number };
    if (count.count > 0) {
      remaining.push(entry);
      continue;
    }
    db.prepare('DELETE FROM statuses WHERE id = ?').run(entry.id);
    removed += 1;
  }
  if (remaining.length !== retired.length) writeRetiredStatuses(db, parentId, remaining);
  return removed;
}
