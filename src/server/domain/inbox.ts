import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { InboxItem, ProjectCard } from '@/lib/projects';
import { nowIso } from '@/server/db/util';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { assertInboxExitAllowed } from './addon-hooks';
import { recordAuditEvent } from './audit';
import { getProjectCard, getProjectRow, mapProjectCard } from './projects';
import { listWorkflow } from './workflow';
import {
  DomainError,
  canEditProject,
  canReadProject,
  isActiveProject,
  isTrashedProject,
  loadAccessContext,
  type AccessUser,
} from './permissions';

/**
 * Global Inbox (build-spec §6 rule 6, product.md §4).
 *
 * Inbox is a flag, not a status. Releasing clears the flag and keeps the
 * status; any status change also clears it (handled by the project update).
 */

export function listInbox(db: BetterSqliteDatabase, actor: AccessUser): InboxItem[] {
  const ctx = loadAccessContext(db, actor);
  const rows = db
    .prepare(
      `SELECT id FROM projects
        WHERE inbox = 1 AND trashed_at IS NULL
        ORDER BY created_at ASC, seq ASC`,
    )
    .all() as Array<{ id: string }>;

  const items: InboxItem[] = [];
  for (const row of rows) {
    if (!isActiveProject(ctx, row.id)) continue;
    const projectRow = getProjectRow(db, row.id);
    if (!projectRow) continue;
    const card = mapProjectCard(projectRow);
    const parentReadable =
      projectRow.parent_id !== null && canReadProject(ctx, projectRow.parent_id);
    const sanitized: ProjectCard = parentReadable
      ? card
      : { ...card, parent: null };
    const start = projectRow.parent_id
      ? (listWorkflow(db, projectRow.parent_id).find((status) => status.isStart) ?? null)
      : null;
    items.push({
      project: sanitized,
      parentTitle: parentReadable ? projectRow.parent_title : null,
      startStatusId: start?.id ?? null,
      startStatusName: start?.name ?? null,
      canRelease: canEditProject(ctx, row.id),
    });
  }
  return items;
}

export function releaseInboxProject(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  projectId: string,
): ProjectCard {
  const ctx = loadAccessContext(db, actor);
  const row = getProjectRow(db, projectId);
  if (!row || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'Restore this project before releasing it.');
  }
  if (!canEditProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to release this project.');
  }
  if (row.inbox !== 1) {
    // Releasing is idempotent: pulling an already released item is harmless.
    return mapProjectCard(row);
  }
  // Add-on gate before the Inbox exit (empty registry today; see addon-hooks).
  assertInboxExitAllowed(db, projectId);
  const timestamp = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE projects SET inbox = 0, updated_at = ? WHERE id = ?').run(timestamp, projectId);
    recordAuditEvent(db, {
      projectId,
      actorId: actor.id,
      action: AUDIT_ACTIONS.projectInboxReleased,
      field: 'inbox',
      oldValue: 'In Inbox',
      newValue: 'Released',
      createdAt: timestamp,
    });
  })();
  const updated = getProjectCard(db, projectId);
  if (!updated) throw new DomainError(500, 'internal', 'Could not release the project.');
  return updated;
}
