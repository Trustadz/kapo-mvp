import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  getRestoreInfo,
  listTrash,
  restoreProject,
  trashProjects,
} from '@/server/domain/trash';
import { DomainError } from '@/server/domain/permissions';
import { replaceWorkflow } from '@/server/domain/workflow';
import { purgeExpired } from '@/server/domain/purge';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  createProject,
  createRoot,
  createUser,
  createWorkflow,
  grantRole,
  type FixtureUser,
  type WorkflowStatusRow,
} from '../helpers/fixtures';

/**
 * Trash lifecycle (build-spec §6 rule 9, product.md §4):
 * action grouping, per-project deadlines, deferred restore mapping,
 * read-only behaviour and audit/search side effects.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;
let user: FixtureUser;
let viewer: FixtureUser;
let rootId: string;
let homeId: string;
let homeStatuses: WorkflowStatusRow[];

function actor(who: FixtureUser, showArchived = false) {
  return { id: who.id, appRole: who.appRole, showArchived };
}

function row(projectId: string) {
  return db
    .prepare(
      `SELECT id, title, parent_id, status_id, trashed_at, trash_action_id, purge_deadline
         FROM projects WHERE id = ?`,
    )
    .get(projectId) as {
    id: string;
    title: string;
    parent_id: string | null;
    status_id: string | null;
    trashed_at: string | null;
    trash_action_id: string | null;
    purge_deadline: string | null;
  };
}

function auditActions(projectId: string): string[] {
  return (
    db
      .prepare('SELECT action FROM audit_events WHERE project_id = ? ORDER BY rowid ASC')
      .all(projectId) as Array<{ action: string }>
  ).map((entry) => entry.action);
}

function inSearch(projectId: string): boolean {
  return (
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM project_search WHERE project_id = ?')
        .get(projectId) as { count: number }
    ).count > 0
  );
}

function expectDomainError(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error('expected DomainError');
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'trash-domain' });
  db = test.db;
  admin = await createUser(db, { username: 'trash-admin', appRole: 'admin' });
  user = await createUser(db, { username: 'trash-user', appRole: 'user' });
  viewer = await createUser(db, { username: 'trash-viewer', appRole: 'viewer' });
  const root = createRoot(db, admin.id);
  rootId = root.id;
  grantRole(db, rootId, user.id, 'user');
  grantRole(db, rootId, viewer.id, 'viewer');
  const home = createProject(db, {
    title: 'Home improvement',
    parentId: rootId,
    reporterId: admin.id,
  });
  homeId = home.id;
  grantRole(db, homeId, admin.id, 'admin');
  grantRole(db, homeId, user.id, 'admin');
  grantRole(db, homeId, viewer.id, 'viewer');
  homeStatuses = createWorkflow(db, homeId);
});

afterAll(() => {
  test.cleanup();
});

describe('trashProjects', () => {
  it('groups a parent and its live descendants under one action with 30-day deadlines', () => {
    const parent = createProject(db, {
      title: 'Trash parent',
      parentId: homeId,
      reporterId: admin.id,
    });
    createWorkflow(db, parent.id, { names: ['One', 'Two'] });
    const child = createProject(db, {
      title: 'Trash child',
      parentId: parent.id,
      reporterId: admin.id,
    });
    const before = Date.now();
    const result = trashProjects(db, actor(admin), [parent.id]);
    expect(result.trashed).toEqual(expect.arrayContaining([parent.id, child.id]));

    for (const id of [parent.id, child.id]) {
      const project = row(id);
      expect(project.trashed_at).toBeTruthy();
      expect(project.trash_action_id).toBe(result.actionId);
      const deadline = new Date(project.purge_deadline!).getTime();
      expect(deadline - before).toBeGreaterThan(29.9 * 86_400_000);
      expect(deadline - before).toBeLessThan(30.1 * 86_400_000);
      expect(inSearch(id)).toBe(false);
      expect(auditActions(id)).toContain('project.trashed');
    }
    // The parent logs its child's logical deletion.
    expect(auditActions(parent.id)).toContain('project.child_trashed');
    // The trashed project's own parent logs it too.
    expect(auditActions(homeId)).toContain('project.child_trashed');
  });

  it('keeps the original action and deadline for a descendant already in Trash', () => {
    const parent = createProject(db, {
      title: 'Second trash parent',
      parentId: homeId,
      reporterId: admin.id,
    });
    createWorkflow(db, parent.id, { names: ['One', 'Two'] });
    const child = createProject(db, {
      title: 'Already trashed child',
      parentId: parent.id,
      reporterId: admin.id,
    });
    const first = trashProjects(db, actor(admin), [child.id]);
    const childBefore = row(child.id);

    const second = trashProjects(db, actor(admin), [parent.id]);
    const childAfter = row(child.id);
    expect(childAfter.trash_action_id).toBe(first.actionId);
    expect(childAfter.trash_action_id).not.toBe(second.actionId);
    expect(childAfter.purge_deadline).toBe(childBefore.purge_deadline);
    expect(row(parent.id).trash_action_id).toBe(second.actionId);
  });

  it('supports batch trashing with one shared action', () => {
    const first = createProject(db, {
      title: 'Batch one',
      parentId: homeId,
      reporterId: admin.id,
    });
    const second = createProject(db, {
      title: 'Batch two',
      parentId: homeId,
      reporterId: admin.id,
    });
    const result = trashProjects(db, actor(admin), [first.id, second.id]);
    expect(row(first.id).trash_action_id).toBe(result.actionId);
    expect(row(second.id).trash_action_id).toBe(result.actionId);
  });

  it('purges only past-deadline trash, cascading the subtree and writing no audit event', () => {
    const expiredParent = createProject(db, {
      title: 'Purge parent',
      parentId: homeId,
      reporterId: admin.id,
    });
    createWorkflow(db, expiredParent.id, { names: ['One', 'Two'] });
    const expiredChild = createProject(db, {
      title: 'Purge child',
      parentId: expiredParent.id,
      reporterId: admin.id,
    });
    const future = createProject(db, {
      title: 'Purge future',
      parentId: homeId,
      reporterId: admin.id,
    });
    trashProjects(db, actor(admin), [expiredParent.id]);
    trashProjects(db, actor(admin), [future.id]);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    db.prepare('UPDATE projects SET purge_deadline = ? WHERE id = ?').run(past, expiredParent.id);

    const auditBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }
    ).count;
    const result = purgeExpired(new Date());
    expect(result.projects).toBe(2);
    expect(result.searchEntries).toBeGreaterThanOrEqual(0);
    expect(result.auditEvents).toBeGreaterThanOrEqual(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM projects WHERE id IN (?, ?)').get(
      expiredParent.id,
      expiredChild.id,
    )).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM project_search WHERE project_id IN (?, ?)').get(
      expiredParent.id,
      expiredChild.id,
    )).toEqual({ count: 0 });
    // The still-in-date project and Root survive.
    expect(row(future.id).trashed_at).not.toBeNull();
    expect(row(rootId).trashed_at).toBeNull();
    // Purge itself is not audited (product.md §4).
    const auditAfter = (
      db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }
    ).count;
    expect(auditAfter).toBeLessThanOrEqual(auditBefore);
    // Idempotent.
    expect(purgeExpired(new Date())).toEqual({
      projects: 0,
      searchEntries: 0,
      auditEvents: 0,
    });
  });

  it('rejects Root, non-Admins, Viewers, missing projects and re-trashing', () => {
    expect(expectDomainError(() => trashProjects(db, actor(admin), [rootId])).status).toBe(422);

    const target = createProject(db, {
      title: 'Guarded trash',
      parentId: homeId,
      reporterId: admin.id,
    });
    // A project User (not Admin) cannot trash.
    const userOnly = createProject(db, {
      title: 'User-only trash',
      parentId: rootId,
      reporterId: admin.id,
    });
    grantRole(db, userOnly.id, user.id, 'user');
    expect(expectDomainError(() => trashProjects(db, actor(user), [userOnly.id])).status).toBe(403);
    expect(expectDomainError(() => trashProjects(db, actor(viewer), [target.id])).status).toBe(403);
    expect(expectDomainError(() => trashProjects(db, actor(admin), ['ghost'])).status).toBe(404);
    expect(expectDomainError(() => trashProjects(db, actor(admin), [])).status).toBe(422);
    trashProjects(db, actor(admin), [target.id]);
    expect(expectDomainError(() => trashProjects(db, actor(admin), [target.id])).status).toBe(409);
  });
});

describe('listTrash', () => {
  it('is permission filtered and marks restore rights', async () => {
    const outsider = await createUser(db, { username: 'trash-outsider' });
    expect(listTrash(db, actor(outsider))).toEqual([]);

    const adminItems = listTrash(db, actor(admin));
    expect(adminItems.length).toBeGreaterThan(0);
    expect(adminItems[0]).toMatchObject({
      displayId: expect.stringMatching(/^KAP-\d+$/),
      canRestore: expect.any(Boolean),
    });
    expect(adminItems.every((item) => item.purgeDeadline)).toBe(true);

    // A project-only Viewer cannot restore.
    const viewerItems = listTrash(db, actor(viewer));
    for (const item of viewerItems) expect(item.canRestore).toBe(false);
  });
});

describe('restoreProject', () => {
  it('restores only the projects trashed by the same action', () => {
    const parent = createProject(db, {
      title: 'Restore parent',
      parentId: homeId,
      reporterId: admin.id,
    });
    createWorkflow(db, parent.id, { names: ['One', 'Two'] });
    const child = createProject(db, {
      title: 'Restore child',
      parentId: parent.id,
      reporterId: admin.id,
    });
    const separatelyTrashed = createProject(db, {
      title: 'Separately trashed',
      parentId: parent.id,
      reporterId: admin.id,
    });
    trashProjects(db, actor(admin), [separatelyTrashed.id]);
    const parentAction = trashProjects(db, actor(admin), [parent.id]);

    const result = restoreProject(db, actor(admin), parent.id);
    expect(result.restored).toEqual(expect.arrayContaining([parent.id, child.id]));
    expect(result.restored).not.toContain(separatelyTrashed.id);
    expect(row(parent.id).trashed_at).toBeNull();
    expect(row(child.id).trashed_at).toBeNull();
    expect(row(separatelyTrashed.id).trashed_at).not.toBeNull();
    expect(row(separatelyTrashed.id).trash_action_id).not.toBe(parentAction.actionId);
    expect(inSearch(parent.id)).toBe(true);
    expect(auditActions(child.id)).toContain('project.restored');
  });

  it('refuses to restore into a trashed parent or by a Viewer', () => {
    const parent = createProject(db, {
      title: 'Outer restore parent',
      parentId: homeId,
      reporterId: admin.id,
    });
    createWorkflow(db, parent.id, { names: ['One', 'Two'] });
    const child = createProject(db, {
      title: 'Inner restore child',
      parentId: parent.id,
      reporterId: admin.id,
    });
    trashProjects(db, actor(admin), [child.id]);
    trashProjects(db, actor(admin), [parent.id]);
    expect(expectDomainError(() => restoreProject(db, actor(admin), child.id)).status).toBe(409);

    grantRole(db, child.id, viewer.id, 'viewer');
    expect(expectDomainError(() => restoreProject(db, actor(viewer), child.id)).status).toBe(403);
  });

  it('defers retired statuses until restore and requires an explicit mapping', () => {
    const parent = createProject(db, {
      title: 'Workflow parent',
      parentId: homeId,
      reporterId: admin.id,
    });
    const workflow = createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
    const child = createProject(db, {
      title: 'Retired status child',
      parentId: parent.id,
      reporterId: admin.id,
      statusId: workflow[0]!.id,
    });
    trashProjects(db, actor(admin), [child.id]);

    // Remove "To do"; because only the trashed child uses it, it is retired
    // rather than remapped immediately (build-spec §6 rule 5).
    replaceWorkflow(
      db,
      actor(admin),
      parent.id,
      [{ id: workflow[1]!.id, name: 'Done', isStart: true, isFinish: true }],
      {},
    );
    const restoreInfo = getRestoreInfo(db, actor(admin), child.id);
    expect(restoreInfo.requiresMapping).toBe(true);
    expect(restoreInfo.candidates[0]?.invalid).toBe(true);

    expect(
      expectDomainError(() => restoreProject(db, actor(admin), child.id)).status,
    ).toBe(422);
    const mapped = restoreProject(db, actor(admin), child.id, {
      [child.id]: workflow[1]!.id,
    });
    expect(mapped.restored).toContain(child.id);
    expect(row(child.id).status_id).toBe(workflow[1]!.id);
    expect(row(child.id).trashed_at).toBeNull();
  });
});
