import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { Status } from '@/lib/types';
import { getApplicationSettings } from './settings';
import { removeProjectFromSearch } from '@/server/db/search';
import { addDaysIso, newId, nowIso } from '@/server/db/util';
import type {
  ProjectCard,
  RestoreCandidate,
  RestoreInfo,
  TrashActor,
  TrashGroup,
  TrashItem,
} from '@/lib/projects';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getProjectCard, getProjectRow } from './projects';
import { reindexProjectAddonSearch } from './project-addons';
import { recordAuditEvent } from './audit';
import {
  DomainError,
  canAdminProject,
  canReadProject,
  isRootProject,
  isTrashVisibleProject,
  loadAccessContext,
  type AccessUser,
} from './permissions';
import { listWorkflow, pruneRetiredStatuses } from './workflow';

/**
 * Trash lifecycle (build-spec §6 rule 9, product.md §4).
 *
 * One trash action groups everything trashed in one operation; each newly
 * trashed project gets its own purge deadline from the Admin retention setting
 * (default 30 days). Projects already in Trash keep their original deadline and
 * action. Restore only undoes the same action
 * for the subtree, and requires explicit mapping when a saved status has been
 * retired from the parent workflow.
 */

interface TrashProjectRow {
  id: string;
  title: string;
  parent_id: string | null;
  trashed_at: string | null;
  trash_action_id: string | null;
  purge_deadline: string | null;
  seq: number;
  archived: number;
  status_id: string | null;
}

function loadTrashRow(
  db: BetterSqliteDatabase,
  projectId: string,
): TrashProjectRow | null {
  const row = db
    .prepare(
      `SELECT id, title, parent_id, trashed_at, trash_action_id, purge_deadline, seq, archived,
              status_id
         FROM projects WHERE id = ?`,
    )
    .get(projectId) as TrashProjectRow | undefined;
  return row ?? null;
}

function descendantRows(db: BetterSqliteDatabase, projectId: string): TrashProjectRow[] {
  return db
    .prepare(
      `WITH RECURSIVE subtree(id, depth) AS (
         SELECT id, 1 FROM projects WHERE parent_id = ?
         UNION ALL
         SELECT p.id, s.depth + 1 FROM projects p JOIN subtree s ON p.parent_id = s.id
       )
       SELECT p.id, p.title, p.parent_id, p.trashed_at, p.trash_action_id, p.purge_deadline,
              p.seq, p.archived, p.status_id
         FROM projects p JOIN subtree s ON s.id = p.id
        ORDER BY s.depth ASC, p.priority ASC`,
    )
    .all(projectId) as TrashProjectRow[];
}

export interface TrashProjectsResult {
  actionId: string;
  trashed: string[];
}

/**
 * Trashes one or more projects (each with their live descendants) under a
 * single action. Already-trashed descendants are left untouched so they keep
 * their original deadline and action.
 */
export function trashProjects(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  projectIds: readonly string[],
  requestedActionId?: string | null,
): TrashProjectsResult {
  if (projectIds.length === 0) {
    throw new DomainError(422, 'validation_failed', 'Choose at least one project to trash.');
  }
  const ctx = loadAccessContext(db, actor);
  const timestamp = nowIso();
  const retentionDays = getApplicationSettings(db).trashRetentionDays;
  const deadline = addDaysIso(timestamp, retentionDays);

  const roots: string[] = [];
  for (const projectId of new Set(projectIds)) {
    const row = loadTrashRow(db, projectId);
    if (!row || !canReadProject(ctx, projectId)) {
      throw new DomainError(404, 'not_found', 'Project not found.');
    }
    // AR-045 decision: trashing requires project Admin. An application Admin
    // does not bypass another project's access controls.
    if (!canAdminProject(ctx, projectId)) {
      throw new DomainError(403, 'forbidden', 'You must be a project Admin to trash this project.');
    }
    if (isRootProject(ctx, projectId)) {
      throw new DomainError(422, 'validation_failed', 'Root cannot be trashed.');
    }
    if (row.trashed_at !== null) {
      throw new DomainError(409, 'already_trashed', 'That project is already in Trash.');
    }
    roots.push(projectId);
  }

  // Collect every live project entering Trash exactly once.
  const toTrash = new Map<string, TrashProjectRow>();
  for (const rootId of roots) {
    const root = loadTrashRow(db, rootId);
    if (root && root.trashed_at === null) toTrash.set(root.id, root);
    for (const descendant of descendantRows(db, rootId)) {
      if (descendant.trashed_at !== null) continue;
      if (ctx.projectById.get(descendant.id)?.trashed) continue;
      toTrash.set(descendant.id, descendant);
    }
  }
  if (toTrash.size === 0) {
    throw new DomainError(409, 'already_trashed', 'Those projects are already in Trash.');
  }

  // AR-038: a supplied action id is only honoured when it belongs to the same
  // actor and a very recent batch; otherwise a fresh server-side id groups this
  // operation so unrelated trashes can never share a restore scope.
  let actionId = newId();
  if (requestedActionId && requestedActionId.length > 0) {
    const existing = db
      .prepare('SELECT actor_id, created_at FROM trash_actions WHERE id = ?')
      .get(requestedActionId) as { actor_id: string | null; created_at: string } | undefined;
    const recent =
      existing?.created_at !== undefined &&
      Date.now() - new Date(existing.created_at).getTime() < 10 * 60 * 1000;
    if (existing && existing.actor_id === actor.id && recent) actionId = requestedActionId;
  }
  const transaction = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO trash_actions (id, actor_id, created_at) VALUES (?, ?, ?)').run(
      actionId,
      actor.id,
      timestamp,
    );
    const update = db.prepare(
      `UPDATE projects
          SET trashed_at = ?, trash_action_id = ?, purge_deadline = ?, updated_at = ?
        WHERE id = ?`,
    );
    const parentTitle = db.prepare('SELECT title FROM projects WHERE id = ?');
    for (const [projectId, row] of toTrash) {
      update.run(timestamp, actionId, deadline, timestamp, projectId);
      removeProjectFromSearch(db, projectId);
      // The project logs its own trashing; its parent logs the child removal.
      recordAuditEvent(db, {
        projectId,
        actor: actor,
        action: AUDIT_ACTIONS.projectTrashed,
        detail: `Moved to Trash. Permanently removed after ${retentionDays} days.`,
        createdAt: timestamp,
      });
      if (row.parent_id) {
        const parent = parentTitle.get(row.parent_id) as { title: string } | undefined;
        if (parent) {
          recordAuditEvent(db, {
            projectId: row.parent_id,
            actor: actor,
            action: AUDIT_ACTIONS.childTrashed,
            targetId: projectId,
            newValue: row.title,
            detail: 'Child project moved to Trash',
            createdAt: timestamp,
          });
        }
      }
    }
  });
  transaction();

  return { actionId, trashed: [...toTrash.keys()] };
}

function restoreSetFor(
  db: BetterSqliteDatabase,
  target: TrashProjectRow,
): TrashProjectRow[] {
  const sameAction = descendantRows(db, target.id).filter(
    (row) => row.trashed_at !== null && row.trash_action_id === target.trash_action_id,
  );
  return [target, ...sameAction];
}

function activeStatusById(
  db: BetterSqliteDatabase,
  parentId: string,
): Map<string, Status> {
  const workflow = listWorkflow(db, parentId);
  return new Map(workflow.map((status) => [status.id, status]));
}

function statusNameById(db: BetterSqliteDatabase, statusId: string | null): string | null {
  if (!statusId) return null;
  const row = db.prepare('SELECT name FROM statuses WHERE id = ?').get(statusId) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

function parentTitleOf(
  db: BetterSqliteDatabase,
  parentId: string | null,
  ctx: ReturnType<typeof loadAccessContext>,
): string | null {
  if (!parentId) return null;
  if (!canReadProject(ctx, parentId)) return null;
  const row = db.prepare('SELECT title FROM projects WHERE id = ?').get(parentId) as
    | { title: string }
    | undefined;
  return row?.title ?? null;
}

export function getRestoreInfo(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  projectId: string,
): RestoreInfo {
  const ctx = loadAccessContext(db, actor);
  const target = loadTrashRow(db, projectId);
  if (!target || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (target.trashed_at === null) {
    throw new DomainError(409, 'not_trashed', 'That project is not in Trash.');
  }
  if (!canAdminProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You must be a project Admin to restore this project.');
  }

  const candidates: RestoreCandidate[] = restoreSetFor(db, target)
    .filter((row) => row.trashed_at !== null)
    .map((row) => {
      const workflow = row.parent_id ? activeStatusById(db, row.parent_id) : new Map<string, Status>();
      const statuses = [...workflow.values()].sort((a, b) => a.position - b.position);
      const current = row.parent_id ? workflow.get(row.status_id ?? '') ?? null : null;
      return {
        projectId: row.id,
        title: row.title,
        parentTitle: parentTitleOf(db, row.parent_id, ctx) ?? 'Parent unavailable',
        statusId: row.parent_id ? row.status_id : null,
        statusName: statusNameById(db, row.parent_id ? row.status_id : null),
        invalid: row.parent_id !== null && current === null,
        statuses,
      };
    });

  return {
    project: { id: target.id, title: target.title, actionId: target.trash_action_id },
    candidates,
    requiresMapping: candidates.some((candidate) => candidate.invalid),
  };
}

function parseRestoreMapping(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const mapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 0) mapping[key] = value;
  }
  return mapping;
}

export interface RestoreResult {
  project: ProjectCard;
  restored: string[];
}

/**
 * Restores a trashed project and the descendants that were trashed by the same
 * action. Descendants trashed separately keep their own action and deadline.
 * `mapping` is keyed by project id and is required when a saved status was
 * retired from its parent's workflow.
 */
export function restoreProject(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  projectId: string,
  rawMapping?: unknown,
): RestoreResult {
  const ctx = loadAccessContext(db, actor);
  const target = loadTrashRow(db, projectId);
  if (!target || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (target.trashed_at === null) {
    throw new DomainError(409, 'not_trashed', 'That project is not in Trash.');
  }
  // AR-045 decision: restoring requires project Admin (see trashProjects).
  if (!canAdminProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You must be a project Admin to restore this project.');
  }
  if (target.parent_id) {
    const parent = loadTrashRow(db, target.parent_id);
    if (parent && parent.trashed_at !== null) {
      throw new DomainError(
        409,
        'parent_trashed',
        'Restore the parent project first; a project cannot be restored into Trash.',
      );
    }
  }

  const candidates = restoreSetFor(db, target);

  // AR-046 invariant: every restored project must have a live ancestor chain.
  // A descendant trashed by a different action therefore blocks this restore
  // instead of being silently resurrected under a trashed parent.
  const restoring = new Set(candidates.map((candidate) => candidate.id));
  for (const candidate of candidates) {
    let ancestorId = candidate.parent_id;
    let guard = 0;
    while (ancestorId && guard < 500) {
      const ancestor = loadTrashRow(db, ancestorId);
      if (!ancestor) break;
      if (ancestor.trashed_at !== null && !restoring.has(ancestor.id)) {
        throw new DomainError(
          409,
          'parent_trashed',
          `Restore ${ancestor.title} first; a project cannot be restored under a trashed parent.`,
        );
      }
      ancestorId = ancestor.parent_id;
      guard += 1;
    }
  }

  const mapping = parseRestoreMapping(rawMapping);
  const missing: string[] = [];
  const statusTargets = new Map<string, Status>();

  for (const candidate of candidates) {
    if (!candidate.parent_id) continue;
    const workflow = activeStatusById(db, candidate.parent_id);
    const mappedId = mapping[candidate.id];
    const mapped = mappedId ? workflow.get(mappedId) : undefined;
    const current = workflow.get(candidate.status_id ?? '');
    if (mapped) {
      statusTargets.set(candidate.id, mapped);
      continue;
    }
    if (!current) missing.push(candidate.title);
  }
  if (missing.length > 0) {
    throw new DomainError(
      422,
      'mapping_required',
      `Choose a valid status before restoring: ${missing.join(', ')}.`,
      { mapping: 'Choose a valid destination status for each project.' },
    );
  }

  const timestamp = nowIso();
  const restored: string[] = [];
  const transaction = db.transaction(() => {
    const update = db.prepare(
      `UPDATE projects
          SET trashed_at = NULL, trash_action_id = NULL, purge_deadline = NULL,
              status_id = ?, updated_at = ?
        WHERE id = ?`,
    );
    const selectTitle = db.prepare('SELECT title FROM projects WHERE id = ?');
    for (const candidate of candidates) {
      const targetStatus = statusTargets.get(candidate.id);
      const statusId = targetStatus ? targetStatus.id : candidate.status_id;
      update.run(statusId, timestamp, candidate.id);
      const titleRow = selectTitle.get(candidate.id) as { title: string } | undefined;
      if (titleRow) reindexProjectAddonSearch(db, candidate.id);
      recordAuditEvent(db, {
        projectId: candidate.id,
        actor: actor,
        action: AUDIT_ACTIONS.projectRestored,
        detail: 'Restored from Trash',
        createdAt: timestamp,
      });
      restored.push(candidate.id);
    }

    // Retired statuses can become unreferenced once a restore remaps the last
    // trashed project using them.
    const parentIds = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.parent_id) parentIds.add(candidate.parent_id);
    }
    for (const parentId of parentIds) pruneRetiredStatuses(db, parentId);
  });
  transaction();

  const card = getProjectCard(db, projectId);
  if (!card) throw new DomainError(500, 'internal', 'Could not restore the project.');
  return { project: card, restored };
}

/** Trash listing for /search?tab=trash, permission filtered and action-aware. */
export function listTrash(db: BetterSqliteDatabase, actor: AccessUser): TrashItem[] {
  const ctx = loadAccessContext(db, actor);
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.parent_id, p.trashed_at, p.purge_deadline, p.seq,
              p.archived, p.status_id, p.trash_action_id,
              ta.created_at AS action_created_at,
              actor.id AS actor_id, actor.username AS actor_username, actor.avatar AS actor_avatar
         FROM projects p
         LEFT JOIN trash_actions ta ON ta.id = p.trash_action_id
         LEFT JOIN users actor ON actor.id = ta.actor_id
        WHERE p.trashed_at IS NOT NULL
        ORDER BY p.trashed_at DESC, p.seq DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    parent_id: string | null;
    trashed_at: string | null;
    purge_deadline: string | null;
    seq: number;
    archived: number;
    status_id: string | null;
    trash_action_id: string | null;
    action_created_at: string | null;
    actor_id: string | null;
    actor_username: string | null;
    actor_avatar: string | null;
  }>;

  const items: TrashItem[] = [];
  for (const row of rows) {
    if (!isTrashVisibleProject(ctx, row.id)) continue;
    const trashedBy: TrashActor | null =
      row.actor_id && row.actor_username
        ? { id: row.actor_id, username: row.actor_username, avatar: row.actor_avatar }
        : null;
    items.push({
      id: row.id,
      displayId: `KAP-${row.seq}`,
      title: row.title,
      parentId: row.parent_id,
      parentTitle: parentTitleOf(db, row.parent_id, ctx),
      trashedAt: row.trashed_at,
      purgeDeadline: row.purge_deadline,
      statusName: statusNameById(db, row.status_id),
      archived: row.archived === 1,
      canRestore: canAdminProject(ctx, row.id),
      actionId: row.trash_action_id,
      actionCreatedAt: row.action_created_at,
      trashedBy,
    });
  }
  return items;
}

/**
 * Groups Trash items by trash action for the designed action cards (F06).
 *
 * Within one action, a project whose parent is not part of the same action is a
 * "lead"; every same-action descendant under it is listed as "Also trashed by
 * this action". Independent projects trashed together (bulk) still get their own
 * lead card because restoring acts per-subtree, and a single-project action is
 * labelled "Trashed separately".
 */
export function groupTrashItems(items: readonly TrashItem[]): TrashGroup[] {
  const byAction = new Map<string, TrashItem[]>();
  for (const item of items) {
    const key = item.actionId ?? `__none__:${item.id}`;
    const list = byAction.get(key) ?? [];
    list.push(item);
    byAction.set(key, list);
  }

  const groups: TrashGroup[] = [];
  for (const [key, actionItems] of byAction) {
    const actionId = actionItems[0]?.actionId ?? null;
    const actionCreatedAt = actionItems[0]?.actionCreatedAt ?? actionItems[0]?.trashedAt ?? null;
    const actor = actionItems.find((item) => item.trashedBy)?.trashedBy ?? null;
    const ids = new Set(actionItems.map((item) => item.id));
    const byId = new Map(actionItems.map((item) => [item.id, item]));

    // Assign each item to the topmost same-action ancestor (or itself).
    const children = new Map<string, TrashItem[]>();
    const leads: TrashItem[] = [];
    for (const item of actionItems) {
      const parent = item.parentId && ids.has(item.parentId) ? byId.get(item.parentId) : undefined;
      if (parent) {
        const list = children.get(parent.id) ?? [];
        list.push(item);
        children.set(parent.id, list);
      } else {
        leads.push(item);
      }
    }
    const descendantsOf = (lead: TrashItem): TrashItem[] => {
      const result: TrashItem[] = [];
      const visit = (parentId: string) => {
        for (const child of children.get(parentId) ?? []) {
          result.push(child);
          visit(child.id);
        }
      };
      visit(lead.id);
      return result;
    };

    for (const lead of leads) {
      groups.push({
        actionId,
        actor: lead.trashedBy ?? actor,
        actionCreatedAt,
        separate: actionItems.length === 1,
        lead,
        alsoTrashed: descendantsOf(lead),
      });
    }
    void key;
  }

  groups.sort((a, b) => {
    const aTime = a.actionCreatedAt ?? a.lead.trashedAt ?? '';
    const bTime = b.actionCreatedAt ?? b.lead.trashedAt ?? '';
    return bTime.localeCompare(aTime);
  });
  return groups;
}

/** Used by the project page: the trashed project's own summary. */
export function trashMeta(
  db: BetterSqliteDatabase,
  projectId: string,
): { trashedAt: string | null; purgeDeadline: string | null } {
  const row = loadTrashRow(db, projectId);
  return { trashedAt: row?.trashed_at ?? null, purgeDeadline: row?.purge_deadline ?? null };
}

export { getProjectRow };
