import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  changeInboxParent,
  reorderInboxProject,
} from '@/server/domain/inbox';
import { listInboxTree } from '@/server/domain/inbox';
import { DomainError } from '@/server/domain/permissions';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  createProject,
  createRoot,
  createUser,
  createWorkflow,
  getProjectRow,
  grantRole,
  type FixtureProject,
  type FixtureUser,
} from '../helpers/fixtures';

/**
 * Inbox drag reorder/reparent (issue #53).
 *
 * There is one global project priority sequence. An Inbox reorder either maps
 * directly to "before the target" or computes the next visible project and maps
 * "after" onto the existing global reorder. Reparenting keeps that global
 * position instead of appending to the destination.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;
let editor: FixtureUser;
let viewer: FixtureUser;
let root: ReturnType<typeof createRoot>;
let home: FixtureProject;
let household: FixtureProject;
let privateProject: FixtureProject;
let c1: FixtureProject;
let c2: FixtureProject;
let c3: FixtureProject;
let nonInbox: FixtureProject;
let trashedNext: FixtureProject;
let activeAfter: FixtureProject;
let archivedNext: FixtureProject;
let trashedCapture: FixtureProject;

function actor(who: FixtureUser, showArchived = false) {
  return { id: who.id, appRole: who.appRole, showArchived };
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

/** The single global sequence, exactly as the reorder implementation reads it. */
function globalOrder(): string[] {
  return (
    db.prepare('SELECT id FROM projects ORDER BY priority ASC, seq ASC').all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}

/** Restores the deterministic global order the assertions are written against. */
function resetGlobalOrder(): void {
  const order: Array<[FixtureProject | ReturnType<typeof createRoot>, number]> = [
    [root, 0],
    [home, 1],
    [household, 2],
    [c1, 3],
    [c2, 4],
    [c3, 5],
    [nonInbox, 6],
    [trashedNext, 7],
    [activeAfter, 8],
    [archivedNext, 9],
    [trashedCapture, 10],
    [privateProject, 11],
  ];
  db.prepare('UPDATE projects SET priority = priority + 1000').run();
  const assign = db.prepare('UPDATE projects SET priority = ? WHERE id = ?');
  for (const [project, priority] of order) assign.run(priority, project.id);
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'inbox-reorder-domain' });
  db = test.db;
  admin = await createUser(db, { username: 'inbox-reorder-admin', appRole: 'admin' });
  editor = await createUser(db, { username: 'inbox-reorder-editor' });
  viewer = await createUser(db, { username: 'inbox-reorder-viewer', appRole: 'viewer' });

  root = createRoot(db, admin.id);
  grantRole(db, root.id, editor.id, 'user');
  grantRole(db, root.id, viewer.id, 'viewer');

  home = createProject(db, {
    title: 'Home improvement',
    parentId: root.id,
    reporterId: admin.id,
    inbox: false,
    priority: 1,
  });
  grantRole(db, home.id, admin.id, 'admin');
  grantRole(db, home.id, editor.id, 'user');
  grantRole(db, home.id, viewer.id, 'viewer');
  createWorkflow(db, home.id);

  household = createProject(db, {
    title: 'Household',
    parentId: root.id,
    reporterId: admin.id,
    inbox: false,
    priority: 2,
  });
  grantRole(db, household.id, admin.id, 'admin');
  createWorkflow(db, household.id);

  privateProject = createProject(db, {
    title: 'Private plans',
    parentId: root.id,
    reporterId: admin.id,
    inbox: false,
    priority: 11,
    settings: { access: 'custom' },
  });
  grantRole(db, privateProject.id, admin.id, 'admin');

  c1 = createProject(db, {
    title: 'Capture one',
    parentId: home.id,
    reporterId: admin.id,
    inbox: true,
    priority: 3,
  });
  c2 = createProject(db, {
    title: 'Capture two',
    parentId: home.id,
    reporterId: admin.id,
    inbox: true,
    priority: 4,
  });
  c3 = createProject(db, {
    title: 'Capture three',
    parentId: household.id,
    reporterId: admin.id,
    inbox: true,
    priority: 5,
  });
  nonInbox = createProject(db, {
    title: 'Not a capture',
    parentId: home.id,
    reporterId: admin.id,
    inbox: false,
    priority: 6,
  });
  trashedNext = createProject(db, {
    title: 'Trashed next',
    parentId: home.id,
    reporterId: admin.id,
    inbox: false,
    priority: 7,
    trashedAt: new Date().toISOString(),
  });
  activeAfter = createProject(db, {
    title: 'Active after trash',
    parentId: home.id,
    reporterId: admin.id,
    inbox: false,
    priority: 8,
  });
  archivedNext = createProject(db, {
    title: 'Archived next',
    parentId: home.id,
    reporterId: admin.id,
    inbox: false,
    priority: 9,
    archived: true,
  });
  trashedCapture = createProject(db, {
    title: 'Trashed capture',
    parentId: home.id,
    reporterId: admin.id,
    inbox: true,
    priority: 10,
    trashedAt: new Date().toISOString(),
  });
});

beforeEach(() => {
  resetGlobalOrder();
});

afterAll(() => {
  test.cleanup();
});

describe('reorderInboxProject — before/after in the global sequence', () => {
  it('moves a capture before the target and keeps it in the Inbox at the same status', () => {
    const statusBefore = getProjectRow(db, c3.id)!.status_id;
    const before = globalOrder();
    const updated = reorderInboxProject(db, actor(admin), c3.id, {
      targetId: c1.id,
      edge: 'before',
    });

    const expected = before.filter((id) => id !== c3.id);
    expected.splice(expected.indexOf(c1.id), 0, c3.id);
    expect(globalOrder()).toEqual(expected);
    expect(updated.inbox).toBe(true);
    expect(updated.statusId).toBe(statusBefore);
    expect(getProjectRow(db, c3.id)!.inbox).toBe(1);
    const priorities = globalOrder().map((id) => getProjectRow(db, id)!.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('moves a capture after the target using the next visible project server-side', () => {
    const before = globalOrder();
    reorderInboxProject(db, actor(admin), c1.id, {
      targetId: c2.id,
      edge: 'after',
    });

    const expected = before.filter((id) => id !== c1.id);
    expected.splice(expected.indexOf(c2.id) + 1, 0, c1.id);
    expect(globalOrder()).toEqual(expected);
    // The capture stayed in the Inbox.
    expect(getProjectRow(db, c1.id)!.inbox).toBe(1);
  });

  it('skips trashed projects when resolving an "after" position', () => {
    reorderInboxProject(db, actor(admin), c3.id, {
      targetId: nonInbox.id,
      edge: 'after',
    });

    const order = globalOrder();
    const targetIndex = order.indexOf(nonInbox.id);
    const trashedIndex = order.indexOf(trashedNext.id);
    const draggedIndex = order.indexOf(c3.id);
    const activeAfterIndex = order.indexOf(activeAfter.id);
    // Trashed rows still sit in the raw global sequence, so the dragged row is
    // placed after it and before the next visible project.
    expect(trashedIndex).toBe(targetIndex + 1);
    expect(draggedIndex).toBeGreaterThan(trashedIndex);
    expect(draggedIndex).toBeLessThan(activeAfterIndex);
  });

  it('appends after the last visible project when nothing follows the target', () => {
    // Private plans is the last project the Admin can see (trashed/archived rows
    // after it are not visible), so "after" has no next position to target.
    reorderInboxProject(db, actor(admin), c3.id, {
      targetId: privateProject.id,
      edge: 'after',
    });
    const order = globalOrder();
    expect(order.indexOf(c3.id)).toBe(order.length - 1);
    expect(order.at(-1)).toBe(c3.id);
  });
});

describe('reorderInboxProject — validation', () => {
  it('rejects a Viewer with 403', () => {
    const error = expectDomainError(() =>
      reorderInboxProject(db, actor(viewer), c1.id, {
        targetId: c2.id,
        edge: 'before',
      }),
    );
    expect(error.status).toBe(403);
  });

  it('rejects projects that are not in the Inbox', () => {
    const error = expectDomainError(() =>
      reorderInboxProject(db, actor(editor), home.id, {
        targetId: c1.id,
        edge: 'before',
      }),
    );
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/Inbox/i);
  });

  it('rejects a trashed capture and a trashed target', () => {
    const source = expectDomainError(() =>
      reorderInboxProject(db, actor(admin), trashedCapture.id, {
        targetId: c1.id,
        edge: 'before',
      }),
    );
    expect(source.status).toBe(409);

    const target = expectDomainError(() =>
      reorderInboxProject(db, actor(admin), c1.id, {
        targetId: trashedCapture.id,
        edge: 'before',
      }),
    );
    expect(target.status).toBe(409);
  });

  it('rejects self, missing and unreadable targets, and unknown edges', () => {
    expect(
      expectDomainError(() =>
        reorderInboxProject(db, actor(admin), c1.id, {
          targetId: c1.id,
          edge: 'before',
        }),
      ).status,
    ).toBe(422);

    expect(
      expectDomainError(() =>
        reorderInboxProject(db, actor(admin), c1.id, {
          targetId: 'missing-project',
          edge: 'after',
        }),
      ).status,
    ).toBe(404);

    // The editor can edit c1 but cannot read the Custom private project.
    expect(
      expectDomainError(() =>
        reorderInboxProject(db, actor(editor), c1.id, {
          targetId: privateProject.id,
          edge: 'before',
        }),
      ).status,
    ).toBe(404);

    expect(
      expectDomainError(() =>
        reorderInboxProject(db, actor(admin), c1.id, { targetId: c2.id }),
      ).status,
    ).toBe(422);

    expect(
      expectDomainError(() =>
        reorderInboxProject(db, actor(admin), c1.id, {
          targetId: c2.id,
          edge: 'sideways',
        }),
      ).status,
    ).toBe(422);
  });
});

describe('reparent + global priority', () => {
  it('changing parent keeps the capture’s global position, not an append', () => {
    const priorityBefore = getProjectRow(db, c1.id)!.priority;
    const change = changeInboxParent(db, actor(admin), c1.id, {
      destinationId: household.id,
    });

    expect(change.inbox).toBe(true);
    expect(change.parentId).toBe(household.id);
    // Issue #53: reparenting never appends; the global priority is unchanged.
    expect(getProjectRow(db, c1.id)!.priority).toBe(priorityBefore);

    // In the destination, order is still the global sequence: c1 (3) before
    // c3 (5), even though c3 was created there first.
    const tree = listInboxTree(db, actor(admin));
    const householdChildren = tree
      .filter((node) => node.parentId === household.id)
      .map((node) => node.id);
    expect(householdChildren.indexOf(c1.id)).toBeGreaterThanOrEqual(0);
    expect(householdChildren.indexOf(c1.id)).toBeLessThan(householdChildren.indexOf(c3.id));
  });
});
