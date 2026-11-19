import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject,
  createUser,
  createWorkflow,
  grantRole,
  type FixtureHousehold,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';

/**
 * Project admin surface (build-spec §7): favorites, Activity pagination,
 * layout/view settings, workflow editing and the Viewer write-protection
 * matrix.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const projectRoute = await import('@/app/api/projects/[id]/route');
const favoriteRoute = await import('@/app/api/projects/[id]/favorite/route');
const activityRoute = await import('@/app/api/projects/[id]/activity/route');
const settingsRoute = await import('@/app/api/projects/[id]/settings/route');
const workflowRoute = await import('@/app/api/projects/[id]/workflow/route');
const reorderRoute = await import('@/app/api/projects/[id]/reorder/route');
const moveRoute = await import('@/app/api/projects/[id]/move/route');
const trashRoute = await import('@/app/api/projects/[id]/trash/route');
const membersRoute = await import('@/app/api/projects/[id]/members/route');
const projectsRoute = await import('@/app/api/projects/route');
const capture = (req: Request) => projectsRoute.POST(req, EMPTY_CONTEXT);

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-project-admin' });
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

describe('Viewer write protection matrix', () => {
  it('returns 403 for every project mutation while allowing reads and favorites', async () => {
    signIn(db, household.alex.id);
    const homeId = household.home.id;

    const attempts = [
      await projectRoute.PATCH(
        request(`/api/projects/${homeId}`, { method: 'PATCH', body: { title: 'Viewer rename' } }),
        params(homeId),
      ),
      await reorderRoute.POST(
        request(`/api/projects/${homeId}/reorder`, { method: 'POST', body: { beforeId: null } }),
        params(homeId),
      ),
      await moveRoute.POST(
        request(`/api/projects/${homeId}/move`, {
          method: 'POST',
          body: { destinationId: household.root.id, mapping: {} },
        }),
        params(homeId),
      ),
      await trashRoute.POST(
        request(`/api/projects/${homeId}/trash`, { method: 'POST', body: {} }),
        params(homeId),
      ),
      await membersRoute.PUT(
        request(`/api/projects/${homeId}/members`, {
          method: 'PUT',
          body: { changes: [{ userId: household.alex.id, role: 'admin' }], acknowledged: true },
        }),
        params(homeId),
      ),
      await workflowRoute.PUT(
        request(`/api/projects/${homeId}/workflow`, {
          method: 'PUT',
          body: { statuses: [{ name: 'Only', isStart: true, isFinish: true }] },
        }),
        params(homeId),
      ),
      await settingsRoute.PUT(
        request(`/api/projects/${homeId}/settings`, {
          method: 'PUT',
          body: { skip_inbox: true },
        }),
        params(homeId),
      ),
      await capture(
        request('/api/projects', {
          method: 'POST',
          body: { parentId: homeId, title: 'Viewer capture' },
        }),
      ),
    ];
    for (const response of attempts) expect(response.status).toBe(403);

    // Read-only endpoints remain available.
    const page = await projectRoute.GET(request(`/api/projects/${homeId}`), params(homeId));
    expect(page.status).toBe(200);
    const activity = await activityRoute.GET(
      request(`/api/projects/${homeId}/activity`),
      params(homeId),
    );
    expect(activity.status).toBe(200);
    const workflow = await workflowRoute.GET(
      request(`/api/projects/${homeId}/workflow`),
      params(homeId),
    );
    expect(workflow.status).toBe(200);

    // Favorites are a personal preference, not project data.
    const favorite = await favoriteRoute.POST(
      request(`/api/projects/${homeId}/favorite`, { method: 'POST', body: { favorite: true } }),
      params(homeId),
    );
    expect(favorite.status).toBe(200);
    expect(await json<{ favorite: boolean }>(favorite)).toEqual({ favorite: true });
  });
});

describe('POST /api/projects/:id/favorite', () => {
  it('toggles the favorite flag', async () => {
    const first = await favoriteRoute.POST(
      request(`/api/projects/${household.home.id}/favorite`, { method: 'POST', body: {} }),
      params(household.home.id),
    );
    expect(first.status).toBe(200);
    const current = await json<{ favorite: boolean }>(first);
    const second = await favoriteRoute.POST(
      request(`/api/projects/${household.home.id}/favorite`, { method: 'POST', body: {} }),
      params(household.home.id),
    );
    expect(await json<{ favorite: boolean }>(second)).toEqual({ favorite: !current.favorite });

    const hidden = await favoriteRoute.POST(
      request('/api/projects/nope/favorite', { method: 'POST', body: {} }),
      params('nope'),
    );
    expect(hidden.status).toBe(404);
  });
});

describe('GET /api/projects/:id/activity', () => {
  it('returns newest-first events with previous/new values and a cursor', async () => {
    const project = createProject(db, {
      title: 'Activity project',
      parentId: household.home.id,
      reporterId: household.tristan.id,
    });
    for (let index = 0; index < 3; index += 1) {
      await projectRoute.PATCH(
        request(`/api/projects/${project.id}`, {
          method: 'PATCH',
          body: { title: `Activity project v${index}` },
        }),
        params(project.id),
      );
    }

    const first = await activityRoute.GET(
      request(`/api/projects/${project.id}/activity?limit=2`),
      params(project.id),
    );
    expect(first.status).toBe(200);
    const firstPage = await json<{
      events: Array<{ action: string; field: string | null; oldValue: string | null; newValue: string | null }>;
      nextCursor: string | null;
    }>(first);
    expect(firstPage.events.length).toBe(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const rename = firstPage.events.find((event) => event.action === 'project.renamed');
    expect(rename).toBeDefined();
    expect(rename?.field).toBe('title');
    expect(typeof rename?.oldValue).toBe('string');
    expect(typeof rename?.newValue).toBe('string');

    const second = await activityRoute.GET(
      request(
        `/api/projects/${project.id}/activity?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      ),
      params(project.id),
    );
    const secondPage = await json<{ events: Array<{ id: string }>; nextCursor: string | null }>(
      second,
    );
    const firstIds = new Set(firstPage.events.map((event) => (event as { id?: string }).id));
    for (const event of secondPage.events) expect(firstIds.has(event.id)).toBe(false);
  });

  it('hides activity for unreadable projects', async () => {
    const outsider = await createProject(db, {
      title: 'Activity hidden',
      parentId: household.root.id,
      reporterId: household.tristan.id,
    });
    const noAccess = await createUser(db, { username: 'activity-outsider' });
    signIn(db, noAccess.id);
    const response = await activityRoute.GET(
      request(`/api/projects/${outsider.id}/activity`),
      params(outsider.id),
    );
    expect(response.status).toBe(404);
  });
});

describe('GET/PUT /api/projects/:id/settings', () => {
  it('updates layout and view settings for a project Admin', async () => {
    const project = createProject(db, {
      title: 'Settings project',
      parentId: household.root.id,
      reporterId: household.tristan.id,
    });
    createWorkflow(db, project.id, { names: ['To do', 'Done'] });
    grantRole(db, project.id, household.tristan.id, 'admin');
    const workflow = await workflowRoute.GET(
      request(`/api/projects/${project.id}/workflow`),
      params(project.id),
    );
    const workflowPayload = await json<{ statuses: Array<{ id: string; name: string }> }>(workflow);

    const updated = await settingsRoute.PUT(
      request(`/api/projects/${project.id}/settings`, {
        method: 'PUT',
        body: {
          child_position: 'above',
          enabled_views: ['list', 'tree'],
          default_view: 'list',
          skip_inbox: true,
          hidden_statuses: [workflowPayload.statuses[1]!.id],
        },
      }),
      params(project.id),
    );
    expect(updated.status).toBe(200);
    const payload = await json<{
      settings: {
        child_position: string;
        enabled_views: string[];
        default_view: string;
        skip_inbox: boolean;
        hidden_statuses: string[];
      };
    }>(updated);
    expect(payload.settings.child_position).toBe('above');
    expect(payload.settings.enabled_views).toEqual(['list', 'tree']);
    expect(payload.settings.default_view).toBe('list');
    expect(payload.settings.skip_inbox).toBe(true);
    expect(payload.settings.hidden_statuses).toEqual([workflowPayload.statuses[1]!.id]);

    const read = await settingsRoute.GET(
      request(`/api/projects/${project.id}/settings`),
      params(project.id),
    );
    expect((await json<{ settings: { default_view: string } }>(read)).settings.default_view).toBe(
      'list',
    );
  });

  it('validates settings server-side', async () => {
    const project = createProject(db, {
      title: 'Invalid settings project',
      parentId: household.root.id,
      reporterId: household.tristan.id,
    });
    createWorkflow(db, project.id, { names: ['To do', 'Done'] });
    grantRole(db, project.id, household.tristan.id, 'admin');

    for (const body of [
      { enabled_views: [] },
      { enabled_views: ['gantt'] },
      { default_view: 'gantt' },
      { hidden_statuses: ['not-a-status'] },
      { child_position: 'middle' },
    ]) {
      const response = await settingsRoute.PUT(
        request(`/api/projects/${project.id}/settings`, { method: 'PUT', body }),
        params(project.id),
      );
      expect(response.status).toBe(422);
      const payload = await json<{ error: { code: string; fields: Record<string, string> } }>(
        response,
      );
      expect(payload.error.code).toBe('validation_failed');
      expect(Object.keys(payload.error.fields).length).toBeGreaterThan(0);
    }
  });
});

describe('GET/PUT /api/projects/:id/workflow', () => {
  it('requires remapping for removed in-use statuses, then remaps children', async () => {
    const project = createProject(db, {
      title: 'Workflow API project',
      parentId: household.root.id,
      reporterId: household.tristan.id,
    });
    const statuses = createWorkflow(db, project.id, { names: ['To do', 'Doing', 'Done'] });
    grantRole(db, project.id, household.tristan.id, 'admin');
    const child = createProject(db, {
      title: 'Workflow API child',
      parentId: project.id,
      reporterId: household.tristan.id,
      statusId: statuses[1]!.id,
    });
    grantRole(db, child.id, household.tristan.id, 'admin');

    const withoutMapping = await workflowRoute.PUT(
      request(`/api/projects/${project.id}/workflow`, {
        method: 'PUT',
        body: {
          statuses: [
            { id: statuses[0]!.id, name: 'To do', isStart: true },
            { id: statuses[2]!.id, name: 'Done', isFinish: true },
          ],
        },
      }),
      params(project.id),
    );
    expect(withoutMapping.status).toBe(422);
    const missingPayload = await json<{ error: { code: string } }>(withoutMapping);
    expect(missingPayload.error.code).toBe('mapping_required');

    const mapped = await workflowRoute.PUT(
      request(`/api/projects/${project.id}/workflow`, {
        method: 'PUT',
        body: {
          statuses: [
            { id: statuses[0]!.id, name: 'To do', isStart: true },
            { id: statuses[2]!.id, name: 'Done', isFinish: true },
          ],
          mapping: { [statuses[1]!.id]: statuses[2]!.id },
        },
      }),
      params(project.id),
    );
    expect(mapped.status).toBe(200);
    const row = db.prepare('SELECT status_id FROM projects WHERE id = ?').get(child.id) as {
      status_id: string;
    };
    expect(row.status_id).toBe(statuses[2]!.id);
  });
});
