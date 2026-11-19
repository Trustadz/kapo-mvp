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
 * Dashboard payloads and project membership API (build-spec §6 rules 2–3, §7;
 * dashboard.md). Widget content/counts are permission filtered and membership
 * changes enforce cascade acknowledgement and the last-Admin invariant.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const dashboardRoute = await import('@/app/api/dashboard/route');
const membersRoute = await import('@/app/api/projects/[id]/members/route');
const meRoute = await import('@/app/api/me/route');
const dashboardGet = (req: Request) => dashboardRoute.GET(req, EMPTY_CONTEXT);
const mePatch = (req: Request) => meRoute.PATCH(req, EMPTY_CONTEXT);

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-dashboard-members' });
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

describe('GET /api/dashboard', () => {
  it('requires authentication', async () => {
    resetRequestContext();
    const response = await dashboardGet(request('/api/dashboard'));
    expect(response.status).toBe(401);
  });

  it('returns the registered widgets in preference order', async () => {
    const response = await dashboardGet(request('/api/dashboard'));
    expect(response.status).toBe(200);
    const payload = await json<{
      widgets: Array<{ id: string; widget: { id: string } }>;
    }>(response);
    expect(payload.widgets.map((entry) => entry.id)).toEqual(['inbox', 'recent']);
    // "Completed last week" is not registered (build-spec §1).
    expect(JSON.stringify(payload)).not.toContain('completed');
  });

  it('permission-filters widget contents and totals', async () => {
    const outsider = await createUser(db, { username: 'dash-outsider' });
    signIn(db, outsider.id);
    const response = await dashboardGet(request('/api/dashboard?widget=inbox'));
    expect(response.status).toBe(200);
    const payload = await json<{ widget: { total: number; items: unknown[] } }>(response);
    expect(payload.widget.total).toBe(0);
    expect(payload.widget.items).toEqual([]);

    signIn(db, household.tristan.id);
    const admin = await dashboardGet(request('/api/dashboard?widget=inbox'));
    const adminPayload = await json<{ widget: { total: number; items: unknown[]; openHref: string } }>(
      admin,
    );
    expect(adminPayload.widget.openHref).toBe('/inbox');
    // The seeded inbox items under accessible projects are counted.
    expect(adminPayload.widget.total).toBeGreaterThan(0);
  });

  it('honours the saved widget visibility preferences', async () => {
    const hidden = await mePatch(
      request('/api/me', {
        method: 'PATCH',
        body: {
          dashboard: [
            { id: 'recent', visible: true },
            { id: 'inbox', visible: false },
          ],
        },
      }),
    );
    expect(hidden.status).toBe(200);
    const response = await dashboardGet(request('/api/dashboard'));
    const payload = await json<{ widgets: Array<{ id: string }> }>(response);
    expect(payload.widgets.map((entry) => entry.id)).toEqual(['recent']);

    // Restore defaults for the rest of the suite.
    await mePatch(
      request('/api/me', {
        method: 'PATCH',
        body: {
          dashboard: [
            { id: 'inbox', visible: true },
            { id: 'recent', visible: true },
          ],
        },
      }),
    );
  });

  it('rejects unknown widgets with 404 and lists recent changes for readable projects', async () => {
    const unknown = await dashboardGet(request('/api/dashboard?widget=completed-last-week'));
    expect(unknown.status).toBe(404);
    const payload = await json<{ error: { code: string } }>(unknown);
    expect(payload.error.code).toBe('widget_not_found');

    const recent = await dashboardGet(request('/api/dashboard?widget=recent'));
    expect(recent.status).toBe(200);
    const recentPayload = await json<{ widget: { items: Array<{ projectId: string }> } }>(recent);
    expect(recentPayload.widget.items.length).toBeLessThanOrEqual(5);
  });
});

describe('GET/PUT /api/projects/:id/members', () => {
  it('rejects non-Admin members reads and writes', async () => {
    signIn(db, household.maya.id);
    const read = await membersRoute.GET(request(`/api/projects/${household.home.id}/members`), params(household.home.id));
    expect(read.status).toBe(403);
    const write = await membersRoute.PUT(
      request(`/api/projects/${household.home.id}/members`, {
        method: 'PUT',
        body: { changes: [{ userId: household.maya.id, role: 'viewer' }], acknowledged: true },
      }),
      params(household.home.id),
    );
    expect(write.status).toBe(403);
  });

  it('returns explicit members with cascade impact', async () => {
    signIn(db, household.tristan.id);
    const response = await membersRoute.GET(
      request(`/api/projects/${household.home.id}/members`),
      params(household.home.id),
    );
    expect(response.status).toBe(200);
    const payload = await json<{
      members: Array<{ username: string; role: string }>;
      canManage: boolean;
      cascadeImpact: number;
    }>(response);
    const roles = Object.fromEntries(payload.members.map((member) => [member.username, member.role]));
    expect(roles.tristan).toBe('admin');
    expect(roles.maya).toBe('user');
    expect(payload.canManage).toBe(true);
    expect(payload.cascadeImpact).toEqual(expect.any(Number));
  });

  it('requires acknowledgement, then cascades a reduction', async () => {
    signIn(db, household.tristan.id);
    const unacknowledged = await membersRoute.PUT(
      request(`/api/projects/${household.home.id}/members`, {
        method: 'PUT',
        body: { changes: [{ userId: household.maya.id, role: 'viewer' }] },
      }),
      params(household.home.id),
    );
    expect(unacknowledged.status).toBe(409);
    const unacknowledgedPayload = await json<{ error: { code: string } }>(unacknowledged);
    expect(unacknowledgedPayload.error.code).toBe('acknowledgement_required');

    // maya has an explicit admin grant on Renovate basement, so the reduction
    // cascades there.
    const applied = await membersRoute.PUT(
      request(`/api/projects/${household.home.id}/members`, {
        method: 'PUT',
        body: {
          changes: [{ userId: household.maya.id, role: 'viewer' }],
          acknowledged: true,
        },
      }),
      params(household.home.id),
    );
    expect(applied.status).toBe(200);
    const payload = await json<{ cascadedProjects: number; members: Array<{ username: string; role: string }> }>(
      applied,
    );
    expect(payload.cascadedProjects).toBeGreaterThanOrEqual(1);
    const renovate = db
      .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
      .get(household.renovate.id, household.maya.id) as { role: string } | undefined;
    expect(renovate?.role).toBe('viewer');
  });

  it('refuses to leave a project without an Admin', async () => {
    // Fresh project whose only Admin is tristan.
    const project = createProject(db, {
      title: 'Solo admin project',
      parentId: household.root.id,
      reporterId: household.tristan.id,
    });
    createWorkflow(db, project.id, { names: ['To do', 'Done'] });
    grantRole(db, project.id, household.tristan.id, 'admin');
    const response = await membersRoute.PUT(
      request(`/api/projects/${project.id}/members`, {
        method: 'PUT',
        body: {
          changes: [{ userId: household.tristan.id, role: 'viewer' }],
          acknowledged: true,
        },
      }),
      params(project.id),
    );
    expect(response.status).toBe(409);
    const payload = await json<{ error: { code: string; message: string } }>(response);
    expect(payload.error.code).toBe('last_admin');
    expect(payload.error.message).toMatch(/Admin/i);
  });
});
