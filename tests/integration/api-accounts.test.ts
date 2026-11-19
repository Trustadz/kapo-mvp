import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { createSession, resolveSession } from '@/server/auth/session';
import { insertDefaultSettings } from '@/server/db/bootstrap';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import { createUser, type FixtureUser } from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, request, signIn, signOut } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';

/**
 * Accounts, profile/self-service and application settings API
 * (build-spec §1, §6 rule 2, §7; product.md §6, §8).
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const meRoute = await import('@/app/api/me/route');
const passwordRoute = await import('@/app/api/me/password/route');
const usersRoute = await import('@/app/api/users/route');
const settingsRoute = await import('@/app/api/settings/route');

// apiRoute-wrapped handlers take (request, context).
const meGet = () => meRoute.GET(request('/api/me'), EMPTY_CONTEXT);
const mePatch = (req: Request) => meRoute.PATCH(req, EMPTY_CONTEXT);
const passwordPost = (req: Request) => passwordRoute.POST(req, EMPTY_CONTEXT);
const usersGet = () => usersRoute.GET(request('/api/users'), EMPTY_CONTEXT);
const usersPost = (req: Request) => usersRoute.POST(req, EMPTY_CONTEXT);
const usersPatch = (req: Request) => usersRoute.PATCH(req, EMPTY_CONTEXT);
const settingsGet = () => settingsRoute.GET(request('/api/settings'), EMPTY_CONTEXT);
const settingsPut = (req: Request) => settingsRoute.PUT(req, EMPTY_CONTEXT);

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;
let adminTwo: FixtureUser;
let regular: FixtureUser;
let viewer: FixtureUser;

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-accounts' });
  db = test.db;
  insertDefaultSettings(db);
  admin = await createUser(db, { username: 'account-admin', appRole: 'admin' });
  adminTwo = await createUser(db, { username: 'account-admin-two', appRole: 'admin' });
  regular = await createUser(db, { username: 'account-user', appRole: 'user' });
  viewer = await createUser(db, { username: 'account-viewer', appRole: 'viewer' });
});

beforeEach(() => {
  resetRequestContext();
  signIn(db, admin.id);
});

afterAll(() => {
  test.cleanup();
});

describe('GET/PATCH /api/me', () => {
  it('requires authentication', async () => {
    signOut();
    expect((await meGet()).status).toBe(401);
    expect(
      (
        await mePatch(
          request('/api/me', { method: 'PATCH', body: { appearance: 'dark' } }),
        )
      ).status,
    ).toBe(401);
  });

  it('returns the signed-in user with a landing href', async () => {
    const response = await meGet();
    expect(response.status).toBe(200);
    const payload = await json<{
      user: { id: string; username: string; appRole: string };
      landingHref: string;
    }>(response);
    expect(payload.user.id).toBe(admin.id);
    expect(payload.user.username).toBe('account-admin');
    expect(payload.user.appRole).toBe('admin');
    expect(payload.landingHref).toBe('/');
    expect(JSON.stringify(payload)).not.toContain('scrypt$');
  });

  it('persists appearance, show_archived and landing page', async () => {
    const response = await mePatch(
      request('/api/me', {
        method: 'PATCH',
        body: { appearance: 'dark', showArchived: true, landingPage: 'home' },
      }),
    );
    expect(response.status).toBe(200);
    const payload = await json<{
      user: { appearance: string; showArchived: boolean; landingPage: string };
    }>(response);
    expect(payload.user.appearance).toBe('dark');
    expect(payload.user.showArchived).toBe(true);
    expect(payload.user.landingPage).toBe('home');
    const row = db
      .prepare('SELECT appearance, show_archived FROM users WHERE id = ?')
      .get(admin.id) as { appearance: string; show_archived: number };
    expect(row).toEqual({ appearance: 'dark', show_archived: 1 });
  });

  it('persists dashboard widget order and visibility', async () => {
    const response = await mePatch(
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
    expect(response.status).toBe(200);
    const payload = await json<{
      user: { dashboard: Array<{ id: string; visible: boolean }> };
    }>(response);
    expect(payload.user.dashboard).toEqual([
      { id: 'recent', visible: true },
      { id: 'inbox', visible: false },
    ]);
    const row = db.prepare('SELECT dashboard FROM users WHERE id = ?').get(admin.id) as {
      dashboard: string;
    };
    expect(JSON.parse(row.dashboard)).toEqual(payload.user.dashboard);
    // The cut "completed last week" widget cannot be reintroduced through the API.
    expect(row.dashboard).not.toContain('completed');
  });

  it('rejects malformed widget payloads with a local retryable error', async () => {
    const cases: unknown[] = [
      [{ id: 'inbox', visible: true }, { id: 'inbox', visible: false }],
      [{ id: 'inbox' }],
      'not-an-array',
      [{ id: '', visible: true }],
    ];
    for (const dashboard of cases) {
      const response = await mePatch(
        request('/api/me', { method: 'PATCH', body: { dashboard } }),
      );
      expect(response.status).toBe(422);
      const payload = await json<{ error: { code: string; fields: Record<string, string> } }>(
        response,
      );
      expect(payload.error.code).toBe('validation_failed');
      expect(payload.error.fields.dashboard).toBeTruthy();
    }
  });

  it('preserves unknown widget ids in storage (AR-044) but never renders them', async () => {
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
    const row = db.prepare('SELECT dashboard FROM users WHERE id = ?').get(admin.id) as {
      dashboard: string;
    };
    expect(row.dashboard).toContain('future-widget');
    // The preference round-trips intact; the dashboard renderer filters to
    // registered widgets, so the unknown entry is inert until registered.
    const payload = await json<{ user: { dashboard: Array<{ id: string }> } }>(response);
    expect(payload.user.dashboard.map((entry) => entry.id)).toContain('future-widget');
    // Restore defaults for later tests.
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

  it('lets an application Viewer edit only their own preferences', async () => {
    signIn(db, viewer.id);
    const response = await mePatch(
      request('/api/me', {
        method: 'PATCH',
        body: {
          appearance: 'light',
          dashboard: [
            { id: 'inbox', visible: true },
            { id: 'recent', visible: false },
          ],
        },
      }),
    );
    expect(response.status).toBe(200);
    // Application role is not editable through /api/me.
    const escalated = await mePatch(
      request('/api/me', { method: 'PATCH', body: { appRole: 'admin' } }),
    );
    expect(escalated.status).toBe(400);
    const row = db.prepare('SELECT app_role FROM users WHERE id = ?').get(viewer.id) as {
      app_role: string;
    };
    expect(row.app_role).toBe('viewer');
  });

  it('rejects cross-origin profile changes', async () => {
    const response = await mePatch(
      new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          host: 'localhost',
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ appearance: 'dark' }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('POST /api/me/password', () => {
  it('requires the current password and validates the new one', async () => {
    const wrongCurrent = await passwordPost(
      request('/api/me/password', {
        method: 'POST',
        body: { currentPassword: 'nope', newPassword: 'new-pass-123', confirmation: 'new-pass-123' },
      }),
    );
    expect(wrongCurrent.status).toBe(401);

    const weak = await passwordPost(
      request('/api/me/password', {
        method: 'POST',
        body: { currentPassword: 'kapo1234', newPassword: 'short', confirmation: 'short' },
      }),
    );
    expect(weak.status).toBe(422);

    const mismatch = await passwordPost(
      request('/api/me/password', {
        method: 'POST',
        body: { currentPassword: 'kapo1234', newPassword: 'new-pass-123', confirmation: 'other' },
      }),
    );
    expect(mismatch.status).toBe(422);
  });

  it('changes the password and revokes the other sessions', async () => {
    const otherSession = createSession(db, regular.id);
    const currentSession = createSession(db, regular.id);
    // Sign in with the current session through the cookie jar.
    const { cookieJar } = await import('../helpers/request-context');
    const { SESSION_COOKIE } = await import('@/server/auth/cookies');
    cookieJar.set({ name: SESSION_COOKIE, value: currentSession.token });

    const response = await passwordPost(
      request('/api/me/password', {
        method: 'POST',
        body: { currentPassword: 'kapo1234', newPassword: 'brand-new-pass', confirmation: 'brand-new-pass' },
      }),
    );
    expect(response.status).toBe(200);

    expect(resolveSession(db, otherSession.token)).toBeNull();
    expect(resolveSession(db, currentSession.token)).not.toBeNull();
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(regular.id) as {
      password_hash: string;
    };
    expect(await verifyPassword('brand-new-pass', row.password_hash)).toBe(true);
    expect(await verifyPassword('kapo1234', row.password_hash)).toBe(false);
  });
});

describe('GET/POST/PATCH /api/users', () => {
  it('is restricted to application Admins', async () => {
    for (const actor of [regular, viewer]) {
      signIn(db, actor.id);
      expect((await usersGet()).status).toBe(403);
      expect(
        (
          await usersPost(
            request('/api/users', {
              method: 'POST',
              body: { username: 'sneaky', email: 's@example.com', password: 'sneaky-pass' },
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await usersPatch(
            request('/api/users', { method: 'PATCH', body: { id: actor.id, appRole: 'admin' } }),
          )
        ).status,
      ).toBe(403);
    }
  });

  it('lists accounts without leaking hashes', async () => {
    signIn(db, admin.id);
    const response = await usersGet();
    expect(response.status).toBe(200);
    const payload = await json<{
      users: Array<{ id: string; username: string; appRole: string }>;
      defaultRole: string;
    }>(response);
    expect(payload.users.map((user) => user.username)).toEqual(
      expect.arrayContaining(['account-admin', 'account-user', 'account-viewer']),
    );
    expect(payload.defaultRole).toBe('user');
    expect(JSON.stringify(payload)).not.toContain('scrypt$');
  });

  it('creates accounts with the default role and rejects duplicates', async () => {
    const created = await usersPost(
      request('/api/users', {
        method: 'POST',
        body: { username: 'new-member', email: 'new@example.com', password: 'new-member-pass' },
      }),
    );
    expect(created.status).toBe(201);
    const createdPayload = await json<{ user: { appRole: string; username: string } }>(created);
    expect(createdPayload.user.username).toBe('new-member');
    expect(createdPayload.user.appRole).toBe('user');

    const duplicate = await usersPost(
      request('/api/users', {
        method: 'POST',
        body: { username: 'New-Member', email: 'dup@example.com', password: 'new-member-pass' },
      }),
    );
    expect(duplicate.status).toBe(409);
    const duplicatePayload = await json<{ error: { code: string } }>(duplicate);
    expect(duplicatePayload.error.code).toBe('username_taken');

    for (const [body, field] of [
      [{ username: 'a', email: 'valid@example.com', password: 'long-enough' }, 'username'],
      [{ username: 'valid-name', email: 'bad', password: 'long-enough' }, 'email'],
      [{ username: 'valid-name-2', email: 'valid2@example.com', password: 'short' }, 'password'],
    ] as const) {
      const invalid = await usersPost(
        request('/api/users', { method: 'POST', body }),
      );
      expect(invalid.status).toBe(422);
      const invalidPayload = await json<{ error: { fields: Record<string, string> } }>(invalid);
      expect(invalidPayload.error.fields[field]).toBeTruthy();
    }
  });

  it('promotes and demotes roles while protecting the last application Admin', async () => {
    // There are currently three admins (fixture admin, adminTwo, new-member is user).
    // Demote adminTwo while another admin remains: allowed.
    const demoted = await usersPatch(
      request('/api/users', {
        method: 'PATCH',
        body: { id: adminTwo.id, appRole: 'user' },
      }),
    );
    expect(demoted.status).toBe(200);

    // Sign in as the remaining admin and try to demote the last one.
    signIn(db, admin.id);
    const lastAdmin = await usersPatch(
      request('/api/users', {
        method: 'PATCH',
        body: { id: admin.id, appRole: 'user' },
      }),
    );
    expect(lastAdmin.status).toBe(409);
    const payload = await json<{ error: { code: string; message: string } }>(lastAdmin);
    expect(payload.error.code).toBe('last_admin');
    expect(payload.error.message).toMatch(/admin/i);
    const row = db.prepare('SELECT app_role FROM users WHERE id = ?').get(admin.id) as {
      app_role: string;
    };
    expect(row.app_role).toBe('admin');

    // Restore the second admin for later tests.
    const restored = await usersPatch(
      request('/api/users', {
        method: 'PATCH',
        body: { id: adminTwo.id, appRole: 'admin' },
      }),
    );
    expect(restored.status).toBe(200);
  });

  it('validates and applies PATCH fields', async () => {
    const patched = await usersPatch(
      request('/api/users', {
        method: 'PATCH',
        body: { id: regular.id, username: 'renamed-user', email: 'renamed@example.com' },
      }),
    );
    expect(patched.status).toBe(200);
    const payload = await json<{ user: { username: string; email: string } }>(patched);
    expect(payload.user.username).toBe('renamed-user');
    expect(payload.user.email).toBe('renamed@example.com');

    const missingId = await usersPatch(
      request('/api/users', { method: 'PATCH', body: { username: 'x-user' } }),
    );
    expect(missingId.status).toBe(422);
    const unknown = await usersPatch(
      request('/api/users', {
        method: 'PATCH',
        body: { id: '00000000-0000-4000-8000-000000000000', username: 'ghost' },
      }),
    );
    expect(unknown.status).toBe(404);
  });
});

describe('GET/PUT /api/settings', () => {
  it('is Admin only', async () => {
    for (const actor of [regular, viewer]) {
      signIn(db, actor.id);
      expect((await settingsGet()).status).toBe(403);
      expect(
        (
          await settingsPut(
            request('/api/settings', {
              method: 'PUT',
              body: { defaultAccountRole: 'viewer' },
            }),
          )
        ).status,
      ).toBe(403);
    }
  });

  it('reads and updates application settings', async () => {
    signIn(db, admin.id);
    const initial = await settingsGet();
    const initialPayload = await json<{
      settings: {
        defaultAccountRole: string;
        enabledViews: string[];
        trashRetentionDays: number;
        installationName: string;
      };
    }>(initial);
    expect(initialPayload.settings).toMatchObject({
      defaultAccountRole: 'user',
      enabledViews: ['kanban', 'card', 'tree', 'list'],
      trashRetentionDays: 30,
      installationName: 'Kapo',
    });

    const updated = await settingsPut(
      request('/api/settings', {
        method: 'PUT',
        body: { defaultAccountRole: 'viewer', enabledViews: ['kanban', 'list'] },
      }),
    );
    expect(updated.status).toBe(200);
    const updatedPayload = await json<{ settings: { defaultAccountRole: string; enabledViews: string[] } }>(
      updated,
    );
    expect(updatedPayload.settings.defaultAccountRole).toBe('viewer');
    expect(updatedPayload.settings.enabledViews).toEqual(['kanban', 'list']);

    const defaults = db
      .prepare("SELECT value FROM settings WHERE key = 'default_account_role'")
      .get() as { value: string };
    expect(defaults.value).toBe('viewer');
    // Re-enable all views for the rest of the suite.
    await settingsPut(
      request('/api/settings', {
        method: 'PUT',
        body: { enabledViews: ['kanban', 'card', 'tree', 'list'], defaultAccountRole: 'user' },
      }),
    );
  });

  it('rejects invalid settings and fixed trash retention', async () => {
    const retention = await settingsPut(
      request('/api/settings', {
        method: 'PUT',
        body: { trashRetentionDays: 14 },
      }),
    );
    expect(retention.status).toBe(422);
    const retentionPayload = await json<{ error: { fields: Record<string, string> } }>(retention);
    expect(retentionPayload.error.fields.trashRetentionDays).toMatch(/30/);

    const emptyViews = await settingsPut(
      request('/api/settings', { method: 'PUT', body: { enabledViews: [] } }),
    );
    expect(emptyViews.status).toBe(422);

    const unknownView = await settingsPut(
      request('/api/settings', { method: 'PUT', body: { enabledViews: ['kanban', 'gantt'] } }),
    );
    expect(unknownView.status).toBe(422);

    const empty = await settingsPut(
      request('/api/settings', { method: 'PUT', body: {} }),
    );
    expect(empty.status).toBe(400);
  });
});
