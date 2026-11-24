import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  createProject,
  displayId,
  getProjectPageData,
  getProjectRow,
  moveProject,
  reorderProject,
  setProjectFavorite,
  updateProject,
  updateProjectSettings,
} from '@/server/domain/projects';
import { DomainError } from '@/server/domain/permissions';
import { resolveProjectLayoutMode } from '@/lib/projects';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  createProject as createFixtureProject,
  createRoot,
  createUser,
  createWorkflow,
  getStatuses,
  grantRole,
  type FixtureUser,
  type WorkflowStatusRow,
} from '../helpers/fixtures';

/**
 * Project lifecycle rules (build-spec §6 rules 1, 4, 6–8, 10).
 * create / update / reorder / move, plus audit + FTS side effects.
 */

interface Fixture {
  admin: FixtureUser;
  maya: FixtureUser;
  viewer: FixtureUser;
  rootId: string;
  homeId: string;
  homeStatuses: WorkflowStatusRow[];
  kitchenId: string;
  inboxChildId: string;
}

let test: TestDatabase;
let db: BetterSqliteDatabase;

function actor(user: FixtureUser, showArchived = false) {
  return { id: user.id, appRole: user.appRole, showArchived };
}

let sharedRoot: RelationRow | null = null;

interface RelationRow {
  id: string;
}

async function makeFixture(label: string): Promise<Fixture> {
  const admin = await createUser(db, { username: `${label}-admin`, appRole: 'admin' });
  const maya = await createUser(db, { username: `${label}-maya`, appRole: 'user' });
  const viewer = await createUser(db, { username: `${label}-viewer`, appRole: 'viewer' });
  const root = sharedRoot ?? createRoot(db, admin.id);
  sharedRoot = root;
  grantRole(db, root.id, maya.id, 'user');
  grantRole(db, root.id, viewer.id, 'viewer');
  const home = createFixtureProject(db, {
    title: 'Home improvement',
    parentId: root.id,
    reporterId: admin.id,
  });
  grantRole(db, home.id, admin.id, 'admin');
  grantRole(db, home.id, maya.id, 'user');
  grantRole(db, home.id, viewer.id, 'viewer');
  const homeStatuses = createWorkflow(db, home.id);
  const kitchen = createFixtureProject(db, {
    title: 'Kitchen',
    parentId: home.id,
    reporterId: admin.id,
  });
  const inboxChild = createFixtureProject(db, {
    title: 'Inbox child',
    parentId: home.id,
    reporterId: admin.id,
    inbox: true,
  });
  return {
    admin,
    maya,
    viewer,
    rootId: root.id,
    homeId: home.id,
    homeStatuses,
    kitchenId: kitchen.id,
    inboxChildId: inboxChild.id,
  };
}

beforeAll(() => {
  test = createTestDatabase({ label: 'projects-domain' });
  db = test.db;
});

afterAll(() => {
  test.cleanup();
});

function auditRows(projectId: string): Array<{
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  target_id: string | null;
  detail: string | null;
}> {
  return db
    .prepare(
      `SELECT action, field, old_value, new_value, target_id, detail
         FROM audit_events WHERE project_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(projectId) as Array<{
    action: string;
    field: string | null;
    old_value: string | null;
    new_value: string | null;
    target_id: string | null;
    detail: string | null;
  }>;
}

function searchRows(projectId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM project_search WHERE project_id = ?')
    .get(projectId) as { count: number };
  return row.count;
}

describe('createProject', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await makeFixture('create');
  });

  it('derives status, priority, reporter and Inbox from the parent', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: '  Paint   the hallway  ',
    });
    expect(card.title).toBe('Paint the hallway');
    expect(card.parent?.id).toBe(fixture.homeId);
    expect(card.statusId).toBe(fixture.homeStatuses[0]!.id);
    expect(card.statusName).toBe('To do');
    expect(card.priority).toBeGreaterThan(fixture.inboxChildId ? 1 : 0);
    expect(card.inbox).toBe(true);
    expect(card.reporter.id).toBe(fixture.admin.id);
    expect(card.displayId).toBe(displayId(card.seq));
    expect(card.displayId).toMatch(/^KAP-\d+$/);
  });

  it('appends new projects last in the global sequence', () => {
    const before = db
      .prepare('SELECT COALESCE(MAX(priority), -1) AS priority FROM projects')
      .get() as { priority: number };
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Appended project',
    });
    expect(card.priority).toBe(before.priority + 1);
  });

  it('inherits parent grants and makes the creator Admin', async () => {
    const child = createProject(db, actor(fixture.maya), {
      parentId: fixture.homeId,
      title: 'By maya',
    });
    const grants = db
      .prepare('SELECT user_id, role FROM project_roles WHERE project_id = ?')
      .all(child.id) as Array<{ user_id: string; role: string }>;
    const roles = new Map(grants.map((grant) => [grant.user_id, grant.role]));
    // Parent had admin admin, maya user, viewer viewer — copied over.
    expect(roles.get(fixture.admin.id)).toBe('admin');
    expect(roles.get(fixture.maya.id)).toBe('admin');
    expect(roles.get(fixture.viewer.id)).toBe('viewer');
  });

  it('writes project.created and parent child_created audit events', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Audited child',
    });
    const own = auditRows(card.id);
    expect(own[0]?.action).toBe('project.created');
    expect(own[0]?.detail).toContain('Home improvement');
    const parent = auditRows(fixture.homeId);
    const childEvent = parent.find(
      (event) => event.action === 'project.child_created' && event.target_id === card.id,
    );
    expect(childEvent).toBeDefined();
    expect(childEvent?.target_id).toBe(card.id);
    expect(childEvent?.new_value).toBe('Audited child');
  });

  it('indexes the new title for search', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Unique searchable widget',
    });
    expect(searchRows(card.id)).toBe(1);
    const hits = db
      .prepare("SELECT project_id FROM project_search WHERE project_search MATCH 'widget'")
      .all() as Array<{ project_id: string }>;
    expect(hits.map((row) => row.project_id)).toContain(card.id);
  });

  it('validates the title', () => {
    const error = (() => {
      try {
        createProject(db, actor(fixture.admin), { parentId: fixture.homeId, title: '   ' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(422);
    expect(error?.fields?.title).toBeTruthy();
  });

  it('requires edit access to the parent', () => {
    const noAccess = createUser.bind(null, db);
    void noAccess;
    // An application Viewer is read-only even with a project grant.
    const error = (() => {
      try {
        createProject(db, actor(fixture.viewer), { parentId: fixture.homeId, title: 'Nope' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(403);
  });

  it('returns 404 when the parent is not readable', async () => {
    const privateParent = createFixtureProject(db, {
      title: 'Private parent',
      parentId: fixture.rootId,
      reporterId: fixture.admin.id,
    });
    grantRole(db, privateParent.id, fixture.admin.id, 'admin');
    const outsider = await createUser(db, { username: 'create-outsider' });
    const error = (() => {
      try {
        createProject(db, actor(outsider), { parentId: privateParent.id, title: 'Nope' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(404);
  });

  it('rejects children of a trashed parent', () => {
    db.prepare('UPDATE projects SET trashed_at = ?, purge_deadline = ? WHERE id = ?').run(
      new Date().toISOString(),
      new Date(Date.now() + 30 * 86_400_000).toISOString(),
      fixture.kitchenId,
    );
    const error = (() => {
      try {
        createProject(db, actor(fixture.admin), { parentId: fixture.kitchenId, title: 'Nope' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(409);
    db.prepare('UPDATE projects SET trashed_at = NULL, purge_deadline = NULL WHERE id = ?').run(
      fixture.kitchenId,
    );
  });

  it('honours the parent skip_inbox setting', () => {
    updateProjectSettings(db, actor(fixture.admin), fixture.homeId, { skip_inbox: true });
    try {
      const card = createProject(db, actor(fixture.admin), {
        parentId: fixture.homeId,
        title: 'Skipped inbox',
      });
      expect(card.inbox).toBe(false);
    } finally {
      updateProjectSettings(db, actor(fixture.admin), fixture.homeId, { skip_inbox: false });
    }
  });
});

describe('updateProject', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await makeFixture('update');
  });

  it('renames with an audit event and refreshes the search index', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Old name',
    });
    const result = updateProject(db, actor(fixture.admin), card.id, { title: '  New   name ' });
    expect(result.project.title).toBe('New name');
    const rename = auditRows(card.id).find((event) => event.action === 'project.renamed');
    expect(rename).toMatchObject({
      field: 'title',
      old_value: 'Old name',
      new_value: 'New name',
    });
    const hits = db
      .prepare("SELECT project_id FROM project_search WHERE project_search MATCH 'New'")
      .all() as Array<{ project_id: string }>;
    expect(hits.map((row) => row.project_id)).toContain(card.id);
    const stale = db
      .prepare("SELECT project_id FROM project_search WHERE project_search MATCH 'Old'")
      .all() as Array<{ project_id: string }>;
    expect(stale.map((row) => row.project_id)).not.toContain(card.id);
  });

  it('changes status from the parent workflow and clears Inbox', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Status change',
    });
    expect(card.inbox).toBe(true);
    const done = fixture.homeStatuses.find((status) => status.isFinish)!;
    const result = updateProject(db, actor(fixture.admin), card.id, { statusId: done.id });
    expect(result.project.statusId).toBe(done.id);
    expect(result.project.inbox).toBe(false);
    const event = auditRows(card.id).find((row) => row.action === 'project.status_changed');
    expect(event).toMatchObject({ field: 'status', old_value: 'To do', new_value: 'Done' });
  });

  it('logs only the child\'s own field changes, never the parent\'s', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Quiet child',
    });
    const parentBefore = auditRows(fixture.homeId).length;
    updateProject(db, actor(fixture.admin), card.id, { title: 'Quiet child renamed' });
    const finish = fixture.homeStatuses.find((status) => status.isFinish)!;
    updateProject(db, actor(fixture.admin), card.id, { statusId: finish.id });
    // The parent only logs child creation/trashing (build-spec §6 rule 10).
    expect(auditRows(fixture.homeId)).toHaveLength(parentBefore);
  });

  it('rejects a status from another workflow', async () => {
    const other = createFixtureProject(db, {
      title: 'Other workflow owner',
      parentId: fixture.rootId,
      reporterId: fixture.admin.id,
    });
    grantRole(db, other.id, fixture.admin.id, 'admin');
    const foreignStatuses = createWorkflow(db, other.id, { names: ['A', 'B'] });
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Foreign status',
    });
    const error = (() => {
      try {
        updateProject(db, actor(fixture.admin), card.id, { statusId: foreignStatuses[0]!.id });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(422);
    expect(error?.fields?.status).toBeTruthy();
  });

  it('rejects an empty title without writing', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Keep me',
    });
    const error = (() => {
      try {
        updateProject(db, actor(fixture.admin), card.id, { title: '  ' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(422);
    expect(getProjectRow(db, card.id)?.title).toBe('Keep me');
  });

  it('archives and unarchives (project Admin only) with audit events', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Archive me',
    });
    const archived = updateProject(db, actor(fixture.admin), card.id, { archived: true });
    expect(archived.project.archived).toBe(true);
    const archiveEvent = auditRows(card.id).find((row) => row.action === 'project.archived');
    expect(archiveEvent?.field).toBe('archived');

    const unarchived = updateProject(db, actor(fixture.admin), card.id, { archived: false });
    expect(unarchived.project.archived).toBe(false);
    expect(
      auditRows(card.id).some((row) => row.action === 'project.unarchived'),
    ).toBe(true);

    const mayaError = (() => {
      try {
        updateProject(db, actor(fixture.maya), card.id, { archived: true });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(mayaError?.status).toBe(403);
  });

  it('never lets Root change status or be archived', () => {
    const statusError = (() => {
      try {
        updateProject(db, actor(fixture.admin), fixture.rootId, {
          statusId: fixture.homeStatuses[0]!.id,
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(statusError?.status).toBe(422);
    const archiveError = (() => {
      try {
        updateProject(db, actor(fixture.admin), fixture.rootId, { archived: true });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(archiveError?.status).toBe(422);
  });

  it('blocks a Viewer and a trashed project, and hides unreadable projects', async () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Restricted',
    });
    const viewerError = (() => {
      try {
        updateProject(db, actor(fixture.viewer), card.id, { title: 'By viewer' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(viewerError?.status).toBe(403);

    db.prepare(
      'UPDATE projects SET trashed_at = ?, purge_deadline = ? WHERE id = ?',
    ).run(new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString(), card.id);
    const trashedError = (() => {
      try {
        updateProject(db, actor(fixture.admin), card.id, { title: 'Rename trashed' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(trashedError?.status).toBe(409);
    db.prepare('UPDATE projects SET trashed_at = NULL, purge_deadline = NULL WHERE id = ?').run(
      card.id,
    );

    const outsider = await createUser(db, { username: 'update-outsider' });
    const hiddenError = (() => {
      try {
        updateProject(db, actor(outsider), card.id, { title: 'By outsider' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(hiddenError?.status).toBe(404);
  });
});

describe('setProjectFavorite', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await makeFixture('favorite');
  });

  it('toggles and sets the favorite flag without granting access', async () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Favorite me',
    });
    expect(setProjectFavorite(db, actor(fixture.maya), card.id, true)).toEqual({ favorite: true });
    expect(setProjectFavorite(db, actor(fixture.maya), card.id, null)).toEqual({ favorite: false });
    expect(setProjectFavorite(db, actor(fixture.maya), card.id, null)).toEqual({ favorite: true });
    const outsider = await createUser(db, { username: 'favorite-outsider' });
    const error = (() => {
      try {
        setProjectFavorite(db, actor(outsider), card.id, true);
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(404);
  });
});

describe('reorderProject', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await makeFixture('reorder');
  });

  function siblingOrder(parentId: string): string[] {
    return (
      db
        .prepare('SELECT id FROM projects WHERE parent_id = ? ORDER BY priority ASC')
        .all(parentId) as Array<{ id: string }>
    ).map((row) => row.id);
  }

  function globalOrder(): string[] {
    return (
      db
        .prepare('SELECT id FROM projects ORDER BY priority ASC, seq ASC')
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
  }

  function globalPriorities(): number[] {
    return (
      db
        .prepare('SELECT priority FROM projects ORDER BY priority ASC, seq ASC')
        .all() as Array<{ priority: number }>
    ).map((row) => row.priority);
  }

  it('rewrites the global sequence when moving a project before a sibling', () => {
    const order = siblingOrder(fixture.homeId);
    const target = order.at(-1)!;
    const first = order[0]!;
    reorderProject(db, actor(fixture.admin), target, { beforeId: first });
    expect(siblingOrder(fixture.homeId)[0]).toBe(target);
    // Issue #53: the whole app shares one contiguous global sequence.
    expect(globalPriorities()).toEqual(globalPriorities().map((_, index) => index));
  });

  it('appends at the end of the global sequence when beforeId is null', () => {
    const order = siblingOrder(fixture.homeId);
    const dragged = order[0]!;
    reorderProject(db, actor(fixture.admin), dragged, { beforeId: null });
    expect(globalOrder().at(-1)).toBe(dragged);
    expect(siblingOrder(fixture.homeId).at(-1)).toBe(dragged);
    expect(globalPriorities()).toEqual(globalPriorities().map((_, index) => index));
  });

  it('moves before a project under a different parent in the global sequence', () => {
    // Global order starts as [target, moved, otherChild].
    const target = createProject(db, actor(fixture.admin), {
      parentId: fixture.rootId,
      title: 'Global target',
    });
    const moved = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Global mover',
    });
    const otherChild = createProject(db, actor(fixture.admin), {
      parentId: fixture.rootId,
      title: 'Another root child',
    });
    const rootBefore = siblingOrder(fixture.rootId);
    expect(rootBefore.indexOf(target.id)).toBeLessThan(rootBefore.indexOf(otherChild.id));

    reorderProject(db, actor(fixture.admin), moved.id, { beforeId: target.id });

    const ids = globalOrder();
    expect(ids.indexOf(moved.id)).toBe(ids.indexOf(target.id) - 1);
    // Reparenting is not involved: the project stays under its parent.
    expect(getProjectRow(db, moved.id)!.parent_id).toBe(fixture.homeId);
    // Sibling order in each parent is the global order restricted to it.
    expect(siblingOrder(fixture.homeId)).toEqual(
      ids.filter((id) => getProjectRow(db, id)!.parent_id === fixture.homeId),
    );
    expect(siblingOrder(fixture.rootId)).toEqual(
      ids.filter((id) => getProjectRow(db, id)!.parent_id === fixture.rootId),
    );
    expect(globalPriorities()).toEqual(globalPriorities().map((_, index) => index));
  });

  it('keeps priority shared across statuses when only moving columns', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Column move',
    });
    const before = db
      .prepare('SELECT priority FROM projects WHERE id = ?')
      .get(card.id) as { priority: number };
    const inProgress = fixture.homeStatuses[1]!;
    const result = updateProject(db, actor(fixture.admin), card.id, {
      statusId: inProgress.id,
    });
    const after = db
      .prepare('SELECT priority, status_id FROM projects WHERE id = ?')
      .get(card.id) as { priority: number; status_id: string };
    expect(after.status_id).toBe(inProgress.id);
    expect(after.priority).toBe(before.priority);
    expect(result.project.inbox).toBe(false);
    expect(globalPriorities()).toEqual(globalPriorities().map((_, index) => index));
  });

  it('validates Root, invalid positions and permission preconditions', () => {
    const card = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Position validation',
    });

    const missingTarget = (() => {
      try {
        reorderProject(db, actor(fixture.admin), card.id, { beforeId: 'missing-project' });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(missingTarget?.status).toBe(422);

    const rootError = (() => {
      try {
        reorderProject(db, actor(fixture.admin), fixture.rootId, { beforeId: null });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(rootError?.status).toBe(422);

    const viewerError = (() => {
      try {
        reorderProject(db, actor(fixture.viewer), card.id, { beforeId: null });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(viewerError?.status).toBe(403);
  });
});

describe('moveProject', () => {
  let fixture: Fixture;
  let householdId: string;
  let householdStatuses: WorkflowStatusRow[];
  let renovateId: string;
  let renovateStatuses: WorkflowStatusRow[];

  beforeAll(async () => {
    fixture = await makeFixture('move');
    const household = createFixtureProject(db, {
      title: 'Household',
      parentId: fixture.rootId,
      reporterId: fixture.admin.id,
    });
    householdId = household.id;
    grantRole(db, householdId, fixture.admin.id, 'admin');
    grantRole(db, householdId, fixture.maya.id, 'user');
    householdStatuses = createWorkflow(db, householdId, { names: ['Open', 'Closed'] });
    renovateId = createFixtureProject(db, {
      title: 'Renovate basement',
      parentId: fixture.homeId,
      reporterId: fixture.admin.id,
    }).id;
    grantRole(db, renovateId, fixture.admin.id, 'admin');
    renovateStatuses = createWorkflow(db, renovateId, { names: ['To do', 'Done'] });
  });

  it('requires an explicit mapping even when names match', () => {
    const error = (() => {
      try {
        moveProject(db, actor(fixture.admin), fixture.inboxChildId, {
          destinationId: householdId,
          mapping: {},
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(422);
    expect(error?.code).toBe('mapping_required');

    const matchingNameError = (() => {
      try {
        moveProject(db, actor(fixture.admin), fixture.kitchenId, {
          destinationId: renovateId,
          mapping: {},
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(matchingNameError?.code).toBe('mapping_required');
  });

  it('moves the project, remaps its status, keeps its global priority and descendants', () => {
    const kitchenStatuses = createWorkflow(db, fixture.kitchenId, { names: ['One', 'Two'] });
    const child = createFixtureProject(db, {
      title: 'Child of moved',
      parentId: fixture.kitchenId,
      reporterId: fixture.admin.id,
    });
    grantRole(db, child.id, fixture.admin.id, 'admin');
    createWorkflow(db, child.id, { names: ['Leaf', 'Beyond'] });
    const grandchild = createFixtureProject(db, {
      title: 'Grandchild',
      parentId: child.id,
      reporterId: fixture.admin.id,
    });
    const grandchildStatus = getStatuses(db, child.id)[0]!;

    const oldStatus = getProjectRow(db, fixture.kitchenId)!.status_id!;
    const priorityBefore = getProjectRow(db, fixture.kitchenId)!.priority;
    const mapped = householdStatuses.find((status) => status.name === 'Open')!;
    const result = moveProject(db, actor(fixture.admin), fixture.kitchenId, {
      destinationId: householdId,
      mapping: { [oldStatus]: mapped.id },
    });
    expect(result.parent?.id).toBe(householdId);
    expect(result.statusId).toBe(mapped.id);
    // Issue #53: reparenting preserves the global position instead of appending.
    expect(result.priority).toBe(priorityBefore);
    // The destination's sibling order is the global order restricted to it.
    const destinationOrder = (
      db
        .prepare('SELECT id FROM projects WHERE parent_id = ? ORDER BY priority ASC, seq ASC')
        .all(householdId) as Array<{ id: string }>
    ).map((row) => row.id);
    expect(destinationOrder).toContain(fixture.kitchenId);
    // Descendants keep their own parent and status.
    const grandchildRow = getProjectRow(db, grandchild.id)!;
    expect(grandchildRow.parent_id).toBe(child.id);
    expect(grandchildRow.status_id).toBe(grandchildStatus.id);
    // Audit: the moved project logs parent + status; the destination does not
    // duplicate routine child edits.
    const moved = auditRows(fixture.kitchenId).filter((row) => row.action === 'project.moved');
    expect(moved).toHaveLength(1);
    expect(moved[0]?.old_value).toBe('Home improvement');
    expect(moved[0]?.new_value).toBe('Household');
  });

  it('clears Inbox when the move changes status (build-spec §6 rule 6)', () => {
    const inboxProject = createProject(db, actor(fixture.admin), {
      parentId: householdId,
      title: 'Move from inbox',
    });
    expect(inboxProject.inbox).toBe(true);
    const oldStatus = getProjectRow(db, inboxProject.id)!.status_id!;
    const mapped = renovateStatuses[0]!;
    const result = moveProject(db, actor(fixture.admin), inboxProject.id, {
      destinationId: renovateId,
      mapping: { [oldStatus]: mapped.id },
    });
    expect(result.inbox).toBe(false);
  });

  it('rejects cycles and invalid destinations', () => {
    const cycleParent = createFixtureProject(db, {
      title: 'Cycle parent',
      parentId: householdId,
      reporterId: fixture.admin.id,
    });
    createWorkflow(db, cycleParent.id, { names: ['Open', 'Closed'] });
    const cycleChild = createFixtureProject(db, {
      title: 'Cycle child',
      parentId: cycleParent.id,
      reporterId: fixture.admin.id,
    });
    const cycle = (() => {
      try {
        moveProject(db, actor(fixture.admin), cycleParent.id, {
          destinationId: cycleChild.id,
          mapping: {},
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(cycle?.status).toBe(422);
    expect(cycle?.message).toMatch(/subtree/i);

    const rootMove = (() => {
      try {
        moveProject(db, actor(fixture.admin), fixture.rootId, {
          destinationId: householdId,
          mapping: {},
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(rootMove?.status).toBe(422);

    const noAccessDestination = (() => {
      try {
        moveProject(db, actor(fixture.admin), fixture.kitchenId, {
          destinationId: 'missing-project',
          mapping: {},
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(noAccessDestination?.status).toBe(404);
  });

  it('rejects a destination the actor cannot edit', async () => {
    // Destination readable only by its own project Admin.
    const privateDestination = createFixtureProject(db, {
      title: 'Private destination',
      parentId: fixture.rootId,
      reporterId: fixture.maya.id,
    });
    createWorkflow(db, privateDestination.id, { names: ['Open', 'Closed'] });
    grantRole(db, privateDestination.id, fixture.maya.id, 'admin');
    const homeStatus = getProjectRow(db, fixture.homeId)!.status_id!;
    const unreadable = (() => {
      try {
        moveProject(db, actor(fixture.admin), fixture.homeId, {
          destinationId: privateDestination.id,
          mapping: {},
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(unreadable?.status).toBe(404);

    // Destination readable by admin as Viewer → cannot receive a move.
    grantRole(db, privateDestination.id, fixture.admin.id, 'viewer');
    const destinationWorkflow = getStatuses(db, privateDestination.id);
    const readOnlyDestination = (() => {
      try {
        moveProject(db, actor(fixture.admin), fixture.homeId, {
          destinationId: privateDestination.id,
          mapping: { [homeStatus]: destinationWorkflow[0]!.id },
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(readOnlyDestination?.status).toBe(403);
  });
});

describe('getProjectPageData visibility', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await makeFixture('page');
  });

  it('returns null for an unreadable project instead of leaking it', async () => {
    const outsider = await createUser(db, { username: 'page-outsider' });
    expect(getProjectPageData(db, actor(outsider), fixture.homeId)).toBeNull();
    expect(getProjectPageData(db, actor(fixture.admin), fixture.homeId)).not.toBeNull();
  });

  it('omits trashed and archived children unless visible', () => {
    const trashed = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Trashed child',
    });
    db.prepare('UPDATE projects SET trashed_at = ?, purge_deadline = ? WHERE id = ?').run(
      new Date().toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
      trashed.id,
    );
    const page = getProjectPageData(db, actor(fixture.admin), fixture.homeId)!;
    expect(page.children.map((child) => child.id)).not.toContain(trashed.id);
  });

  it('reports the effective role and capability flags', () => {
    const page = getProjectPageData(db, actor(fixture.maya), fixture.homeId)!;
    expect(page.project.effectiveRole).toBe('user');
    expect(page.project.canEdit).toBe(true);
    expect(page.project.canAdmin).toBe(false);
    expect(page.project.canMove).toBe(false);
    // Collection cards carry the viewer's Admin capability per child, so the
    // row menu can offer Trash only where the API would allow it.
    expect(page.children.find((child) => child.id === fixture.kitchenId)?.canAdmin).toBe(false);

    const adminPage = getProjectPageData(db, actor(fixture.admin), fixture.homeId)!;
    expect(adminPage.project.canAdmin).toBe(true);
    expect(adminPage.project.canMove).toBe(true);
    expect(adminPage.children.find((child) => child.id === fixture.kitchenId)?.canAdmin).toBe(true);
  });
});

describe('getProjectPageData archived fallbacks', () => {
  let fixture: Fixture;
  let underArchivedId: string;

  beforeAll(async () => {
    fixture = await makeFixture('archived-fallback');
    createWorkflow(db, fixture.kitchenId, { names: ['To do', 'Done'] });
    underArchivedId = createFixtureProject(db, {
      title: 'Under archived',
      parentId: fixture.kitchenId,
      reporterId: fixture.admin.id,
    }).id;
  });

  it('flags an archived project and points to the nearest visible ancestor', () => {
    db.prepare('UPDATE projects SET archived = 1 WHERE id = ?').run(fixture.kitchenId);

    const page = getProjectPageData(db, actor(fixture.maya, true), fixture.kitchenId)!;
    expect(page.project.archived).toBe(true);
    expect(page.project.hiddenWhenArchivedOff).toBe(true);
    expect(page.project.fallbackHref).toBe(`/p/${fixture.homeId}`);

    // The server gate still hides the page when Show archived is off; the
    // client uses hiddenWhenArchivedOff to navigate before refreshing.
    expect(getProjectPageData(db, actor(fixture.maya, false), fixture.kitchenId)).toBeNull();
  });

  it('falls back past an archived ancestor for its descendants', () => {
    const page = getProjectPageData(db, actor(fixture.maya, true), underArchivedId)!;
    expect(page.project.archived).toBe(false);
    expect(page.project.hiddenWhenArchivedOff).toBe(true);
    expect(page.project.fallbackHref).toBe(`/p/${fixture.homeId}`);
  });

  it('leaves non-archived projects visible with their parent as the fallback', () => {
    const active = createFixtureProject(db, {
      title: 'Active sibling',
      parentId: fixture.homeId,
      reporterId: fixture.admin.id,
    });
    const page = getProjectPageData(db, actor(fixture.maya, true), active.id)!;
    expect(page.project.hiddenWhenArchivedOff).toBe(false);
    expect(page.project.fallbackHref).toBe(`/p/${fixture.homeId}`);
  });

  it('uses Root as the fallback for Root children and Root itself', () => {
    const page = getProjectPageData(db, actor(fixture.maya, true), fixture.homeId)!;
    expect(page.project.hiddenWhenArchivedOff).toBe(false);
    expect(page.project.fallbackHref).toBe(`/p/${fixture.rootId}`);

    const rootPage = getProjectPageData(db, actor(fixture.maya, true), fixture.rootId)!;
    expect(rootPage.project.fallbackHref).toBe(`/p/${fixture.rootId}`);
  });
});

describe('layout template defaults (issue #17)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await makeFixture('layout');
  });

  it('defaults to an empty Details card with a status/reporter sidebar', () => {
    const home = getProjectPageData(db, actor(fixture.admin), fixture.homeId)!;
    expect(home.layout).toEqual({ main: [], sidebar: ['status', 'reporter'] });

    // Root inherits the same default: only the Details heading is rendered.
    const root = getProjectPageData(db, actor(fixture.admin), fixture.rootId)!;
    expect(root.layout).toEqual({ main: [], sidebar: ['status', 'reporter'] });
  });

  it('keeps each project own template and copies the parent template to new children', () => {
    updateProjectSettings(db, actor(fixture.admin), fixture.homeId, {
      inherit_layout: false,
      layout_template: {
        main: ['projectId', 'parent', 'reporter'],
        sidebar: ['status', 'reporter'],
      },
    });
    const home = getProjectPageData(db, actor(fixture.admin), fixture.homeId)!;
    expect(home.layout).toEqual({
      main: ['projectId', 'parent', 'reporter'],
      sidebar: ['status', 'reporter'],
    });

    // Existing children no longer resolve through the parent chain.
    const existing = getProjectPageData(db, actor(fixture.admin), fixture.kitchenId)!;
    expect(existing.layout).toEqual({ main: [], sidebar: ['status', 'reporter'] });

    // A child created now copies the parent's current effective template once.
    const created = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Template copy',
    });
    const copied = getProjectPageData(db, actor(fixture.admin), created.id)!;
    expect(copied.layout).toEqual({
      main: ['projectId', 'parent', 'reporter'],
      sidebar: ['status', 'reporter'],
    });
    expect(copied.settings.inherit_layout).toBe(false);

    // A child can define its own template; later parent edits never reach it.
    updateProjectSettings(db, actor(fixture.admin), created.id, {
      inherit_layout: false,
      layout_template: { main: ['updated'], sidebar: ['parent'] },
    });
    updateProjectSettings(db, actor(fixture.admin), fixture.homeId, {
      inherit_layout: false,
      layout_template: { main: ['reporter'], sidebar: ['status'] },
    });
    const own = getProjectPageData(db, actor(fixture.admin), created.id)!;
    expect(own.layout).toEqual({ main: ['updated'], sidebar: ['parent'] });
  });
});

describe('project layout mode', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await makeFixture('layout-mode');
  });

  it('defaults ordinary projects to full and Root to children + history', () => {
    const home = getProjectPageData(db, actor(fixture.admin), fixture.homeId)!;
    expect(home.settings.layout_mode).toBeNull();
    expect(resolveProjectLayoutMode(home.settings, false)).toBe('full');

    const root = getProjectPageData(db, actor(fixture.admin), fixture.rootId)!;
    expect(root.settings.layout_mode).toBeNull();
    expect(resolveProjectLayoutMode(root.settings, true)).toBe('children');
  });

  it('stores the selected mode and copies it to new children', () => {
    updateProjectSettings(db, actor(fixture.admin), fixture.homeId, {
      layout_mode: 'children',
    });
    const home = getProjectPageData(db, actor(fixture.admin), fixture.homeId)!;
    expect(home.settings.layout_mode).toBe('children');

    const created = createProject(db, actor(fixture.admin), {
      parentId: fixture.homeId,
      title: 'Focused child',
    });
    const child = getProjectPageData(db, actor(fixture.admin), created.id)!;
    expect(child.settings.layout_mode).toBe('children');
  });

  it('does not copy Root’s focused default to a new Root child', () => {
    updateProjectSettings(db, actor(fixture.admin), fixture.rootId, {
      layout_mode: 'children',
    });
    const created = createProject(db, actor(fixture.admin), {
      parentId: fixture.rootId,
      title: 'Root focused child',
    });
    const child = getProjectPageData(db, actor(fixture.admin), created.id)!;
    expect(child.settings.layout_mode).toBeNull();
    expect(resolveProjectLayoutMode(child.settings, false)).toBe('full');
  });

  it('rejects an unknown layout mode', () => {
    expect(() =>
      updateProjectSettings(db, actor(fixture.admin), fixture.homeId, {
        layout_mode: 'minimal',
      }),
    ).toThrow(DomainError);
  });
});
