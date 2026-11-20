import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { changeInboxParent, listInbox } from '@/server/domain/inbox';
import { createProject as createDomainProject } from '@/server/domain/projects';
import { DomainError } from '@/server/domain/permissions';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  createProject as createFixtureProject,
  createRoot,
  createUser,
  createWorkflow,
  getProjectRow,
  getStartStatus,
  grantRole,
  type FixtureUser,
  type WorkflowStatusRow,
} from '../helpers/fixtures';

/**
 * Inbox Change parent (issue #15): reparenting a capture must keep it in the
 * Inbox, move it to the destination's Start status, and reject invalid
 * destinations with the same rules as Move.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;
let editor: FixtureUser;
let viewer: FixtureUser;
let rootId: string;
let homeId: string;
let householdId: string;
let householdStart: WorkflowStatusRow;

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

function capture(title: string): ReturnType<typeof createDomainProject> {
  return createDomainProject(db, actor(admin), { parentId: homeId, title });
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'inbox-parent-domain' });
  db = test.db;
  admin = await createUser(db, { username: 'inbox-parent-admin', appRole: 'admin' });
  editor = await createUser(db, { username: 'inbox-parent-editor' });
  viewer = await createUser(db, { username: 'inbox-parent-viewer', appRole: 'viewer' });

  const root = createRoot(db, admin.id);
  rootId = root.id;
  grantRole(db, rootId, editor.id, 'user');
  grantRole(db, rootId, viewer.id, 'viewer');

  const home = createFixtureProject(db, {
    title: 'Home improvement',
    parentId: rootId,
    reporterId: admin.id,
  });
  homeId = home.id;
  grantRole(db, homeId, admin.id, 'admin');
  grantRole(db, homeId, editor.id, 'user');
  grantRole(db, homeId, viewer.id, 'viewer');
  createWorkflow(db, homeId, { names: ['To do', 'In progress', 'Done'] });

  const household = createFixtureProject(db, {
    title: 'Household',
    parentId: rootId,
    reporterId: admin.id,
  });
  householdId = household.id;
  grantRole(db, householdId, admin.id, 'admin');
  createWorkflow(db, householdId, { names: ['Open', 'Closed'] });
  householdStart = getStartStatus(db, householdId);
});

afterAll(() => {
  test.cleanup();
});

describe('changeInboxParent', () => {
  it('keeps the capture in the Inbox at the destination Start status and appends it last', () => {
    const existing = createFixtureProject(db, {
      title: 'Existing household child',
      parentId: householdId,
      reporterId: admin.id,
      inbox: false,
    });
    const created = capture('Misfiled capture');
    const homeStart = getStartStatus(db, homeId);
    expect(created.inbox).toBe(true);
    expect(created.statusId).toBe(homeStart.id);

    const updated = changeInboxParent(db, actor(admin), created.id, {
      destinationId: householdId,
    });

    expect(updated.parent).toEqual({ id: householdId, title: 'Household' });
    expect(updated.statusId).toBe(householdStart.id);
    expect(updated.statusName).toBe('Open');
    expect(updated.inbox).toBe(true);

    const row = getProjectRow(db, created.id)!;
    expect(row.parent_id).toBe(householdId);
    expect(row.status_id).toBe(householdStart.id);
    expect(row.inbox).toBe(1);
    expect(row.priority).toBeGreaterThan(existing.priority);

    // Still listed in the Inbox, now under the new parent and Start status.
    const item = listInbox(db, actor(admin)).find((entry) => entry.project.id === created.id);
    expect(item).toBeDefined();
    expect(item?.parentTitle).toBe('Household');
    expect(item?.startStatusName).toBe('Open');
    expect(item?.canChangeParent).toBe(true);

    const audit = db
      .prepare(
        `SELECT action, old_value, new_value, detail FROM audit_events
          WHERE project_id = ? ORDER BY rowid ASC`,
      )
      .all(created.id) as Array<{
      action: string;
      old_value: string | null;
      new_value: string | null;
      detail: string | null;
    }>;
    const moved = audit.filter((entry) => entry.action === 'project.moved');
    expect(moved).toHaveLength(1);
    expect(moved[0]?.old_value).toBe('Home improvement');
    expect(moved[0]?.new_value).toBe('Household');
    const statusChange = audit.filter((entry) => entry.action === 'project.status_changed');
    expect(statusChange).toHaveLength(1);
    expect(statusChange[0]?.old_value).toBe(homeStart.name);
    expect(statusChange[0]?.new_value).toBe('Open');
    expect(JSON.parse(statusChange[0]?.detail ?? '{}')).toEqual({
      fromId: homeStart.id,
      toId: householdStart.id,
    });

    const indexed = db
      .prepare('SELECT COUNT(*) AS count FROM project_search WHERE project_id = ?')
      .get(created.id) as { count: number };
    expect(indexed.count).toBe(1);
  });

  it('rejects the current parent, the capture itself and its descendants', () => {
    const created = capture('Cycle checks');
    const sameParent = expectDomainError(() =>
      changeInboxParent(db, actor(admin), created.id, { destinationId: homeId }),
    );
    expect(sameParent.status).toBe(422);
    expect(sameParent.code).toBe('validation_failed');
    expect(sameParent.message).toMatch(/already under/i);

    const self = expectDomainError(() =>
      changeInboxParent(db, actor(admin), created.id, { destinationId: created.id }),
    );
    expect(self.status).toBe(422);
    expect(self.message).toMatch(/inside itself/i);

    const child = createFixtureProject(db, {
      title: 'Capture child',
      parentId: created.id,
      reporterId: admin.id,
    });
    const cycle = expectDomainError(() =>
      changeInboxParent(db, actor(admin), created.id, { destinationId: child.id }),
    );
    expect(cycle.status).toBe(422);
    expect(cycle.message).toMatch(/subtree/i);

    const row = getProjectRow(db, created.id)!;
    expect(row.parent_id).toBe(homeId);
    expect(row.inbox).toBe(1);
  });

  it('requires project Admin on the capture and edit access on the destination', () => {
    const created = capture('Permissions');

    const notAdmin = expectDomainError(() =>
      changeInboxParent(db, actor(editor), created.id, { destinationId: householdId }),
    );
    expect(notAdmin.status).toBe(403);

    // Custom destination: not readable for the app Admin at all.
    const privateDestination = createFixtureProject(db, {
      title: 'Private destination',
      parentId: rootId,
      reporterId: editor.id,
      settings: { access: 'custom' },
    });
    grantRole(db, privateDestination.id, editor.id, 'admin');
    createWorkflow(db, privateDestination.id, { names: ['Open', 'Closed'] });
    const unreadable = expectDomainError(() =>
      changeInboxParent(db, actor(admin), created.id, {
        destinationId: privateDestination.id,
      }),
    );
    expect(unreadable.status).toBe(404);

    // Readable as Viewer: the destination cannot receive the capture.
    grantRole(db, privateDestination.id, admin.id, 'viewer');
    const readOnly = expectDomainError(() =>
      changeInboxParent(db, actor(admin), created.id, {
        destinationId: privateDestination.id,
      }),
    );
    expect(readOnly.status).toBe(403);
  });

  it('rejects trashed captures and destinations, and projects already released from the Inbox', () => {
    const trashedDestination = createFixtureProject(db, {
      title: 'Trashed destination',
      parentId: rootId,
      reporterId: admin.id,
    });
    grantRole(db, trashedDestination.id, admin.id, 'admin');
    createWorkflow(db, trashedDestination.id, { names: ['Open', 'Closed'] });
    db.prepare('UPDATE projects SET trashed_at = ? WHERE id = ?').run(
      '2026-01-01T00:00:00.000Z',
      trashedDestination.id,
    );

    const destinationCapture = capture('Trashed destination check');
    const trashedDestinationError = expectDomainError(() =>
      changeInboxParent(db, actor(admin), destinationCapture.id, {
        destinationId: trashedDestination.id,
      }),
    );
    expect(trashedDestinationError.status).toBe(409);

    const trashedCapture = capture('Trashed capture check');
    db.prepare('UPDATE projects SET trashed_at = ? WHERE id = ?').run(
      '2026-01-01T00:00:00.000Z',
      trashedCapture.id,
    );
    const trashedCaptureError = expectDomainError(() =>
      changeInboxParent(db, actor(admin), trashedCapture.id, {
        destinationId: householdId,
      }),
    );
    expect(trashedCaptureError.status).toBe(409);

    const released = capture('Already released');
    db.prepare('UPDATE projects SET inbox = 0 WHERE id = ?').run(released.id);
    const releasedError = expectDomainError(() =>
      changeInboxParent(db, actor(admin), released.id, { destinationId: householdId }),
    );
    expect(releasedError.status).toBe(422);
    expect(releasedError.message).toMatch(/Inbox/i);
  });

  it('validates the destination id and missing destinations', () => {
    const created = capture('Destination validation');
    const missing = expectDomainError(() =>
      changeInboxParent(db, actor(admin), created.id, { destinationId: 'missing-project' }),
    );
    expect(missing.status).toBe(404);

    const empty = expectDomainError(() =>
      changeInboxParent(db, actor(admin), created.id, {}),
    );
    expect(empty.status).toBe(422);
    expect(empty.fields?.destinationId).toBeDefined();
  });
});
