import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { listAddons } from '@/server/addons';
import { getDb } from '../db/connection';

/**
 * Automatic trash purge (build-spec §6 rule 9, AR-020).
 *
 * Every project receives its own `purge_deadline` when it enters Trash, based on
 * the Admin retention setting (default 30 days).
 * This service removes every project whose deadline has passed, including its
 * complete descendant subtree (a trashed parent hides its subtree, so a
 * descendant may still have a later deadline than an expired ancestor).
 *
 * Guarantees:
 *  - one transaction: either the whole expired set disappears or nothing does;
 *  - FTS5 `project_search` rows are deleted for the entire subtree (the table
 *    has no foreign key to projects);
 *  - `audit_events`, favorites, project roles and statuses cascade with the
 *    project rows (append-only history is not rewritten by a purge);
 *  - no audit event is written for a purge (product.md §4);
 *  - idempotent: a second run finds nothing and returns zero counts;
 *  - Root can never be purged (it has no purge deadline, and it is skipped
 *    defensively should data ever be corrupt).
 *
 * Called by `src/instrumentation.ts` at startup and every six hours (when the
 * Admin purge setting is enabled), and by `npm run db:purge` through
 * `scripts/purge.ts` regardless of the automatic setting.
 */

export interface PurgeResult {
  /** Number of project rows removed (the whole affected subtree). */
  projects: number;
  /** Number of FTS search documents removed. */
  searchEntries: number;
  /** Number of audit events cascaded with their projects. */
  auditEvents: number;
}

interface PurgeCandidate {
  id: string;
  parent_id: string | null;
  purge_deadline: string | null;
}

const EMPTY_RESULT: PurgeResult = { projects: 0, searchEntries: 0, auditEvents: 0 };

export function purgeExpired(now: Date = new Date()): PurgeResult {
  const cutoff = now.toISOString();
  const db = getDb();
  return db.transaction(() => purgeExpiredInTransaction(db, cutoff))();
}

function purgeExpiredInTransaction(db: BetterSqliteDatabase, cutoff: string): PurgeResult {
  const candidates = db
    .prepare('SELECT id, parent_id, purge_deadline FROM projects')
    .all() as PurgeCandidate[];

  if (candidates.length === 0) return { ...EMPTY_RESULT };

  const byId = new Map<string, PurgeCandidate>();
  const childrenByParent = new Map<string, string[]>();
  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
    if (candidate.parent_id !== null) {
      const siblings = childrenByParent.get(candidate.parent_id);
      if (siblings) siblings.push(candidate.id);
      else childrenByParent.set(candidate.parent_id, [candidate.id]);
    }
  }

  // Expired roots (Root itself has no parent and can never be purged).
  const targets = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.parent_id === null) continue;
    if (candidate.purge_deadline === null) continue;
    if (candidate.purge_deadline <= cutoff) targets.add(candidate.id);
  }
  if (targets.size === 0) return { ...EMPTY_RESULT };

  // Expand to the complete subtree of every expired project.
  const pending = [...targets];
  while (pending.length > 0) {
    const parentId = pending.pop();
    if (parentId === undefined) break;
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (!targets.has(childId)) {
        targets.add(childId);
        pending.push(childId);
      }
    }
  }

  // Leaf-first deletion order avoids the immediate RESTRICT between
  // projects.status_id and statuses owned by a parent project.
  const depthCache = new Map<string, number>();
  const depthOf = (projectId: string): number => {
    const cached = depthCache.get(projectId);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    let depth = 0;
    let cursor = byId.get(projectId);
    while (cursor && cursor.parent_id !== null) {
      if (seen.has(cursor.id)) break; // defensive: corrupt cycle, stop walking
      seen.add(cursor.id);
      depth += 1;
      cursor = byId.get(cursor.parent_id);
    }
    depthCache.set(projectId, depth);
    return depth;
  };

  const ordered = [...targets].sort((a, b) => depthOf(b) - depthOf(a));

  // Add-on purge hooks run before the core cascade. Each hook is isolated: a
  // failure is logged and never blocks the purge (docs/add-ons.md §3.3/§11).
  for (const addon of listAddons()) {
    const hook = addon.hooks?.onProjectPurge;
    if (!hook) continue;
    try {
      hook({ projectIds: ordered, exec: (sql) => db.exec(sql) });
    } catch (error) {
      console.error(`[kapo:addons] "${addon.identifier}" onProjectPurge hook failed`, error);
    }
  }

  const countSearch = db.prepare(
    'SELECT COUNT(*) AS count FROM project_search WHERE project_id = ?',
  );
  const deleteSearch = db.prepare('DELETE FROM project_search WHERE project_id = ?');
  const countAudit = db.prepare(
    'SELECT COUNT(*) AS count FROM audit_events WHERE project_id = ?',
  );
  const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?');

  let searchEntries = 0;
  let auditEvents = 0;
  for (const projectId of ordered) {
    const searchRow = countSearch.get(projectId) as { count: number };
    searchEntries += searchRow.count;
    const auditRow = countAudit.get(projectId) as { count: number };
    auditEvents += auditRow.count;
    deleteSearch.run(projectId);
  }

  let projects = 0;
  for (const projectId of ordered) {
    projects += deleteProject.run(projectId).changes;
  }

  return { projects, searchEntries, auditEvents };
}
