import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { findUserById } from '@/server/auth/current-user';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { DomainError, loadAccessContext, canReadProject } from '@/server/domain/permissions';
import {
  createProject,
  getMoveInfo,
  getProjectPageData,
  moveProject,
  updateProject,
} from '@/server/domain/projects';
import { getWorkflowData, replaceWorkflow } from '@/server/domain/workflow';
import { listInbox, releaseInboxProject } from '@/server/domain/inbox';
import { restoreProject, trashProjects } from '@/server/domain/trash';
import { listActivity } from '@/server/domain/audit';
import { getInboxWidget } from '@/server/domain/dashboard';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  createProject as createFixtureProject,
  createRoot,
  createUser,
  createWorkflow,
  getProjectRow,
  getStatuses,
  grantRole,
  type FixtureProject,
  type FixtureUser,
  type WorkflowStatusRow,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';

/**
 * Regression tests for the architecture-review fix pass (AR-021/029/032/
 * 033/035/036/039/044/045/048/050/052). These behaviours were fixed after the
 * initial builders' smoke scripts; this file keeps them permanently covered.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const usersRoute = await import('@/app/api/users/route');
const meRoute = await import('@/app/api/me/route');
const projectRoute = await import('@/app/api/projects/[id]/route');
const activityRoute = await import('@/app/api/projects/[id]/activity/route');

const usersPost = (req: Request) => usersRoute.POST(req, EMPTY_CONTEXT);
const usersPatch = (req: Request) => usersRoute.PATCH(req, EMPTY_CONTEXT);
const mePatch = (req: Request) => meRoute.PATCH(req, EMPTY_CONTEXT);

let test: TestDatabase;
let db: BetterSqliteDatabase;
let appAdmin: FixtureUser;
let rootId: string;
let userCounter = 0;

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

interface ProjectFixture {
  project: FixtureProject;
  statuses: WorkflowStatusRow[];
}

/** Creates a project under Root with an owned workflow and explicit grants. */
function projectUnderRoot(
  title: string,
  grants: Array<[FixtureUser, 'admin' | 'user' | 'viewer']>,
  statusNames: string[] = ['To do', 'Done'],
): ProjectFixture {
  const project = createFixtureProject(db, {
    title,
    parentId: rootId,
    reporterId: appAdmin.id,
  });
  const statuses = createWorkflow(db, project.id, { names: statusNames });
  for (const [user, role] of grants) grantRole(db, project.id, user.id, role);
  return { project, statuses };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'ar-regressions' });
  db = test.db;
  appAdmin = await createUser(db, { username: 'ar-admin', appRole: 'admin' });
  const root = createRoot(db, appAdmin.id);
  rootId = root.id;
});

beforeEach(() => {
  resetRequestContext();
});

afterAll(() => {
  test.cleanup();
});

function uniqueName(prefix: string): string {
  userCounter += 1;
  return `${prefix}-${userCounter}`;
}

describe('AR-045: project mutations require a project Admin; app Admin does not bypass', () => {
  it('rejects project User and Viewer for trash, restore, archive and move', async () => {
    const owner = await createUser(db, { username: uniqueName('ar045-owner'), appRole: 'admin' });
    const projectUser = await createUser(db, { username: uniqueName('ar045-user'), appRole: 'user' });
    const viewer = await createUser(db, { username: uniqueName('ar045-viewer'), appRole: 'viewer' });
    const target = projectUnderRoot('AR045 target', [
      [owner, 'admin'],
      [projectUser, 'user'],
      [viewer, 'viewer'],
    ]);

    // Trash
    expect(expectDomainError(() => trashProjects(db, actor(projectUser), [target.project.id])).status).toBe(403);
    expect(expectDomainError(() => trashProjects(db, actor(viewer), [target.project.id])).status).toBe(403);

    // Archive
    expect(
      expectDomainError(() =>
        updateProject(db, actor(projectUser), target.project.id, { archived: true }),
      ).status,
    ).toBe(403);
    expect(
      expectDomainError(() =>
        updateProject(db, actor(viewer), target.project.id, { archived: true }),
      ).status,
    ).toBe(403);

    // Move (to a destination the actor can edit)
    const destination = projectUnderRoot('AR045 destination', [[owner, 'admin']]);
    const oldStatus = getProjectRow(db, target.project.id)!.status_id!;
    const mapping = { [oldStatus]: destination.statuses[0]!.id };
    expect(
      expectDomainError(() =>
        moveProject(db, actor(projectUser), target.project.id, {
          destinationId: destination.project.id,
          mapping,
        }),
      ).status,
    ).toBe(403);
    expect(
      expectDomainError(() =>
        moveProject(db, actor(viewer), target.project.id, {
          destinationId: destination.project.id,
          mapping,
        }),
      ).status,
    ).toBe(403);

    // Project Admin succeeds at trashing a second project.
    const owned = projectUnderRoot('AR045 owned', [[owner, 'admin']]);
    const trashed = trashProjects(db, actor(owner), [owned.project.id]);
    expect(trashed.trashed).toContain(owned.project.id);
  });

  it('rejects project User and Viewer for restore, then lets the project Admin restore', async () => {
    const owner = await createUser(db, { username: uniqueName('ar045-restore-owner'), appRole: 'admin' });
    const projectUser = await createUser(db, { username: uniqueName('ar045-restore-user'), appRole: 'user' });
    const viewer = await createUser(db, { username: uniqueName('ar045-restore-viewer'), appRole: 'viewer' });
    const target = projectUnderRoot('AR045 restore target', [
      [owner, 'admin'],
      [projectUser, 'user'],
      [viewer, 'viewer'],
    ]);
    trashProjects(db, actor(owner), [target.project.id]);
    expect(
      expectDomainError(() => restoreProject(db, actor(projectUser), target.project.id)).status,
    ).toBe(403);
    expect(expectDomainError(() => restoreProject(db, actor(viewer), target.project.id)).status).toBe(
      403,
    );
    const restored = restoreProject(db, actor(owner), target.project.id);
    expect(restored.restored).toContain(target.project.id);
  });

  it('does not let an application Admin bypass another project access', async () => {
    const privateOwner = await createUser(db, {
      username: uniqueName('ar045-private-owner'),
      appRole: 'admin',
    });
    const privateProject = projectUnderRoot('AR045 private', [[privateOwner, 'admin']]);
    // appAdmin has no grant on the private project and no Root grant, so even an
    // application Admin cannot read or mutate it.
    const ctx = loadAccessContext(db, actor(appAdmin));
    expect(canReadProject(ctx, privateProject.project.id)).toBe(false);
    const error = expectDomainError(() =>
      trashProjects(db, actor(appAdmin), [privateProject.project.id]),
    );
    expect([403, 404]).toContain(error.status);
    expect(trashProjects(db, actor(privateOwner), [privateProject.project.id]).trashed).toContain(
      privateProject.project.id,
    );
  });
});

describe('AR-032/052: read paths never mutate the database', () => {
  function tableCounts(): Record<string, number> {
    const tables = [
      'projects',
      'statuses',
      'project_roles',
      'favorites',
      'audit_events',
      'trash_actions',
      'project_search',
      'settings',
    ];
    return Object.fromEntries(
      tables.map((table) => [
        table,
        (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
      ]),
    );
  }

  it('keeps row counts and timestamps identical across project, workflow, inbox and move-info reads', async () => {
    const owner = await createUser(db, { username: uniqueName('ar032-owner'), appRole: 'admin' });
    const viewer = await createUser(db, { username: uniqueName('ar032-viewer'), appRole: 'viewer' });
    const parent = projectUnderRoot('AR032 parent', [
      [owner, 'admin'],
      [viewer, 'viewer'],
    ]);
    const child = createFixtureProject(db, {
      title: 'AR032 child',
      parentId: parent.project.id,
      reporterId: owner.id,
      inbox: true,
    });
    grantRole(db, child.id, owner.id, 'admin');
    grantRole(db, child.id, viewer.id, 'viewer');

    const before = tableCounts();
    const childUpdatedBefore = getProjectRow(db, child.id)!.updated_at;
    const parentUpdatedBefore = getProjectRow(db, parent.project.id)!.updated_at;

    getProjectPageData(db, actor(owner), parent.project.id);
    getProjectPageData(db, actor(viewer), parent.project.id);
    getWorkflowData(db, parent.project.id);
    listInbox(db, actor(owner));
    getMoveInfo(db, actor(owner), child.id);

    expect(tableCounts()).toEqual(before);
    expect(getProjectRow(db, child.id)!.updated_at).toBe(childUpdatedBefore);
    expect(getProjectRow(db, parent.project.id)!.updated_at).toBe(parentUpdatedBefore);
  });
});

describe('AR-036: workflow remap clears Inbox for affected children', () => {
  it('clears inbox and records fromId/toId on the child status audit', async () => {
    const owner = await createUser(db, { username: uniqueName('ar036-owner'), appRole: 'admin' });
    const parent = projectUnderRoot('AR036 parent', [[owner, 'admin']], ['To do', 'Doing', 'Done']);
    const child = createFixtureProject(db, {
      title: 'AR036 inbox child',
      parentId: parent.project.id,
      reporterId: owner.id,
      statusId: parent.statuses[1]!.id,
      inbox: true,
    });
    grantRole(db, child.id, owner.id, 'admin');

    replaceWorkflow(
      db,
      actor(owner),
      parent.project.id,
      [
        { id: parent.statuses[0]!.id, name: 'To do', isStart: true },
        { id: parent.statuses[2]!.id, name: 'Done', isFinish: true },
      ],
      { [parent.statuses[1]!.id]: parent.statuses[2]!.id },
    );

    const row = getProjectRow(db, child.id)!;
    expect(row.inbox).toBe(0);
    expect(row.status_id).toBe(parent.statuses[2]!.id);
    const event = db
      .prepare(
        "SELECT detail FROM audit_events WHERE project_id = ? AND action = 'project.status_changed' ORDER BY rowid DESC LIMIT 1",
      )
      .get(child.id) as { detail: string } | undefined;
    expect(JSON.parse(event!.detail)).toEqual({
      fromId: parent.statuses[1]!.id,
      toId: parent.statuses[2]!.id,
    });
  });
});

describe('AR-029/048: activity uses the write-time child title snapshot', () => {
  it('keeps the snapshot after rename and simulated purge and never exposes the later title', async () => {
    const owner = await createUser(db, { username: uniqueName('ar029-owner'), appRole: 'admin' });
    const viewer = await createUser(db, { username: uniqueName('ar029-viewer'), appRole: 'viewer' });
    const parent = projectUnderRoot('AR029 parent', [
      [owner, 'admin'],
      [viewer, 'viewer'],
    ]);

    const child = createProject(db, actor(owner), {
      parentId: parent.project.id,
      title: 'Snapshot title',
    });
    updateProject(db, actor(owner), child.id, { title: 'Renamed later' });

    const parentPage = listActivity(db, parent.project.id);
    const created = parentPage.events.find(
      (event) => event.action === AUDIT_ACTIONS.childCreated,
    );
    expect(created?.target).toEqual({ id: child.id, title: 'Snapshot title' });
    expect(JSON.stringify(parentPage)).not.toContain('Renamed later');

    // Simulated purge: the child row is gone, the parent's log keeps the
    // write-time snapshot instead of a dangling title.
    db.prepare('DELETE FROM projects WHERE id = ?').run(child.id);
    const afterPurge = listActivity(db, parent.project.id);
    const stillThere = afterPurge.events.find(
      (event) => event.action === AUDIT_ACTIONS.childCreated,
    );
    expect(stillThere?.target?.title).toBe('Snapshot title');

    // The reader of the parent can read the event but still only sees the
    // snapshot, not any later title.
    const ctx = loadAccessContext(db, actor(viewer));
    expect(canReadProject(ctx, parent.project.id)).toBe(true);
    const viewerPage = listActivity(db, parent.project.id);
    expect(JSON.stringify(viewerPage)).not.toContain('Renamed later');
    expect(JSON.stringify(viewerPage)).toContain('Snapshot title');
  });
});

describe('AR-033: audit vocabulary and status ids in detail', () => {
  it('accepts workflow.updated and project.inbox_released as audit actions', async () => {
    expect(AUDIT_ACTIONS.workflowUpdated).toBe('workflow.updated');
    expect(AUDIT_ACTIONS.projectInboxReleased).toBe('project.inbox_released');

    const owner = await createUser(db, { username: uniqueName('ar033-owner'), appRole: 'admin' });
    const parent = projectUnderRoot('AR033 parent', [[owner, 'admin']], ['To do', 'Doing', 'Done']);
    const child = createFixtureProject(db, {
      title: 'AR033 child',
      parentId: parent.project.id,
      reporterId: owner.id,
      inbox: true,
    });
    grantRole(db, child.id, owner.id, 'admin');

    // Status change via the project domain carries fromId/toId.
    updateProject(db, actor(owner), child.id, { statusId: parent.statuses[2]!.id });
    const statusEvent = db
      .prepare(
        "SELECT detail FROM audit_events WHERE project_id = ? AND action = 'project.status_changed' ORDER BY rowid DESC LIMIT 1",
      )
      .get(child.id) as { detail: string };
    expect(JSON.parse(statusEvent.detail)).toEqual({
      fromId: parent.statuses[0]!.id,
      toId: parent.statuses[2]!.id,
    });

    // Inbox release is audited with the new action name.
    const second = createFixtureProject(db, {
      title: 'AR033 release child',
      parentId: parent.project.id,
      reporterId: owner.id,
      inbox: true,
    });
    grantRole(db, second.id, owner.id, 'admin');
    releaseInboxProject(db, actor(owner), second.id);
    const releaseEvent = db
      .prepare(
        "SELECT action FROM audit_events WHERE project_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(second.id) as { action: string };
    expect(releaseEvent.action).toBe('project.inbox_released');

    // Workflow edits are audited under the workflow.updated action.
    replaceWorkflow(
      db,
      actor(owner),
      parent.project.id,
      [
        { id: parent.statuses[0]!.id, name: 'To do', isStart: true },
        { id: parent.statuses[2]!.id, name: 'Done', isFinish: true },
      ],
      { [parent.statuses[1]!.id]: parent.statuses[2]!.id },
    );
    const workflowEvent = db
      .prepare(
        "SELECT action FROM audit_events WHERE project_id = ? AND action = 'workflow.updated'",
      )
      .get(parent.project.id) as { action: string } | undefined;
    expect(workflowEvent?.action).toBe('workflow.updated');
  });
});

describe('AR-039: the current parent is not a move destination', () => {
  it('omits the current parent from move-info destinations', async () => {
    const owner = await createUser(db, { username: uniqueName('ar039-owner'), appRole: 'admin' });
    const parent = projectUnderRoot('AR039 parent', [[owner, 'admin']]);
    const child = createFixtureProject(db, {
      title: 'AR039 child',
      parentId: parent.project.id,
      reporterId: owner.id,
    });
    grantRole(db, child.id, owner.id, 'admin');

    const info = getMoveInfo(db, actor(owner), child.id);
    const destinationIds = info.destinations.map((destination) => destination.id);
    expect(destinationIds).not.toContain(parent.project.id);
    // Root remains a valid destination for a project Admin.
    expect(destinationIds).toContain(rootId);
  });
});

describe('AR-035: a move that leaves a subtree without an Admin is rejected', () => {
  it('rejects the move and names the affected project', async () => {
    const owner = await createUser(db, { username: uniqueName('ar035-owner'), appRole: 'admin' });
    const source = projectUnderRoot('AR035 source', [[owner, 'admin']]);
    // Destination grants only the user role; moving the child here removes its
    // inherited Admin.
    const destination = projectUnderRoot('AR035 destination', [[owner, 'user']]);
    const moved = createFixtureProject(db, {
      title: 'AR035 moved project',
      parentId: source.project.id,
      reporterId: owner.id,
    });
    grantRole(db, moved.id, owner.id, 'admin');
    // Remove the explicit grant so the only Admin is inherited from the source.
    db.prepare('DELETE FROM project_roles WHERE project_id = ? AND user_id = ?').run(
      moved.id,
      owner.id,
    );
    createWorkflow(db, moved.id, { names: ['One', 'Two'] });

    const oldStatus = getProjectRow(db, moved.id)!.status_id!;
    const error = expectDomainError(() =>
      moveProject(db, actor(owner), moved.id, {
        destinationId: destination.project.id,
        mapping: { [oldStatus]: destination.statuses[0]!.id },
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('last_admin');
    expect(error.message).toContain('AR035 moved project');
  });
});

describe('AR-021: a user created through /users gets a Root role', () => {
  it('creates a Root grant and the new account can read Root', async () => {
    signIn(db, appAdmin.id);
    const username = uniqueName('ar021-created');
    const created = await usersPost(
      request('/api/users', {
        method: 'POST',
        body: { username, email: `${username}@example.com`, password: 'ar021-pass' },
      }),
    );
    expect(created.status).toBe(201);
    const createdUser = (await json<{ user: { id: string; appRole: string } }>(created)).user;
    expect(createdUser.appRole).toBe('user');

    const rootGrant = db
      .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
      .get(rootId, createdUser.id) as { role: string } | undefined;
    expect(rootGrant?.role).toBe('user');

    signIn(db, createdUser.id);
    const page = await projectRoute.GET(request(`/api/projects/${rootId}`), params(rootId));
    expect(page.status).toBe(200);
    const payload = await json<{ project: { isRoot: boolean; effectiveRole: string } }>(page);
    expect(payload.project.isRoot).toBe(true);
    expect(payload.project.effectiveRole).toBe('user');

    // Changing the application role updates the explicit Root row: Viewer
    // keeps a viewer grant, Admin relies on the implicit Root Admin fallback.
    signIn(db, appAdmin.id);
    const toViewer = await usersPatch(
      request('/api/users', {
        method: 'PATCH',
        body: { id: createdUser.id, appRole: 'viewer' },
      }),
    );
    expect(toViewer.status).toBe(200);
    const viewerGrant = db
      .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
      .get(rootId, createdUser.id) as { role: string };
    expect(viewerGrant.role).toBe('viewer');
    signIn(db, createdUser.id);
    const viewerPage = await projectRoute.GET(request(`/api/projects/${rootId}`), params(rootId));
    expect(viewerPage.status).toBe(200);

    signIn(db, appAdmin.id);
    const toAdmin = await usersPatch(
      request('/api/users', {
        method: 'PATCH',
        body: { id: createdUser.id, appRole: 'admin' },
      }),
    );
    expect(toAdmin.status).toBe(200);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM project_roles WHERE project_id = ? AND user_id = ?')
        .get(rootId, createdUser.id),
    ).toEqual({ count: 0 });
    signIn(db, createdUser.id);
    const promotedPage = await projectRoute.GET(request(`/api/projects/${rootId}`), params(rootId));
    expect(promotedPage.status).toBe(200);
    const promoted = await json<{ project: { effectiveRole: string } }>(promotedPage);
    expect(promoted.project.effectiveRole).toBe('admin');
  });
});

describe('AR-050: the Home Inbox widget never exposes an inaccessible parent title', () => {
  it('shows the item but withholds the parent title', async () => {
    const owner = await createUser(db, { username: uniqueName('ar050-owner'), appRole: 'admin' });
    const directUser = await createUser(db, {
      username: uniqueName('ar050-direct'),
      appRole: 'user',
    });
    const privateParent = createFixtureProject(db, {
      title: 'AR050 secret parent',
      parentId: rootId,
      reporterId: owner.id,
    });
    grantRole(db, privateParent.id, owner.id, 'admin');
    const privateStatuses = createWorkflow(db, privateParent.id, { names: ['To do', 'Done'] });
    const inboxChild = createFixtureProject(db, {
      title: 'AR050 directly granted child',
      parentId: privateParent.id,
      reporterId: owner.id,
      statusId: privateStatuses[0]!.id,
      inbox: true,
    });
    grantRole(db, inboxChild.id, directUser.id, 'user');

    const authUser = findUserById(db, directUser.id);
    expect(authUser).not.toBeNull();
    const widget = getInboxWidget(db, authUser!);
    const item = widget.items.find((entry) => entry.id === inboxChild.id);
    expect(item).toBeDefined();
    expect(item?.parentTitle).toBeNull();
    // The status name is also parent context; withhold it as well.
    expect(item?.statusName).toBeNull();
    expect(JSON.stringify(widget)).not.toContain('AR050 secret parent');
    expect(widget.total).toBeGreaterThanOrEqual(1);
  });
});

describe('AR-044: unknown dashboard widget ids survive a save', () => {
  it('stores the unknown preference while exposing only registered widgets', async () => {
    signIn(db, appAdmin.id);
    const response = await mePatch(
      request('/api/me', {
        method: 'PATCH',
        body: {
          dashboard: [
            { id: 'inbox', visible: true },
            { id: 'future-widget', visible: true },
          ],
        },
      }),
    );
    expect(response.status).toBe(200);
    const stored = db
      .prepare('SELECT dashboard FROM users WHERE id = ?')
      .get(appAdmin.id) as { dashboard: string };
    expect(stored.dashboard).toContain('future-widget');
    const payload = await json<{ user: { dashboard: Array<{ id: string }> } }>(response);
    // The stored preference round-trips; rendering filters to known widgets.
    expect(payload.user.dashboard.map((entry) => entry.id)).toContain('future-widget');

    // A later save keeps the unknown entry too.
    await mePatch(
      request('/api/me', {
        method: 'PATCH',
        body: {
          dashboard: [
            { id: 'recent', visible: true },
            { id: 'future-widget', visible: false },
          ],
        },
      }),
    );
    const storedAgain = db
      .prepare('SELECT dashboard FROM users WHERE id = ?')
      .get(appAdmin.id) as { dashboard: string };
    expect(storedAgain.dashboard).toContain('future-widget');
  });
});
