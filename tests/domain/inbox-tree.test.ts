import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { listInboxTree } from '@/server/domain/inbox';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  createProject,
  createRoot,
  createUser,
  createWorkflow,
  grantRole,
  type FixtureProject,
  type FixtureUser,
} from '../helpers/fixtures';

/**
 * Application-wide Inbox Tree data (issue #54).
 *
 * The query returns every readable, active project with its parent link, status,
 * Inbox flag and effective capabilities. It must never expose an unreadable
 * parent's title: a readable project behind such a boundary becomes a top-level
 * direct-access row instead.
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
let directCapture: FixtureProject;
let capture: FixtureProject;
let archivedProject: FixtureProject;
let trashedProject: FixtureProject;

function actor(who: FixtureUser, showArchived = false) {
  return { id: who.id, appRole: who.appRole, showArchived };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'inbox-tree-domain' });
  db = test.db;
  admin = await createUser(db, { username: 'inbox-tree-admin', appRole: 'admin' });
  editor = await createUser(db, { username: 'inbox-tree-editor' });
  viewer = await createUser(db, { username: 'inbox-tree-viewer', appRole: 'viewer' });

  root = createRoot(db, admin.id);
  grantRole(db, root.id, editor.id, 'user');
  grantRole(db, root.id, viewer.id, 'viewer');

  household = createProject(db, {
    title: 'Household',
    parentId: root.id,
    reporterId: admin.id,
    inbox: false,
  });
  grantRole(db, household.id, admin.id, 'admin');
  home = createProject(db, {
    title: 'Home improvement',
    parentId: root.id,
    reporterId: admin.id,
    inbox: false,
  });
  grantRole(db, home.id, admin.id, 'admin');
  grantRole(db, home.id, editor.id, 'user');
  grantRole(db, home.id, viewer.id, 'viewer');
  createWorkflow(db, home.id);

  // Private boundary under Root: the editor can read the child only through an
  // explicit grant, never the parent.
  privateProject = createProject(db, {
    title: 'Private plans',
    parentId: root.id,
    reporterId: admin.id,
    inbox: false,
    settings: { access: 'custom' },
  });
  grantRole(db, privateProject.id, admin.id, 'admin');
  createWorkflow(db, privateProject.id);
  directCapture = createProject(db, {
    title: 'Direct access capture',
    parentId: privateProject.id,
    reporterId: admin.id,
    inbox: true,
  });
  grantRole(db, directCapture.id, editor.id, 'user');

  // Nested Inbox capture the editor inherits from Home improvement.
  createWorkflow(db, household.id);
  capture = createProject(db, {
    title: 'Book boiler service',
    parentId: home.id,
    reporterId: admin.id,
    inbox: true,
  });

  archivedProject = createProject(db, {
    title: 'Archived side project',
    parentId: home.id,
    reporterId: admin.id,
    inbox: false,
    archived: true,
  });
  trashedProject = createProject(db, {
    title: 'Trashed project',
    parentId: home.id,
    reporterId: admin.id,
    inbox: false,
    trashedAt: new Date().toISOString(),
  });
});

afterAll(() => {
  test.cleanup();
});

describe('listInboxTree', () => {
  it('returns every active readable project with status, capabilities and priority', () => {
    const tree = listInboxTree(db, actor(admin));
    const byId = new Map(tree.map((node) => [node.id, node]));

    const homeNode = byId.get(home.id);
    expect(homeNode).toMatchObject({
      id: home.id,
      title: 'Home improvement',
      parentId: root.id,
      inbox: false,
      archived: false,
      canEdit: true,
      canAdmin: true,
    });
    // Home borrows the status from Root's workflow (Root itself has no status).
    expect(homeNode?.statusName).toBe('To do');
    expect(byId.get(capture.id)).toMatchObject({
      parentId: home.id,
      statusName: 'To do',
      inbox: true,
      canEdit: true,
      canAdmin: true,
    });
    expect(byId.get(root.id)?.parentId).toBeNull();
    expect(tree.map((node) => node.priority)).toEqual(
      [...tree.map((node) => node.priority)].sort((a, b) => a - b),
    );
  });

  it('orders siblings by the global priority, not creation order', () => {
    // Move Household behind Home improvement in the single global sequence.
    db.prepare('UPDATE projects SET priority = priority + 100 WHERE priority >= 0').run();
    db.prepare('UPDATE projects SET priority = 5 WHERE id = ?').run(household.id);
    db.prepare('UPDATE projects SET priority = 6 WHERE id = ?').run(home.id);
    db.prepare('UPDATE projects SET priority = 7 WHERE id = ?').run(privateProject.id);
    db.prepare('UPDATE projects SET priority = 8 WHERE id = ?').run(root.id);

    const tree = listInboxTree(db, actor(admin));
    const rootChildren = tree.filter((node) => node.parentId === root.id);
    // Household was created before Home improvement but now has priority 5 (vs 6
    // and 7), so it sorts first: this pins global priority over insertion order.
    expect(rootChildren.map((node) => node.title)).toEqual([
      'Household',
      'Home improvement',
      'Private plans',
    ]);
    const homeChildren = tree.filter((node) => node.parentId === home.id);
    const priorities = homeChildren.map((node) => node.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('places a readable project behind an unreadable parent at the top level', () => {
    const tree = listInboxTree(db, actor(editor));
    const ids = tree.map((node) => node.id);

    expect(ids).not.toContain(privateProject.id);
    expect(tree.some((node) => node.title === 'Private plans')).toBe(false);

    const direct = tree.find((node) => node.id === directCapture.id);
    expect(direct).toBeDefined();
    expect(direct?.parentId).toBeNull();
    expect(direct?.inbox).toBe(true);
    // The boundary itself is not readable, so the editor can still edit the
    // explicitly granted capture.
    expect(direct?.canEdit).toBe(true);
  });

  it('hides trashed and archived-hidden projects without leaking titles', () => {
    const tree = listInboxTree(db, actor(editor));
    const ids = tree.map((node) => node.id);
    expect(ids).not.toContain(trashedProject.id);
    expect(ids).not.toContain(archivedProject.id);
    expect(tree.some((node) => node.title === 'Trashed project')).toBe(false);
    expect(tree.some((node) => node.title === 'Archived side project')).toBe(false);

    const withArchived = listInboxTree(db, actor(editor, true));
    expect(withArchived.map((node) => node.id)).toContain(archivedProject.id);
    // Trash is never part of the active tree.
    expect(withArchived.map((node) => node.id)).not.toContain(trashedProject.id);
  });

  it('reports read-only capabilities for application Viewers', () => {
    const tree = listInboxTree(db, actor(viewer));
    const captureNode = tree.find((node) => node.id === capture.id);
    expect(captureNode).toBeDefined();
    expect(captureNode?.inbox).toBe(true);
    expect(captureNode?.canEdit).toBe(false);
    expect(captureNode?.canAdmin).toBe(false);
  });

  it('never includes projects the viewer cannot read at all', async () => {
    const stranger = await createUser(db, { username: 'inbox-tree-stranger' });
    const tree = listInboxTree(db, actor(stranger));
    expect(tree).toEqual([]);
    expect(listInboxTree(db, actor(editor)).some((node) => node.id === privateProject.id)).toBe(
      false,
    );
  });
});
