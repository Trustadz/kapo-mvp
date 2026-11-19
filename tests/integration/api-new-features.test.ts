import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  createProject,
  createRoot,
  createUser,
  createWorkflow,
  getProjectRow,
  getStatuses,
  grantRole,
  type FixtureUser,
  type WorkflowStatusRow,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';

/**
 * Final-feature coverage (frozen tree):
 *  - workflow same-name replacement of an in-use finish status (was a 500),
 *  - per-view property slots (settings.view_fields),
 *  - Tree bulk move (multi-status mapping, all-or-nothing, priority append,
 *    Inbox clearing, permissions),
 *  - Trash action grouping with actor/date and independent deadlines,
 *  - bulk trash sharing one action.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const workflowRoute = await import('@/app/api/projects/[id]/workflow/route');
const settingsRoute = await import('@/app/api/projects/[id]/settings/route');
const moveRoute = await import('@/app/api/projects/[id]/move/route');
const trashRoute = await import('@/app/api/projects/[id]/trash/route');
const restoreRoute = await import('@/app/api/projects/[id]/restore/route');
const searchRoute = await import('@/app/api/search/route');

const workflowGet = (id: string) =>
  workflowRoute.GET(request(`/api/projects/${id}/workflow`), params(id));
const workflowPut = (id: string, body: unknown) =>
  workflowRoute.PUT(request(`/api/projects/${id}/workflow`, { method: 'PUT', body }), params(id));
const settingsGet = (id: string) =>
  settingsRoute.GET(request(`/api/projects/${id}/settings`), params(id));
const settingsPut = (id: string, body: unknown) =>
  settingsRoute.PUT(request(`/api/projects/${id}/settings`, { method: 'PUT', body }), params(id));
const movePost = (id: string, body: unknown) =>
  moveRoute.POST(request(`/api/projects/${id}/move`, { method: 'POST', body }), params(id));
const trashPost = (id: string, body: unknown = {}) =>
  trashRoute.POST(request(`/api/projects/${id}/trash`, { method: 'POST', body }), params(id));
const restoreInfo = (id: string) =>
  restoreRoute.GET(request(`/api/projects/${id}/restore`), params(id));
const searchGet = (url: string) => searchRoute.GET(request(url), EMPTY_CONTEXT);

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;
let projectUser: FixtureUser;
let viewer: FixtureUser;
let rootId: string;

function actor(who: FixtureUser) {
  return { id: who.id, appRole: who.appRole, showArchived: false };
}

function projectUnderRoot(title: string, statusNames = ['To do', 'In progress', 'Done']) {
  const project = createProject(db, {
    title,
    parentId: rootId,
    reporterId: admin.id,
  });
  const statuses = createWorkflow(db, project.id, { names: statusNames });
  grantRole(db, project.id, admin.id, 'admin');
  return { project, statuses };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-new-features' });
  db = test.db;
  admin = await createUser(db, { username: 'new-admin', appRole: 'admin' });
  projectUser = await createUser(db, { username: 'new-user', appRole: 'user' });
  viewer = await createUser(db, { username: 'new-viewer', appRole: 'viewer' });
  rootId = createRoot(db, admin.id).id;
});

beforeEach(() => {
  resetRequestContext();
  signIn(db, admin.id);
});

afterAll(() => {
  test.cleanup();
});

describe('workflow same-name replacement (regression: was a 500)', () => {
  it('replaces an in-use finish status with a new status of the same name', async () => {
    const { project, statuses } = projectUnderRoot('Same-name workflow');
    const child = createProject(db, {
      title: 'Child in Done',
      parentId: project.id,
      reporterId: admin.id,
      statusId: statuses[2]!.id,
    });
    grantRole(db, child.id, admin.id, 'admin');
    const [todo, inProgress, done] = statuses as [WorkflowStatusRow, WorkflowStatusRow, WorkflowStatusRow];

    const response = await workflowPut(project.id, {
      statuses: [
        { id: todo.id, name: 'To do', isStart: true },
        { id: inProgress.id, name: 'In progress' },
        { id: null, name: 'Done', isFinish: true },
      ],
      // The new "Done" has no id yet, so the child is explicitly mapped to the
      // kept In progress status; the old Done row is replaced by a new one with
      // the same name. This used to 500 on UNIQUE(statuses.parent_id, name).
      mapping: { [done.id]: inProgress.id },
    });
    expect(response.status).toBe(200);
    const payload = await json<{
      remappedChildren: number;
      workflow: { statuses: Array<{ id: string; name: string }> };
    }>(response);
    expect(payload.remappedChildren).toBe(1);

    const row = getProjectRow(db, child.id)!;
    expect(row.status_id).toBe(inProgress.id);
    expect(row.inbox).toBe(0);

    const workflow = await workflowGet(project.id);
    const workflowPayload = await json<{ statuses: Array<{ id: string; name: string }> }>(workflow);
    const namedDone = workflowPayload.statuses.filter((status) => status.name === 'Done');
    expect(namedDone).toHaveLength(1);
    expect(namedDone[0]?.id).not.toBe(done.id);
    expect(workflowPayload.statuses.map((status) => status.name)).toEqual([
      'To do',
      'In progress',
      'Done',
    ]);

    const audit = db
      .prepare(
        "SELECT detail FROM audit_events WHERE project_id = ? AND action = 'project.status_changed' ORDER BY rowid DESC LIMIT 1",
      )
      .get(child.id) as { detail: string };
    expect(JSON.parse(audit.detail)).toEqual({ fromId: done.id, toId: inProgress.id });
  });

  it('still requires explicit mapping for an in-use removed status', async () => {
    const { project, statuses } = projectUnderRoot('Same-name no mapping');
    const child = createProject(db, {
      title: 'Child needs mapping',
      parentId: project.id,
      reporterId: admin.id,
      statusId: statuses[2]!.id,
    });
    grantRole(db, child.id, admin.id, 'admin');
    const response = await workflowPut(project.id, {
      statuses: [
        { id: statuses[0]!.id, name: 'To do', isStart: true },
        { id: statuses[1]!.id, name: 'In progress' },
        { id: null, name: 'Done', isFinish: true },
      ],
      mapping: {},
    });
    expect(response.status).toBe(422);
    expect(getProjectRow(db, child.id)!.status_id).toBe(statuses[2]!.id);
  });
});

describe('per-view property slots (settings.view_fields)', () => {
  it('returns the documented defaults', async () => {
    const { project } = projectUnderRoot('View fields defaults');
    const response = await settingsGet(project.id);
    expect(response.status).toBe(200);
    const payload = await json<{
      settings: { view_fields: Record<string, string[]> };
    }>(response);
    expect(payload.settings.view_fields).toEqual({
      kanban: [],
      card: [],
      tree: ['status'],
      list: [],
    });
  });

  it('round-trips, partial-merges and de-duplicates view fields', async () => {
    const { project } = projectUnderRoot('View fields round trip');
    const response = await settingsPut(project.id, {
      view_fields: { kanban: ['status', 'priority', 'status'], card: ['reporter'] },
    });
    expect(response.status).toBe(200);
    const payload = await json<{ settings: { view_fields: Record<string, string[]> } }>(
      response,
    );
    expect(payload.settings.view_fields.kanban).toEqual(['status', 'priority']);
    expect(payload.settings.view_fields.card).toEqual(['reporter']);
    // Untouched views keep their previous/default values.
    expect(payload.settings.view_fields.tree).toEqual(['status']);
    expect(payload.settings.view_fields.list).toEqual([]);

    const read = await settingsGet(project.id);
    const readPayload = await json<{ settings: { view_fields: Record<string, string[]> } }>(read);
    expect(readPayload.settings.view_fields).toEqual(payload.settings.view_fields);
  });

  it('rejects unknown property keys with 422 and writes nothing', async () => {
    const { project } = projectUnderRoot('View fields invalid');
    const before = await settingsGet(project.id);
    const beforePayload = await json<{ settings: { view_fields: Record<string, string[]> } }>(before);

    for (const bad of [
      { kanban: ['gantt'] },
      { kanban: ['status', 42] },
      { tree: 'status' },
    ]) {
      const response = await settingsPut(project.id, { view_fields: bad });
      expect(response.status).toBe(422);
      const payload = await json<{ error: { code: string; fields: Record<string, string> } }>(
        response,
      );
      expect(payload.error.code).toBe('validation_failed');
      expect(payload.error.fields.view_fields).toBeTruthy();
    }
    const after = await settingsGet(project.id);
    const afterPayload = await json<{ settings: { view_fields: Record<string, string[]> } }>(after);
    expect(afterPayload.settings.view_fields).toEqual(beforePayload.settings.view_fields);
  });

  it('exposes view_fields on the project page payload', async () => {
    const { project } = projectUnderRoot('View fields page payload');
    await settingsPut(project.id, { view_fields: { list: ['priority', 'parent'] } });
    const pageRoute = await import('@/app/api/projects/[id]/route');
    const response = await pageRoute.GET(
      request(`/api/projects/${project.id}`),
      params(project.id),
    );
    expect(response.status).toBe(200);
    const payload = await json<{ settings: { view_fields: Record<string, string[]> } }>(response);
    expect(payload.settings.view_fields.list).toEqual(['priority', 'parent']);
    expect(payload.settings.view_fields.tree).toEqual(['status']);
  });
});

describe('Tree bulk move', () => {
  it('maps two old statuses, appends priorities, clears Inbox and is all-or-nothing', async () => {
    const { project: source, statuses: sourceStatuses } = projectUnderRoot(
      'Bulk source',
      ['One', 'Two', 'Three'],
    );
    const destination = projectUnderRoot('Bulk destination', ['Open', 'Closed']);
    const first = createProject(db, {
      title: 'Bulk first',
      parentId: source.id,
      reporterId: admin.id,
      statusId: sourceStatuses[0]!.id,
      inbox: true,
    });
    const second = createProject(db, {
      title: 'Bulk second',
      parentId: source.id,
      reporterId: admin.id,
      statusId: sourceStatuses[1]!.id,
      inbox: true,
    });
    grantRole(db, first.id, admin.id, 'admin');
    grantRole(db, second.id, admin.id, 'admin');
    const destinationStatuses = getStatuses(db, destination.project.id);
    const mapping = {
      [sourceStatuses[0]!.id]: destinationStatuses[0]!.id,
      [sourceStatuses[1]!.id]: destinationStatuses[1]!.id,
    };

    // Missing one mapping: 422 and nothing changes.
    const missing = await movePost(first.id, {
      destinationId: destination.project.id,
      projectIds: [second.id],
      mapping: { [sourceStatuses[0]!.id]: destinationStatuses[0]!.id },
    });
    expect(missing.status).toBe(422);
    const missingPayload = await json<{ error: { code: string } }>(missing);
    expect(missingPayload.error.code).toBe('mapping_required');
    expect(getProjectRow(db, first.id)!.parent_id).toBe(source.id);
    expect(getProjectRow(db, second.id)!.parent_id).toBe(source.id);
    expect(getProjectRow(db, first.id)!.inbox).toBe(1);

    const response = await movePost(first.id, {
      destinationId: destination.project.id,
      projectIds: [second.id],
      mapping,
    });
    expect(response.status).toBe(200);
    const payload = await json<{
      moved: Array<{ id: string; parent: { id: string }; priority: number; statusId: string | null; inbox: boolean }>;
      destination: { id: string; title: string };
    }>(response);
    expect(payload.destination.id).toBe(destination.project.id);
    expect(payload.moved).toHaveLength(2);
    const movedById = new Map(payload.moved.map((project) => [project.id, project]));
    expect(movedById.get(first.id)?.parent.id).toBe(destination.project.id);
    expect(movedById.get(second.id)?.parent.id).toBe(destination.project.id);
    expect(movedById.get(first.id)?.statusId).toBe(destinationStatuses[0]!.id);
    expect(movedById.get(second.id)?.statusId).toBe(destinationStatuses[1]!.id);
    expect(movedById.get(first.id)?.inbox).toBe(false);
    expect(movedById.get(second.id)?.inbox).toBe(false);
    // Appended in selection order after the destination's existing children.
    expect(movedById.get(first.id)!.priority).toBeLessThan(movedById.get(second.id)!.priority);
    for (const project of payload.moved) {
      expect(getProjectRow(db, project.id)!.parent_id).toBe(destination.project.id);
      expect(getProjectRow(db, project.id)!.inbox).toBe(0);
    }
  });

  it('rejects project User and application Viewer with 403', async () => {
    const { project: source, statuses } = projectUnderRoot(
      'Bulk permission source',
      ['One', 'Two'],
    );
    const destination = projectUnderRoot('Bulk permission destination', ['Open', 'Closed']);
    grantRole(db, source.id, projectUser.id, 'user');
    grantRole(db, source.id, viewer.id, 'viewer');
    grantRole(db, destination.project.id, projectUser.id, 'user');
    grantRole(db, destination.project.id, viewer.id, 'viewer');
    const child = createProject(db, {
      title: 'Bulk permission child',
      parentId: source.id,
      reporterId: admin.id,
      statusId: statuses[0]!.id,
    });
    const destinationStatuses = getStatuses(db, destination.project.id);
    const mapping = { [statuses[0]!.id]: destinationStatuses[0]!.id };

    signIn(db, projectUser.id);
    const userResponse = await movePost(child.id, {
      destinationId: destination.project.id,
      projectIds: [],
      mapping,
    });
    expect(userResponse.status).toBe(403);

    signIn(db, viewer.id);
    const viewerResponse = await movePost(child.id, {
      destinationId: destination.project.id,
      projectIds: [],
      mapping,
    });
    expect(viewerResponse.status).toBe(403);
    expect(getProjectRow(db, child.id)!.parent_id).toBe(source.id);
  });
});

describe('Trash action grouping', () => {
  it('groups by action with actor/date, keeps independent deadlines and restores only same-action projects', async () => {
    const { project: parent } = projectUnderRoot('Trash grouping parent', ['To do', 'Done']);
    const child = createProject(db, {
      title: 'Trash grouping child',
      parentId: parent.id,
      reporterId: admin.id,
    });
    // The child owns a workflow for the grandchild.
    createWorkflow(db, child.id, { names: ['To do', 'Done'] });
    const grandchild = createProject(db, {
      title: 'Trash grouping grandchild',
      parentId: child.id,
      reporterId: admin.id,
    });
    grantRole(db, child.id, admin.id, 'admin');
    grantRole(db, grandchild.id, admin.id, 'admin');

    // Action 1: child + grandchild. Action 2 (later): parent only; the child is
    // already in Trash and keeps its original action and deadline.
    const childTrash = await trashPost(child.id);
    expect(childTrash.status).toBe(200);
    const childAction = (await json<{ actionId: string }>(childTrash)).actionId;
    const childBefore = getProjectRow(db, child.id)!;

    const parentTrash = await trashPost(parent.id);
    expect(parentTrash.status).toBe(200);
    const parentAction = (await json<{ actionId: string }>(parentTrash)).actionId;
    expect(parentAction).not.toBe(childAction);
    const childAfter = getProjectRow(db, child.id)!;
    expect(childAfter.trash_action_id).toBe(childAction);
    expect(childAfter.purge_deadline).toBe(childBefore.purge_deadline);
    expect(getProjectRow(db, parent.id)!.purge_deadline).not.toBe(childBefore.purge_deadline);

    const trashTab = await searchGet('/api/search?tab=trash');
    expect(trashTab.status).toBe(200);
    const payload = await json<{
      trash: Array<{ id: string; actionId: string; purgeDeadline: string; trashedBy: { username: string } | null; actionCreatedAt: string | null }>;
      trashGroups: Array<{
        actionId: string;
        actor: { username: string } | null;
        actionCreatedAt: string | null;
        separate: boolean;
        lead: { id: string; purgeDeadline: string };
        alsoTrashed: Array<{ id: string }>;
      }>;
    }>(trashTab);

    const parentItem = payload.trash.find((item) => item.id === parent.id);
    const childItem = payload.trash.find((item) => item.id === child.id);
    expect(parentItem?.actionId).toBe(parentAction);
    expect(childItem?.actionId).toBe(childAction);
    expect(parentItem?.trashedBy?.username).toBe('new-admin');
    expect(childItem?.trashedBy?.username).toBe('new-admin');
    expect(childItem?.purgeDeadline).toBe(childBefore.purge_deadline);

    const parentGroup = payload.trashGroups.find((group) => group.actionId === parentAction);
    expect(parentGroup?.lead.id).toBe(parent.id);
    expect(parentGroup?.separate).toBe(true);
    expect(parentGroup?.actor?.username).toBe('new-admin');
    expect(parentGroup?.actionCreatedAt).toBeTruthy();

    const childGroup = payload.trashGroups.find((group) => group.actionId === childAction);
    expect(childGroup?.lead.id).toBe(child.id);
    expect(childGroup?.separate).toBe(false);
    expect(childGroup?.alsoTrashed.map((item) => item.id)).toEqual([grandchild.id]);

    // Restoring the parent action only restores the parent; the separately
    // trashed child keeps its action and deadline.
    const info = await restoreInfo(parent.id);
    expect(info.status).toBe(200);
    const infoPayload = await json<{ candidates: Array<{ projectId: string }> }>(info);
    expect(infoPayload.candidates.map((candidate) => candidate.projectId)).toEqual([parent.id]);

    const restored = await restoreRoute.POST(
      request(`/api/projects/${parent.id}/restore`, { method: 'POST', body: {} }),
      params(parent.id),
    );
    expect(restored.status).toBe(200);
    const restoredPayload = await json<{ restored: string[] }>(restored);
    expect(restoredPayload.restored).toEqual([parent.id]);
    expect(getProjectRow(db, child.id)!.trashed_at).not.toBeNull();
    expect(getProjectRow(db, grandchild.id)!.trash_action_id).toBe(childAction);
  });

  it('bulk trash shares one action and preserves already-trashed deadlines', async () => {
    const { project: owner } = projectUnderRoot('Bulk trash owner', ['To do', 'Done']);
    const previouslyTrashed = createProject(db, {
      title: 'Bulk trash previously trashed',
      parentId: owner.id,
      reporterId: admin.id,
    });
    grantRole(db, previouslyTrashed.id, admin.id, 'admin');
    const firstTrash = await trashPost(previouslyTrashed.id);
    const previousAction = (await json<{ actionId: string }>(firstTrash)).actionId;
    const previousDeadline = getProjectRow(db, previouslyTrashed.id)!.purge_deadline;

    const batchOne = createProject(db, {
      title: 'Bulk trash one',
      parentId: owner.id,
      reporterId: admin.id,
    });
    const batchTwo = createProject(db, {
      title: 'Bulk trash two',
      parentId: owner.id,
      reporterId: admin.id,
    });
    grantRole(db, batchOne.id, admin.id, 'admin');
    grantRole(db, batchTwo.id, admin.id, 'admin');

    const response = await trashPost(batchOne.id, { projectIds: [batchTwo.id] });
    expect(response.status).toBe(200);
    const payload = await json<{ actionId: string; trashed: string[] }>(response);
    expect(payload.trashed).toEqual(expect.arrayContaining([batchOne.id, batchTwo.id]));
    expect(getProjectRow(db, batchOne.id)!.trash_action_id).toBe(payload.actionId);
    expect(getProjectRow(db, batchTwo.id)!.trash_action_id).toBe(payload.actionId);
    expect(getProjectRow(db, batchOne.id)!.purge_deadline).toBe(
      getProjectRow(db, batchTwo.id)!.purge_deadline,
    );
    // Throwing the owner in a later bulk action does not re-stamp the child
    // that was trashed earlier.
    expect(getProjectRow(db, previouslyTrashed.id)!.trash_action_id).toBe(previousAction);
    expect(getProjectRow(db, previouslyTrashed.id)!.purge_deadline).toBe(previousDeadline);
  });
});
