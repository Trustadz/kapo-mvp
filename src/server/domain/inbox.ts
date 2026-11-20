import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { InboxItem, ProjectCard } from '@/lib/projects';
import { indexProject } from '@/server/db/search';
import { nowIso } from '@/server/db/util';
import { AUDIT_ACTIONS, AUDIT_FIELDS } from '@/lib/audit';
import { assertInboxExitAllowed } from './addon-hooks';
import { recordAuditEvent } from './audit';
import {
  assertMoveKeepsAdmin,
  getProjectCard,
  getProjectRow,
  mapProjectCard,
} from './projects';
import { ensureWorkflow, listWorkflow } from './workflow';
import {
  DomainError,
  canAdminProject,
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
        ORDER BY priority ASC, created_at ASC, seq ASC`,
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
      // Reparenting follows moveProject and therefore requires project Admin.
      canChangeParent: canAdminProject(ctx, row.id),
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

/* ------------------------------------------------------------------------- */
/* Change parent (stay in the Inbox)                                         */
/* ------------------------------------------------------------------------- */

export interface ChangeInboxParentInput {
  destinationId?: unknown;
}

/**
 * Reparents an Inbox capture without releasing it (issue #15).
 *
 * This is deliberately separate from `moveProject`: it keeps `inbox = 1` and
 * maps the capture to the destination workflow's Start status implicitly. The
 * existing Move dialog keeps its explicit status mapping and Inbox exit
 * behaviour. Validation mirrors `moveProject` (trashed checks, project Admin
 * on the capture, edit access to the destination, self/cycle rejection and the
 * post-move last-Admin simulation).
 */
export function changeInboxParent(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  projectId: string,
  input: ChangeInboxParentInput,
): ProjectCard {
  const ctx = loadAccessContext(db, actor);
  const row = getProjectRow(db, projectId);
  if (!row || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'Restore this project before changing its parent.');
  }
  // AR-045: same rule as Move, an application Admin does not bypass another
  // project's access controls, so the capture must be administered by the actor.
  if (!canAdminProject(ctx, projectId)) {
    throw new DomainError(
      403,
      'forbidden',
      "You must be a project Admin to change this project's parent.",
    );
  }
  if (row.inbox !== 1) {
    throw new DomainError(
      422,
      'validation_failed',
      'Only projects in the Inbox can change parent this way.',
    );
  }
  if (row.parent_id === null) {
    throw new DomainError(422, 'validation_failed', 'Root cannot change parent.');
  }

  const destinationId = typeof input.destinationId === 'string' ? input.destinationId : '';
  if (!destinationId) {
    throw new DomainError(422, 'validation_failed', 'Choose a parent project.', {
      destinationId: 'Choose a parent project.',
    });
  }
  const destination = getProjectRow(db, destinationId);
  if (!destination || !canReadProject(ctx, destinationId)) {
    throw new DomainError(404, 'not_found', 'Destination project not found.');
  }
  if (isTrashedProject(ctx, destinationId)) {
    throw new DomainError(409, 'trashed_read_only', 'The destination project is in Trash.');
  }
  if (!canEditProject(ctx, destinationId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to the destination project.');
  }
  if (destinationId === projectId) {
    throw new DomainError(422, 'validation_failed', 'A project cannot be moved inside itself.', {
      destinationId: 'Choose a different parent.',
    });
  }

  // Cycle rejection: the destination must not be the capture or a descendant.
  let cursor: string | null = destinationId;
  let guard = 0;
  while (cursor && guard < 500) {
    if (cursor === projectId) {
      throw new DomainError(
        422,
        'validation_failed',
        'A project cannot be moved inside its own subtree.',
        { destinationId: 'Choose a parent outside this project.' },
      );
    }
    const current: { parent_id: string | null } | undefined = db
      .prepare('SELECT parent_id FROM projects WHERE id = ?')
      .get(cursor) as { parent_id: string | null } | undefined;
    cursor = current?.parent_id ?? null;
    guard += 1;
  }

  if (destinationId === row.parent_id) {
    throw new DomainError(422, 'validation_failed', 'This project is already under that parent.', {
      destinationId: 'Choose a different parent.',
    });
  }

  // Every project owns a workflow. The destination's Start status is the
  // capture's new status; read-only, so a GET/command never seeds a workflow.
  const destinationWorkflow = ensureWorkflow(db, destinationId);
  const start =
    destinationWorkflow.find((status) => status.isStart) ?? destinationWorkflow[0] ?? null;
  if (!start) {
    throw new DomainError(
      422,
      'validation_failed',
      'The destination project has no workflow status.',
      { destinationId: 'Choose a parent with a workflow.' },
    );
  }

  // The capture and its descendants must still have an effective Admin (AR-035).
  assertMoveKeepsAdmin(db, projectId, destinationId);

  const oldStatusId = row.status_id;
  const oldStatusName =
    row.status_name ??
    (oldStatusId
      ? (
          db.prepare('SELECT name FROM statuses WHERE id = ?').get(oldStatusId) as
            | { name: string }
            | undefined
        )?.name ?? null
      : null);
  const oldParentTitle = row.parent_title ?? 'previous parent';
  const timestamp = nowIso();

  db.transaction(() => {
    // Issue #53: changing parent keeps the capture's global priority position.
    db.prepare(
      'UPDATE projects SET parent_id = ?, status_id = ?, inbox = 1, updated_at = ? WHERE id = ?',
    ).run(destinationId, start.id, timestamp, projectId);

    recordAuditEvent(db, {
      projectId,
      actorId: actor.id,
      action: AUDIT_ACTIONS.projectMoved,
      field: AUDIT_FIELDS.parent,
      oldValue: oldParentTitle,
      newValue: destination.title,
      createdAt: timestamp,
    });
    if (oldStatusId !== start.id) {
      recordAuditEvent(db, {
        projectId,
        actorId: actor.id,
        action: AUDIT_ACTIONS.projectStatusChanged,
        field: AUDIT_FIELDS.status,
        oldValue: oldStatusName,
        newValue: start.name,
        // Status ids are snapshotted for forward-compatible reporting (AR-033).
        detail: JSON.stringify({ fromId: oldStatusId, toId: start.id }),
        createdAt: timestamp,
      });
    }
    indexProject(db, { projectId, title: row.title, body: '' });
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, destinationId);
  })();

  const updated = getProjectRow(db, projectId);
  if (!updated) throw new DomainError(500, 'internal', 'Could not change the project parent.');
  return mapProjectCard(updated);
}
