import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject as createFixtureProject,
  createUser,
  type FixtureHousehold,
  type FixtureUser,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn, signOut } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';
import { clearAddonsForTests, registerAddon } from '@/server/addons';
import { getShellData } from '@/server/db/shell-queries';
import { newId, nowIso } from '@/server/db/util';
import { recordAuditEvent } from '@/server/domain/audit';
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
  setProjectWatch,
} from '@/server/domain/notifications';
import type { AccessUser } from '@/server/domain/permissions';
import { writeAddonValues } from '@/server/domain/project-addons';
import { getProjectPageData, updateProject } from '@/server/domain/projects';
import { trashProjects } from '@/server/domain/trash';

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const notificationsRoute = await import('@/app/api/notifications/route');
const readRoute = await import('@/app/api/notifications/read/route');
const unreadRoute = await import('@/app/api/notifications/unread-count/route');
const watchRoute = await import('@/app/api/projects/[id]/watch/route');

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

function as(user: FixtureUser, showArchived = false): AccessUser {
  return { id: user.id, appRole: user.appRole, showArchived };
}

function insertRawNotification(input: {
  userId: string;
  projectId: string;
  origin: string;
  message?: string;
  readAt?: string | null;
}): string {
  const id = newId();
  db.prepare(
    `INSERT INTO notifications
       (id, user_id, kind, message, translations, data, origin, origin_type, origin_id,
        href, project_id, actor_id, addon_identifier, source_event_id, created_at, read_at)
     VALUES (?, ?, 'project.renamed', ?, '{}', '{}', ?, 'project', ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.message ?? 'Raw notification',
    input.origin,
    input.projectId,
    `/p/${input.projectId}`,
    input.projectId,
    nowIso(),
    input.readAt ?? null,
  );
  return id;
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'notifications' });
  db = test.db;
  household = await buildHouseholdFixture(db);
});

beforeEach(() => {
  resetRequestContext();
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM project_watches').run();
  signIn(db, household.admin.id);
});

afterAll(() => {
  clearAddonsForTests();
  test.cleanup();
});

describe('watching and watch fan-out', () => {
  it('notifies other watchers, skips the actor, and exposes watch/read state', () => {
    setProjectWatch(db, as(household.maya), household.home.id, true);
    setProjectWatch(db, as(household.admin), household.home.id, true);

    updateProject(db, as(household.maya), household.home.id, { title: 'Home improvement v2' });

    const adminPage = listNotifications(db, as(household.admin));
    expect(adminPage.notifications).toHaveLength(1);
    expect(adminPage.notifications[0]).toMatchObject({
      kind: 'project.renamed',
      origin: 'Home improvement v2',
      href: `/p/${household.home.id}`,
      projectId: household.home.id,
      readAt: null,
    });
    expect(adminPage.notifications[0]?.actor?.id).toBe(household.maya.id);
    expect(adminPage.unreadCount).toBe(1);

    // The actor does not receive their own change.
    expect(listNotifications(db, as(household.maya)).notifications).toHaveLength(0);

    expect(getShellData(household.admin.id, db).unreadNotifications).toBe(1);
    expect(getProjectPageData(db, as(household.admin), household.home.id)?.project.watching).toBe(
      true,
    );

    expect(markNotificationsRead(db, as(household.admin)).unreadCount).toBe(0);
    expect(countUnreadNotifications(db, as(household.admin))).toBe(0);
    expect(getShellData(household.admin.id, db).unreadNotifications).toBe(0);

    // Restore the fixture title so ordering cannot leak into later tests.
    updateProject(db, as(household.admin), household.home.id, { title: household.home.title });
    db.prepare('DELETE FROM notifications').run();
  });

  it('does not notify a parent watcher about routine child edits', () => {
    setProjectWatch(db, as(household.admin), household.home.id, true);

    updateProject(db, as(household.maya), household.renovate.id, {
      title: 'Renovate basement v2',
    });

    expect(listNotifications(db, as(household.admin)).notifications).toHaveLength(0);
  });

  it('notifies a parent watcher about child creation and child trashing', () => {
    setProjectWatch(db, as(household.jules), household.home.id, true);

    // Admin creates and trashes; Jules is only a watcher, so both entries reach
    // the parent project's notification stream.
    const child = createFixtureProject(db, {
      title: 'Notify me about this child',
      parentId: household.home.id,
      reporterId: household.admin.id,
    });
    recordAuditEvent(db, {
      projectId: household.home.id,
      actor: as(household.admin),
      action: AUDIT_ACTIONS.childCreated,
      targetId: child.id,
      newValue: child.title,
    });

    const created = listNotifications(db, as(household.jules)).notifications;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      kind: 'project.child_created',
      origin: household.home.title,
    });
    expect(created[0]?.data.targetTitle).toBe(child.title);

    db.prepare('DELETE FROM notifications').run();
    trashProjects(db, as(household.admin), [child.id]);
    const trashed = listNotifications(db, as(household.jules)).notifications;
    expect(trashed).toHaveLength(1);
    expect(trashed[0]?.kind).toBe('project.child_trashed');
  });

  it('hides notifications for projects the recipient cannot read', () => {
    insertRawNotification({
      userId: household.maya.id,
      projectId: household.personal.id,
      origin: household.personal.title,
    });

    expect(listNotifications(db, as(household.maya)).notifications).toHaveLength(0);
    expect(countUnreadNotifications(db, as(household.maya))).toBe(0);
    // Marking read only touches visible rows; the hidden notification remains
    // unread in storage and would return if access were granted.
    markNotificationsRead(db, as(household.maya));
    const row = db
      .prepare('SELECT read_at FROM notifications WHERE user_id = ? AND project_id = ?')
      .get(household.maya.id, household.personal.id) as { read_at: string | null };
    expect(row.read_at).toBeNull();
  });

  it('deletes notifications with a purged project', () => {
    const leaf = createFixtureProject(db, {
      title: 'Disposable leaf',
      parentId: household.home.id,
      reporterId: household.admin.id,
    });
    insertRawNotification({
      userId: household.admin.id,
      projectId: leaf.id,
      origin: leaf.title,
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE project_id = ?').get(leaf.id),
    ).toEqual({ count: 1 });

    db.prepare('DELETE FROM projects WHERE id = ?').run(leaf.id);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE project_id = ?').get(leaf.id),
    ).toEqual({ count: 0 });
  });
});

describe('add-on notification endpoint', () => {
  it('delivers an add-on notification to a recipient who can read the project', () => {
    clearAddonsForTests();
    registerAddon({
      identifier: 'test-notify',
      name: 'Test notifier',
      version: '1.0.0',
      defaultMode: 'always',
      fields: [{ key: 'owner', label: 'Owner', type: 'user' }],
      hooks: {
        onValuesSaved({ actorId, values, changes, notify }) {
          const owner = values.owner;
          if (typeof owner === 'string' && owner !== actorId) {
            notify({
              recipients: [owner],
              kind: 'test.assigned',
              message: 'You were assigned.',
              translations: { en: 'You were assigned.', nl: 'Je bent toegewezen.' },
              sourceEventId: changes.find((change) => change.fieldKey === 'owner')?.auditEventId,
            });
          }
        },
      },
    });

    writeAddonValues(db, as(household.admin), household.home.id, 'test-notify', {
      owner: household.jules.id,
    });

    const page = listNotifications(db, as(household.jules));
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]).toMatchObject({
      kind: 'test.assigned',
      origin: 'Test notifier',
      originType: 'addon',
      addonIdentifier: 'test-notify',
      projectId: household.home.id,
    });
  });

  it('never notifies a recipient who cannot read the project', async () => {
    clearAddonsForTests();
    const outsider = await createUser(db, { username: 'outside-notify' });
    registerAddon({
      identifier: 'test-notify-outsider',
      name: 'Test notifier',
      version: '1.0.0',
      defaultMode: 'always',
      fields: [{ key: 'owner', label: 'Owner', type: 'user' }],
      hooks: {
        onValuesSaved({ values, notify }) {
          const owner = values.owner;
          if (typeof owner === 'string') {
            notify({ recipients: [owner], message: 'You were assigned.' });
          }
        },
      },
    });

    writeAddonValues(db, as(household.admin), household.home.id, 'test-notify-outsider', {
      owner: outsider.id,
    });

    expect(listNotifications(db, as(outsider)).notifications).toHaveLength(0);
  });
});

describe('notification API', () => {
  it('lists, counts, and marks notifications read for the signed-in user', async () => {
    signIn(db, household.maya.id);
    const watchResponse = await watchRoute.POST(
      request(`/api/projects/${household.home.id}/watch`, {
        method: 'POST',
        body: { watch: true },
      }),
      params(household.home.id),
    );
    expect(watchResponse.status).toBe(200);
    expect(await json(watchResponse)).toEqual({ watching: true });

    updateProject(db, as(household.admin), household.home.id, { title: 'Home API rename' });

    const listResponse = await notificationsRoute.GET(
      request('/api/notifications'),
      EMPTY_CONTEXT,
    );
    expect(listResponse.status).toBe(200);
    const page = await json<{
      notifications: Array<{ kind: string; readAt: string | null }>;
      unreadCount: number;
    }>(listResponse);
    expect(page.unreadCount).toBe(1);
    expect(page.notifications[0]?.kind).toBe('project.renamed');

    const countResponse = await unreadRoute.GET(
      request('/api/notifications/unread-count'),
      EMPTY_CONTEXT,
    );
    expect(await json(countResponse)).toEqual({ unreadCount: 1 });

    const readResponse = await readRoute.POST(
      request('/api/notifications/read', { method: 'POST', body: {} }),
      EMPTY_CONTEXT,
    );
    expect(await json(readResponse)).toEqual({ unreadCount: 0 });

    const after = await notificationsRoute.GET(request('/api/notifications'), EMPTY_CONTEXT);
    const afterPage = await json<{ notifications: Array<{ readAt: string | null }> }>(after);
    expect(afterPage.notifications[0]?.readAt).not.toBeNull();
  });

  it('requires authentication', async () => {
    signOut();
    const response = await notificationsRoute.GET(request('/api/notifications'), EMPTY_CONTEXT);
    expect(response.status).toBe(401);
  });
});
