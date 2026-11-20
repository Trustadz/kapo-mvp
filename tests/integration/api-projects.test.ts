import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject as createFixtureProject,
  createUser,
  createWorkflow,
  getStartStatus,
  grantRole,
  getProjectRow,
  type FixtureHousehold,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn, signOut } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';

/**
 * Project/inbox/search API integration (build-spec §7) through the real route
 * handlers, with next/headers mocked against the suite database.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const projectsRoute = await import('@/app/api/projects/route');
const projectRoute = await import('@/app/api/projects/[id]/route');
const reorderRoute = await import('@/app/api/projects/[id]/reorder/route');
const moveRoute = await import('@/app/api/projects/[id]/move/route');
const trashRoute = await import('@/app/api/projects/[id]/trash/route');
const restoreRoute = await import('@/app/api/projects/[id]/restore/route');
const inboxRoute = await import('@/app/api/inbox/route');
const releaseRoute = await import('@/app/api/inbox/[id]/release/route');
const changeParentRoute = await import('@/app/api/inbox/[id]/parent/route');
const reorderInboxRoute = await import('@/app/api/inbox/[id]/reorder/route');
const searchRoute = await import('@/app/api/search/route');

// apiRoute-wrapped handlers take (request, context); these thin wrappers keep
// the call sites readable.
const inboxGet = () => inboxRoute.GET(request('/api/inbox'), EMPTY_CONTEXT);
const searchGet = (url: string) => searchRoute.GET(request(url), EMPTY_CONTEXT);
const capture = (req: Request) => projectsRoute.POST(req, EMPTY_CONTEXT);

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-projects' });
  db = test.db;
  household = await buildHouseholdFixture(db);
});

beforeEach(() => {
  resetRequestContext();
  signIn(db, household.tristan.id);
});

afterAll(() => {
  test.cleanup();
});

describe('authentication and CSRF', () => {
  it('rejects unauthenticated project and inbox reads with 401', async () => {
    signOut();
    for (const response of [
      await inboxGet(),
      await projectRoute.GET(request(`/api/projects/${household.home.id}`), params(household.home.id)),
    ]) {
      expect(response.status).toBe(401);
      const payload = await json<{ error: { code: string } }>(response);
      expect(payload.error.code).toBe('unauthenticated');
    }
  });

  it('rejects cross-origin mutations with 403 CSRF', async () => {
    const response = await capture(
      request('/api/projects', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: { parentId: household.root.id, title: 'Evil' },
      }),
    );
    expect(response.status).toBe(403);
    const payload = await json<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe('csrf_rejected');
  });
});

describe('POST /api/projects (capture)', () => {
  it('creates a Root child with start status and Inbox membership', async () => {
    const response = await capture(
      request('/api/projects', {
        method: 'POST',
        body: { parentId: household.root.id, title: '  Renovate basement  ' },
      }),
    );
    expect(response.status).toBe(201);
    const payload = await json<{
      project: {
        id: string;
        title: string;
        statusName: string | null;
        inbox: boolean;
        parent: { id: string } | null;
        displayId: string;
      };
    }>(response);
    expect(payload.project.title).toBe('Renovate basement');
    expect(payload.project.parent?.id).toBe(household.root.id);
    expect(payload.project.statusName).toBe('To do');
    expect(payload.project.inbox).toBe(true);
    expect(payload.project.displayId).toMatch(/^KAP-\d+$/);

    const inbox = await inboxGet();
    const inboxPayload = await json<{ items: Array<{ project: { id: string } }> }>(inbox);
    expect(inboxPayload.items.map((item) => item.project.id)).toContain(payload.project.id);
  });

  it('validates the title with field errors', async () => {
    const response = await capture(
      request('/api/projects', {
        method: 'POST',
        body: { parentId: household.root.id, title: '   ' },
      }),
    );
    expect(response.status).toBe(422);
    const payload = await json<{ error: { code: string; fields: Record<string, string> } }>(
      response,
    );
    expect(payload.error.code).toBe('validation_failed');
    expect(payload.error.fields.title).toBeTruthy();
  });

  it('rejects malformed JSON and a missing parent with 4xx', async () => {
    const malformed = await capture(
      new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: { host: 'localhost', origin: 'http://localhost' },
        body: '{oops',
      }),
    );
    expect(malformed.status).toBe(400);

    const missingParent = await capture(
      request('/api/projects', { method: 'POST', body: { title: 'No parent' } }),
    );
    expect(missingParent.status).toBe(404);
  });

  it('forbids a Viewer from creating projects', async () => {
    signIn(db, household.alex.id);
    const response = await capture(
      request('/api/projects', {
        method: 'POST',
        body: { parentId: household.root.id, title: 'Viewer project' },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('GET /api/projects/:id', () => {
  it('returns page data for a readable project', async () => {
    const response = await projectRoute.GET(
      request(`/api/projects/${household.home.id}`),
      params(household.home.id),
    );
    expect(response.status).toBe(200);
    const payload = await json<{
      project: { id: string; title: string; canAdmin: boolean; effectiveRole: string };
      children: Array<{ id: string }>;
      statuses: Array<{ name: string }>;
      activity: { events: unknown[] };
    }>(response);
    expect(payload.project.title).toBe('Home improvement');
    expect(payload.project.effectiveRole).toBe('admin');
    expect(payload.project.canAdmin).toBe(true);
    expect(payload.children.map((child) => child.id)).toContain(household.renovate.id);
    expect(payload.statuses.map((status) => status.name)).toEqual([
      'To do',
      'In progress',
      'Done',
    ]);
    expect(Array.isArray(payload.activity.events)).toBe(true);
  });

  it('returns 404 for unknown and unreadable projects', async () => {
    const unknown = await projectRoute.GET(request('/api/projects/nope'), params('nope'));
    expect(unknown.status).toBe(404);

    const outsider = await createUser(db, { username: 'api-outsider' });
    signIn(db, outsider.id);
    const hidden = await projectRoute.GET(
      request(`/api/projects/${household.home.id}`),
      params(household.home.id),
    );
    expect(hidden.status).toBe(404);
  });

  it('exposes archived visibility metadata and a visible fallback', async () => {
    const archiveUser = await createUser(db, {
      username: 'archive-fallback',
      appRole: 'admin',
      showArchived: true,
    });
    const archived = createFixtureProject(db, {
      title: 'Archived parent',
      parentId: household.root.id,
      reporterId: household.tristan.id,
      archived: true,
    });
    grantRole(db, archived.id, archiveUser.id, 'admin');
    createWorkflow(db, archived.id, { names: ['To do', 'Done'] });
    const child = createFixtureProject(db, {
      title: 'Archived child',
      parentId: archived.id,
      reporterId: household.tristan.id,
    });
    grantRole(db, child.id, archiveUser.id, 'admin');
    const active = createFixtureProject(db, {
      title: 'Active fallback',
      parentId: household.root.id,
      reporterId: household.tristan.id,
    });
    grantRole(db, active.id, archiveUser.id, 'admin');

    signIn(db, archiveUser.id);

    const parentResponse = await projectRoute.GET(
      request(`/api/projects/${archived.id}`),
      params(archived.id),
    );
    expect(parentResponse.status).toBe(200);
    const parentPayload = await json<{
      project: { hiddenWhenArchivedOff: boolean; fallbackHref: string };
    }>(parentResponse);
    expect(parentPayload.project.hiddenWhenArchivedOff).toBe(true);
    expect(parentPayload.project.fallbackHref).toBe(`/p/${household.root.id}`);

    const childResponse = await projectRoute.GET(
      request(`/api/projects/${child.id}`),
      params(child.id),
    );
    expect(childResponse.status).toBe(200);
    const childPayload = await json<{
      project: { archived: boolean; hiddenWhenArchivedOff: boolean; fallbackHref: string };
    }>(childResponse);
    expect(childPayload.project.archived).toBe(false);
    expect(childPayload.project.hiddenWhenArchivedOff).toBe(true);
    expect(childPayload.project.fallbackHref).toBe(`/p/${household.root.id}`);

    const activeResponse = await projectRoute.GET(
      request(`/api/projects/${active.id}`),
      params(active.id),
    );
    expect(activeResponse.status).toBe(200);
    const activePayload = await json<{
      project: { hiddenWhenArchivedOff: boolean; fallbackHref: string };
    }>(activeResponse);
    expect(activePayload.project.hiddenWhenArchivedOff).toBe(false);
    expect(activePayload.project.fallbackHref).toBe(`/p/${household.root.id}`);
  });
});

describe('PATCH /api/projects/:id', () => {
  it('renames a project and clears Inbox on a status change', async () => {
    const created = await capture(
      request('/api/projects', {
        method: 'POST',
        body: { parentId: household.home.id, title: 'Patch me' },
      }),
    );
    const createdPayload = await json<{ project: { id: string; inbox: boolean } }>(created);
    const projectId = createdPayload.project.id;
    expect(createdPayload.project.inbox).toBe(true);

    const rename = await projectRoute.PATCH(
      request(`/api/projects/${projectId}`, { method: 'PATCH', body: { title: 'Patched' } }),
      params(projectId),
    );
    expect(rename.status).toBe(200);

    const finish = (
      db
        .prepare('SELECT id FROM statuses WHERE parent_id = ? AND is_finish = 1')
        .get(household.home.id) as { id: string }
    ).id;
    const statusChange = await projectRoute.PATCH(
      request(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: { statusId: finish },
      }),
      params(projectId),
    );
    expect(statusChange.status).toBe(200);
    const payload = await json<{ project: { inbox: boolean; statusName: string } }>(
      statusChange,
    );
    expect(payload.project.inbox).toBe(false);
    expect(payload.project.statusName).toBe('Done');
  });

  it('rejects a Viewer with 403 and an empty patch with 422', async () => {
    signIn(db, household.alex.id);
    const viewer = await projectRoute.PATCH(
      request(`/api/projects/${household.home.id}`, {
        method: 'PATCH',
        body: { title: 'Viewer edit' },
      }),
      params(household.home.id),
    );
    expect(viewer.status).toBe(403);

    signIn(db, household.tristan.id);
    const empty = await projectRoute.PATCH(
      request(`/api/projects/${household.home.id}`, { method: 'PATCH', body: {} }),
      params(household.home.id),
    );
    expect(empty.status).toBe(422);
  });
});

describe('POST /api/projects/:id/reorder', () => {
  it('rewrites sibling priorities and supports status-only column moves', async () => {
    const siblings = db
      .prepare('SELECT id FROM projects WHERE parent_id = ? ORDER BY priority ASC')
      .all(household.home.id) as Array<{ id: string }>;
    const last = siblings.at(-1)!;
    const first = siblings[0]!;

    const reorder = await reorderRoute.POST(
      request(`/api/projects/${last.id}/reorder`, {
        method: 'POST',
        body: { beforeId: first.id },
      }),
      params(last.id),
    );
    expect(reorder.status).toBe(200);
    const firstAfter = db
      .prepare('SELECT id FROM projects WHERE parent_id = ? ORDER BY priority ASC LIMIT 1')
      .get(household.home.id) as { id: string };
    expect(firstAfter.id).toBe(last.id);

    const inProgress = (
      db
        .prepare('SELECT id FROM statuses WHERE parent_id = ? AND is_start = 0 LIMIT 1')
        .get(household.home.id) as { id: string }
    ).id;
    const columnMove = await reorderRoute.POST(
      request(`/api/projects/${last.id}/reorder`, {
        method: 'POST',
        body: { statusId: inProgress },
      }),
      params(last.id),
    );
    expect(columnMove.status).toBe(200);
    const payload = await json<{ project: { statusId: string; inbox: boolean } }>(columnMove);
    expect(payload.project.statusId).toBe(inProgress);
    expect(payload.project.inbox).toBe(false);
  });

  it('rejects a Viewer with 403', async () => {
    signIn(db, household.alex.id);
    const response = await reorderRoute.POST(
      request(`/api/projects/${household.home.id}/reorder`, {
        method: 'POST',
        body: { beforeId: null },
      }),
      params(household.home.id),
    );
    expect(response.status).toBe(403);
  });
});

describe('POST /api/projects/:id/move', () => {
  it('offers destinations, requires mapping and applies the move', async () => {
    // Create a new destination project under Root with its own workflow.
    const destination = createFixtureProject(db, {
      title: 'Destination',
      parentId: household.root.id,
      reporterId: household.tristan.id,
    });
    grantRole(db, destination.id, household.tristan.id, 'admin');
    const destinationStatuses = createWorkflow(db, destination.id, { names: ['Open', 'Closed'] });

    const info = await moveRoute.GET(
      request(`/api/projects/${household.renovate.id}/move`),
      params(household.renovate.id),
    );
    expect(info.status).toBe(200);
    const infoPayload = await json<{
      destinations: Array<{ id: string; title: string; statuses: Array<{ id: string }> }>;
    }>(info);
    expect(infoPayload.destinations.map((entry) => entry.id)).toContain(destination.id);

    const missingMapping = await moveRoute.POST(
      request(`/api/projects/${household.renovate.id}/move`, {
        method: 'POST',
        body: { destinationId: destination.id, mapping: {} },
      }),
      params(household.renovate.id),
    );
    expect(missingMapping.status).toBe(422);
    const missingPayload = await json<{ error: { code: string } }>(missingMapping);
    expect(missingPayload.error.code).toBe('mapping_required');

    const oldStatus = getProjectRow(db, household.renovate.id)!.status_id!;
    const moved = await moveRoute.POST(
      request(`/api/projects/${household.renovate.id}/move`, {
        method: 'POST',
        body: {
          destinationId: destination.id,
          mapping: { [oldStatus]: destinationStatuses[1]!.id },
        },
      }),
      params(household.renovate.id),
    );
    expect(moved.status).toBe(200);
    const movedPayload = await json<{
      project: { parent: { id: string }; statusId: string };
    }>(moved);
    expect(movedPayload.project.parent.id).toBe(destination.id);
    expect(movedPayload.project.statusId).toBe(destinationStatuses[1]!.id);
  });

  it('rejects cycles with 422', async () => {
    const parent = createFixtureProject(db, {
      title: 'Cycle owner',
      parentId: household.root.id,
      reporterId: household.tristan.id,
    });
    grantRole(db, parent.id, household.tristan.id, 'admin');
    createWorkflow(db, parent.id, { names: ['One', 'Two'] });
    const child = createFixtureProject(db, {
      title: 'Cycle child',
      parentId: parent.id,
      reporterId: household.tristan.id,
    });
    const response = await moveRoute.POST(
      request(`/api/projects/${parent.id}/move`, {
        method: 'POST',
        body: { destinationId: child.id, mapping: {} },
      }),
      params(parent.id),
    );
    expect(response.status).toBe(422);
  });
});

describe('trash and restore API', () => {
  it('trashes, lists in the Trash tab, restores and reindexes search', async () => {
    const created = await capture(
      request('/api/projects', {
        method: 'POST',
        body: { parentId: household.home.id, title: 'Trash me now' },
      }),
    );
    const projectId = (await json<{ project: { id: string } }>(created)).project.id;

    const trashed = await trashRoute.POST(
      request(`/api/projects/${projectId}/trash`, { method: 'POST', body: {} }),
      params(projectId),
    );
    expect(trashed.status).toBe(200);
    const trashPayload = await json<{ actionId: string; trashed: string[] }>(trashed);
    expect(trashPayload.actionId).toBeTruthy();
    expect(trashPayload.trashed).toContain(projectId);

    // Ordinary search never includes trashed projects.
    const ordinary = await searchGet('/api/search?q=Trash');
    const ordinaryPayload = await json<{ results: Array<{ id: string }> }>(ordinary);
    expect(ordinaryPayload.results.map((row) => row.id)).not.toContain(projectId);

    const trashTab = await searchGet('/api/search?tab=trash&q=Trash');
    const trashTabPayload = await json<{ trash: Array<{ id: string }> }>(trashTab);
    expect(trashTabPayload.trash.map((row) => row.id)).toContain(projectId);

    const restoreInfo = await restoreRoute.GET(
      request(`/api/projects/${projectId}/restore`),
      params(projectId),
    );
    expect(restoreInfo.status).toBe(200);
    const restoreInfoPayload = await json<{ project: { id: string; actionId: string } }>(
      restoreInfo,
    );
    expect(restoreInfoPayload.project.actionId).toBe(trashPayload.actionId);

    const restored = await restoreRoute.POST(
      request(`/api/projects/${projectId}/restore`, { method: 'POST', body: {} }),
      params(projectId),
    );
    expect(restored.status).toBe(200);
    const restoredPayload = await json<{ restored: string[] }>(restored);
    expect(restoredPayload.restored).toContain(projectId);

    const row = getProjectRow(db, projectId)!;
    expect(row.trashed_at).toBeNull();
    expect(row.purge_deadline).toBeNull();
    const searchRow = db
      .prepare('SELECT COUNT(*) AS count FROM project_search WHERE project_id = ?')
      .get(projectId) as { count: number };
    expect(searchRow.count).toBe(1);
  });

  it('requires a project Admin and rejects already-trashed projects', async () => {
    const target = createFixtureProject(db, {
      title: 'Trash target',
      parentId: household.home.id,
      reporterId: household.tristan.id,
    });
    grantRole(db, target.id, household.alex.id, 'viewer');
    signIn(db, household.alex.id);
    const viewerTrash = await trashRoute.POST(
      request(`/api/projects/${target.id}/trash`, { method: 'POST', body: {} }),
      params(target.id),
    );
    expect(viewerTrash.status).toBe(403);

    signIn(db, household.tristan.id);
    const first = await trashRoute.POST(
      request(`/api/projects/${target.id}/trash`, { method: 'POST', body: {} }),
      params(target.id),
    );
    expect(first.status).toBe(200);
    const second = await trashRoute.POST(
      request(`/api/projects/${target.id}/trash`, { method: 'POST', body: {} }),
      params(target.id),
    );
    expect(second.status).toBe(409);
  });
});

describe('GET /api/inbox and release', () => {
  it('lists only readable Inbox projects and releases without changing status', async () => {
    const captured = await capture(
      request('/api/projects', {
        method: 'POST',
        body: { parentId: household.home.id, title: 'Release me' },
      }),
    );
    const project = (await json<{ project: { id: string; statusId: string } }>(captured)).project;

    const inbox = await inboxGet();
    const inboxPayload = await json<{
      items: Array<{ project: { id: string }; parentTitle: string | null; startStatusName: string | null }>;
    }>(inbox);
    const item = inboxPayload.items.find((entry) => entry.project.id === project.id);
    expect(item).toBeDefined();
    expect(item?.parentTitle).toBe('Home improvement');
    expect(item?.startStatusName).toBe('To do');

    const released = await releaseRoute.POST(
      request(`/api/inbox/${project.id}/release`, { method: 'POST', body: {} }),
      params(project.id),
    );
    expect(released.status).toBe(200);
    const releasedPayload = await json<{ project: { inbox: boolean; statusId: string } }>(
      released,
    );
    expect(releasedPayload.project.inbox).toBe(false);
    expect(releasedPayload.project.statusId).toBe(project.statusId);
  });

  it('returns the application-wide tree with Inbox rows and no inaccessible parents', async () => {
    signIn(db, household.tristan.id);
    // Earlier tests in this file mutate the shared fixture, so assert the tree
    // against a capture created here rather than a fixed seed row.
    const captured = await capture(
      request('/api/projects', {
        method: 'POST',
        body: { parentId: household.home.id, title: 'Tree capture' },
      }),
    );
    const capturedProject = (
      await json<{ project: { id: string } }>(captured)
    ).project;

    const payload = await json<{
      tree: Array<{
        id: string;
        title: string;
        parentId: string | null;
        statusName: string | null;
        inbox: boolean;
        archived: boolean;
        canEdit: boolean;
        canAdmin: boolean;
        priority: number;
      }>;
    }>(await inboxGet());
    const byId = new Map(payload.tree.map((node) => [node.id, node]));
    expect(byId.get(household.root.id)?.parentId).toBeNull();
    expect(byId.get(household.home.id)?.parentId).toBe(household.root.id);
    expect(byId.get(capturedProject.id)).toMatchObject({
      parentId: household.home.id,
      inbox: true,
      canEdit: true,
      canAdmin: true,
    });
    const priorities = payload.tree.map((node) => node.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));

    // Maya can read a capture she was granted directly, but Personal is Custom
    // and private from her: the capture must surface at the top level and the
    // parent title must not leak through the tree payload.
    const directCapture = createFixtureProject(db, {
      title: 'Maya direct capture',
      parentId: household.personal.id,
      reporterId: household.tristan.id,
      inbox: true,
    });
    grantRole(db, directCapture.id, household.maya.id, 'user');
    signIn(db, household.maya.id);
    const mayaPayload = await json<{
      tree: Array<{ id: string; title: string; parentId: string | null }>;
    }>(await inboxGet());
    const directNode = mayaPayload.tree.find((node) => node.id === directCapture.id);
    expect(directNode).toBeDefined();
    expect(directNode?.parentId).toBeNull();
    expect(mayaPayload.tree.some((node) => node.title === 'Personal')).toBe(false);
  });

  it('does not leak Inbox items to users without access', async () => {
    const outsider = await createUser(db, { username: 'inbox-outsider' });
    signIn(db, outsider.id);
    const inbox = await inboxGet();
    const payload = await json<{ items: unknown[] }>(inbox);
    expect(payload.items).toEqual([]);
  });

  it('forbids Viewer release and returns 404 for missing projects', async () => {
    signIn(db, household.alex.id);
    const forbidden = await releaseRoute.POST(
      request(`/api/inbox/${household.renovate.id}/release`, { method: 'POST', body: {} }),
      params(household.renovate.id),
    );
    expect(forbidden.status).toBe(403);

    signIn(db, household.tristan.id);
    const missing = await releaseRoute.POST(
      request('/api/inbox/nope/release', { method: 'POST', body: {} }),
      params('nope'),
    );
    expect(missing.status).toBe(404);
  });
});

describe('POST /api/inbox/:id/reorder', () => {
  async function captureInHome(title: string) {
    const response = await capture(
      request('/api/projects', {
        method: 'POST',
        body: { parentId: household.home.id, title },
      }),
    );
    expect(response.status).toBe(201);
    return (
      await json<{ project: { id: string; statusId: string; inbox: boolean } }>(response)
    ).project;
  }

  function reorder(projectId: string, body: Record<string, unknown>) {
    return reorderInboxRoute.POST(
      request(`/api/inbox/${projectId}/reorder`, { method: 'POST', body }),
      params(projectId),
    );
  }

  async function inboxIndex(projectId: string): Promise<number> {
    const payload = await json<{ items: Array<{ project: { id: string } }> }>(await inboxGet());
    return payload.items.findIndex((item) => item.project.id === projectId);
  }

  it('reorders before and after in the global sequence and keeps the capture in the Inbox', async () => {
    const first = await captureInHome(`Reorder A ${Date.now()}`);
    const second = await captureInHome(`Reorder B ${Date.now()}`);
    const third = await captureInHome(`Reorder C ${Date.now()}`);

    expect(await inboxIndex(first.id)).toBeLessThan(await inboxIndex(second.id));
    expect(await inboxIndex(second.id)).toBeLessThan(await inboxIndex(third.id));

    const movedAfter = await reorder(first.id, { targetId: third.id, edge: 'after' });
    expect(movedAfter.status).toBe(200);
    const afterPayload = await json<{
      project: { inbox: boolean; statusId: string };
    }>(movedAfter);
    expect(afterPayload.project.inbox).toBe(true);
    expect(afterPayload.project.statusId).toBe(first.statusId);
    expect(await inboxIndex(third.id)).toBeLessThan(await inboxIndex(first.id));
    expect(getProjectRow(db, first.id)!.priority).toBeGreaterThan(
      getProjectRow(db, third.id)!.priority,
    );

    const movedBefore = await reorder(first.id, { targetId: second.id, edge: 'before' });
    expect(movedBefore.status).toBe(200);
    expect(await inboxIndex(first.id)).toBeLessThan(await inboxIndex(second.id));
    expect(getProjectRow(db, first.id)!.priority).toBeLessThan(
      getProjectRow(db, second.id)!.priority,
    );
    // The capture stayed in the Inbox and kept its status.
    expect(getProjectRow(db, first.id)!.inbox).toBe(1);
    expect(getProjectRow(db, first.id)!.status_id).toBe(first.statusId);
  });

  it('validates permissions, Inbox membership, trash, self and missing targets', async () => {
    const project = await captureInHome(`Reorder validation ${Date.now()}`);

    const self = await reorder(project.id, { targetId: project.id, edge: 'before' });
    expect(self.status).toBe(422);
    expect((await json<{ error: { code: string } }>(self)).error.code).toBe('validation_failed');

    const missing = await reorder(project.id, { targetId: 'missing-project', edge: 'after' });
    expect(missing.status).toBe(404);

    const noEdge = await reorder(project.id, { targetId: household.home.id });
    expect(noEdge.status).toBe(422);

    // Only Inbox members can use this endpoint (Find contractor is not Inbox).
    const nonInbox = await reorder(household.contractor.id, {
      targetId: project.id,
      edge: 'before',
    });
    expect(nonInbox.status).toBe(422);

    // A Viewer is read-only even when a project grant would allow editing.
    signIn(db, household.alex.id);
    const forbidden = await reorder(project.id, { targetId: household.home.id, edge: 'before' });
    expect(forbidden.status).toBe(403);

    // A trashed target is not a valid drop position.
    signIn(db, household.tristan.id);
    const trashedTarget = createFixtureProject(db, {
      title: `Trashed reorder target ${Date.now()}`,
      parentId: household.home.id,
      reporterId: household.tristan.id,
      inbox: false,
      trashedAt: new Date().toISOString(),
    });
    const trashed = await reorder(project.id, {
      targetId: trashedTarget.id,
      edge: 'before',
    });
    expect(trashed.status).toBe(409);

    // Failed calls never changed the capture's Inbox membership.
    expect(getProjectRow(db, project.id)!.inbox).toBe(1);
  });
});

describe('POST /api/inbox/:id/parent', () => {
  async function captureUnder(title: string, parentId: string) {
    const response = await capture(
      request('/api/projects', { method: 'POST', body: { parentId, title } }),
    );
    expect(response.status).toBe(201);
    return (
      await json<{ project: { id: string; statusId: string; inbox: boolean } }>(response)
    ).project;
  }

  function changeParent(projectId: string, body: Record<string, unknown>) {
    return changeParentRoute.POST(
      request(`/api/inbox/${projectId}/parent`, { method: 'POST', body }),
      params(projectId),
    );
  }

  it('reparents an Inbox capture, keeps it in the Inbox and applies the new Start status', async () => {
    const project = await captureUnder('Misfiled capture', household.home.id);
    const personalStart = getStartStatus(db, household.personal.id);

    const response = await changeParent(project.id, {
      destinationId: household.personal.id,
    });
    expect(response.status).toBe(200);
    const payload = await json<{
      project: {
        id: string;
        inbox: boolean;
        statusId: string | null;
        statusName: string | null;
        parent: { id: string; title: string } | null;
      };
    }>(response);
    expect(payload.project.inbox).toBe(true);
    expect(payload.project.statusId).toBe(personalStart.id);
    expect(payload.project.statusName).toBe(personalStart.name);
    expect(payload.project.parent).toEqual({
      id: household.personal.id,
      title: 'Personal',
    });

    // The Inbox still lists it, now under the new parent.
    const inbox = await json<{
      items: Array<{
        project: { id: string };
        parentTitle: string | null;
        startStatusName: string | null;
      }>;
    }>(await inboxGet());
    const item = inbox.items.find((entry) => entry.project.id === project.id);
    expect(item).toBeDefined();
    expect(item?.parentTitle).toBe('Personal');
    expect(item?.startStatusName).toBe(personalStart.name);

    const row = getProjectRow(db, project.id)!;
    expect(row.parent_id).toBe(household.personal.id);
    expect(row.status_id).toBe(personalStart.id);
    expect(row.inbox).toBe(1);
  });

  it('rejects same-parent, forbidden and missing destinations with the standard envelope', async () => {
    const project = await captureUnder('Parent validation', household.home.id);

    const same = await changeParent(project.id, { destinationId: household.home.id });
    expect(same.status).toBe(422);
    const samePayload = await json<{
      error: { code: string; message: string; fields?: Record<string, string> };
    }>(same);
    expect(samePayload.error.code).toBe('validation_failed');
    expect(samePayload.error.message).toMatch(/already under/i);
    expect(samePayload.error.fields?.destinationId).toBeDefined();

    const missing = await changeParent(project.id, { destinationId: 'missing-project' });
    expect(missing.status).toBe(404);

    const invalid = await changeParent(project.id, {});
    expect(invalid.status).toBe(422);

    // Viewer on the capture cannot reparent it.
    signIn(db, household.alex.id);
    const forbidden = await changeParent(project.id, {
      destinationId: household.personal.id,
    });
    expect(forbidden.status).toBe(403);

    // The capture is still under its original parent and in the Inbox.
    signIn(db, household.tristan.id);
    const row = getProjectRow(db, project.id)!;
    expect(row.parent_id).toBe(household.home.id);
    expect(row.inbox).toBe(1);
  });

  it('rejects captures that already left the Inbox', async () => {
    const project = await captureUnder('Released capture', household.home.id);
    const released = await releaseRoute.POST(
      request(`/api/inbox/${project.id}/release`, { method: 'POST', body: {} }),
      params(project.id),
    );
    expect(released.status).toBe(200);

    const response = await changeParent(project.id, {
      destinationId: household.personal.id,
    });
    expect(response.status).toBe(422);
    const payload = await json<{ error: { message: string } }>(response);
    expect(payload.error.message).toMatch(/Inbox/i);
  });
});

describe('GET /api/search', () => {
  it('finds projects by title and prefix, permission filtered', async () => {
    const response = await searchGet('/api/search?q=paint');
    expect(response.status).toBe(200);
    const payload = await json<{
      query: string;
      results: Array<{ id: string; title: string; parentTitle: string | null }>;
    }>(response);
    expect(payload.query).toBe('paint');
    const titles = payload.results.map((row) => row.title);
    expect(titles).toContain('Paint hallway');
    // tristan has no grant on Household, so Paint porch stays hidden.
    expect(titles).not.toContain('Paint porch');

    // maya inherits Root's user grant, so she sees both matches.
    signIn(db, household.maya.id);
    const mayaResponse = await searchGet('/api/search?q=paint');
    const mayaPayload = await json<{ results: Array<{ title: string }> }>(mayaResponse);
    expect(mayaPayload.results.map((row) => row.title)).toEqual(
      expect.arrayContaining(['Paint hallway', 'Paint porch']),
    );
    signIn(db, household.tristan.id);

    const prefix = await searchGet('/api/search?q=renov');
    const prefixPayload = await json<{ results: Array<{ title: string }> }>(prefix);
    expect(prefixPayload.results.map((row) => row.title)).toContain('Renovate basement');

    const outsider = await createUser(db, { username: 'search-outsider' });
    signIn(db, outsider.id);
    const restricted = await searchGet('/api/search?q=paint');
    const restrictedPayload = await json<{ results: unknown[] }>(restricted);
    expect(restrictedPayload.results).toEqual([]);
  });

  it('returns no results for an empty or punctuation-only query without throwing', async () => {
    for (const query of ['', '%20%20', '%22%22']) {
      const response = await searchGet(`/api/search?q=${query}`);
      expect(response.status).toBe(200);
      const payload = await json<{ results: unknown[] }>(response);
      expect(payload.results).toEqual([]);
    }
  });

  it('rejects unauthenticated search with 401', async () => {
    signOut();
    const response = await searchGet('/api/search?q=paint');
    expect(response.status).toBe(401);
  });
});
