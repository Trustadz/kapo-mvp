import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { findUserById } from '@/server/auth/current-user';
import { seedDatabase } from '@/server/seed';
import {
  addFavorite,
  createProject,
  createRoot,
  createUser,
  createWorkflow,
  getProjectRow,
  grantRole,
  removeGrant,
  type FixtureUser,
} from '../helpers/fixtures';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  DomainError,
  applyMemberChanges,
  canAdminProject,
  canEditProject,
  canReadProject,
  getProjectAccessMode,
  loadAccessContext,
  parseProjectAccess,
  type AccessUser,
} from '@/server/domain/permissions';
import {
  createProject as createDomainProject,
  getProjectPageData,
  updateProject,
  updateProjectSettings,
} from '@/server/domain/projects';
import { listInbox } from '@/server/domain/inbox';
import { listTrash, trashProjects } from '@/server/domain/trash';
import { searchProjects } from '@/server/domain/search';
import { getFavoriteProjects } from '@/server/db/shell-queries';
import { getInboxWidget, getRecentWidget } from '@/server/domain/dashboard';

/**
 * Access modes (`projects.settings.access: inherit | custom`, build-spec §6
 * rule 2, product.md §6):
 *  - inherit walks up to the parent's effective role; custom is an explicit
 *    boundary that ignores ancestors (Root is always custom with the implicit
 *    application-Admin fallback).
 *  - a custom project is private from other application Admins.
 *  - inherit -> custom requires acknowledgement; Root cannot be inherit;
 *    switching is rejected if the simulated subtree loses its last Admin.
 *  - reduction cascades override grants on custom descendants; increases do
 *    not propagate.
 *  - the seeded Personal project is custom/private: Maya/Jules/Alex must not
 *    see it through pages, children lists, search, Inbox, favorites, Trash,
 *    dashboard widgets or parent activity target titles.
 */

function actor(who: FixtureUser, showArchived = false): AccessUser {
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

function setAccess(db: BetterSqliteDatabase, projectId: string, access: 'inherit' | 'custom'): void {
  const row = db.prepare('SELECT settings FROM projects WHERE id = ?').get(projectId) as {
    settings: string;
  };
  const settings = JSON.parse(row.settings) as Record<string, unknown>;
  settings.access = access;
  db.prepare('UPDATE projects SET settings = ? WHERE id = ?').run(
    JSON.stringify(settings),
    projectId,
  );
}

describe('access-mode engine semantics', () => {
  let test: TestDatabase;
  let db: BetterSqliteDatabase;
  let owner: FixtureUser;
  let maya: FixtureUser;
  let otherAdmin: FixtureUser;
  let rootId: string;

  beforeAll(async () => {
    test = createTestDatabase({ label: 'access-engine' });
    db = test.db;
    owner = await createUser(db, { username: 'access-owner', appRole: 'admin' });
    maya = await createUser(db, { username: 'access-maya', appRole: 'user' });
    otherAdmin = await createUser(db, { username: 'access-other-admin', appRole: 'admin' });
    rootId = createRoot(db, owner.id).id;
    grantRole(db, rootId, maya.id, 'user');
  });

  afterAll(() => {
    test.cleanup();
  });

  it('inherits the parent role while access is inherit', () => {
    const parent = createProject(db, {
      title: 'Inherit parent',
      parentId: rootId,
      reporterId: owner.id,
    });
    grantRole(db, parent.id, owner.id, 'admin');
    createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
    const child = createProject(db, {
      title: 'Inherit child',
      parentId: parent.id,
      reporterId: owner.id,
    });
    const ctx = loadAccessContext(db, actor(maya));
    expect(canReadProject(ctx, child.id)).toBe(true);
    expect(canEditProject(ctx, child.id)).toBe(true);
  });

  it('stops inheritance at a custom boundary', () => {
    const parent = createProject(db, {
      title: 'Custom boundary parent',
      parentId: rootId,
      reporterId: owner.id,
    });
    grantRole(db, parent.id, owner.id, 'admin');
    createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
    const child = createProject(db, {
      title: 'Private child',
      parentId: parent.id,
      reporterId: owner.id,
      settings: { access: 'custom' },
    });
    const ctx = loadAccessContext(db, actor(maya));
    expect(canReadProject(ctx, parent.id)).toBe(true);
    expect(canReadProject(ctx, child.id)).toBe(false);
    expect(getRoleOf(db, maya.id, child.id)).toBeNull();
    // The parent activity/children paths see the custom boundary too.
    expect(getProjectPageData(db, actor(maya), child.id)).toBeNull();
    expect(getProjectPageData(db, actor(maya), parent.id)!.children.map((c) => c.id)).not.toContain(
      child.id,
    );
    // The explicit grant is the only way in.
    grantRole(db, child.id, maya.id, 'viewer');
    const granted = loadAccessContext(db, actor(maya));
    expect(canReadProject(granted, child.id)).toBe(true);
    expect(canEditProject(granted, child.id)).toBe(false);
  });

  it('lets children of a custom project inherit its explicit grants', () => {
    const privateParent = createProject(db, {
      title: 'Custom parent with inherited child',
      parentId: rootId,
      reporterId: owner.id,
      settings: { access: 'custom' },
    });
    grantRole(db, privateParent.id, owner.id, 'admin');
    grantRole(db, privateParent.id, maya.id, 'viewer');
    createWorkflow(db, privateParent.id, { names: ['To do', 'Done'] });
    const child = createProject(db, {
      title: 'Inherits from custom parent',
      parentId: privateParent.id,
      reporterId: owner.id,
    });
    const ctx = loadAccessContext(db, actor(maya));
    expect(canReadProject(ctx, child.id)).toBe(true);
    expect(canEditProject(ctx, child.id)).toBe(false);
    expect(canReadProject(loadAccessContext(db, actor(otherAdmin)), child.id)).toBe(false);
  });

  it('makes a custom project private from other application Admins', () => {
    const secret = createProject(db, {
      title: 'Admin-private project',
      parentId: rootId,
      reporterId: owner.id,
      settings: { access: 'custom' },
    });
    grantRole(db, secret.id, owner.id, 'admin');
    const other = loadAccessContext(db, actor(otherAdmin));
    expect(canReadProject(other, rootId)).toBe(true); // implicit Root Admin fallback
    expect(canReadProject(other, secret.id)).toBe(false);
    expect(getProjectPageData(db, actor(otherAdmin), secret.id)).toBeNull();
    expect(
      expectDomainError(() => updateProject(db, actor(otherAdmin), secret.id, { title: 'Hijack' }))
        .status,
    ).toBe(404);
  });

  it('treats Root as custom while keeping the implicit application-Admin fallback', () => {
    expect(parseProjectAccess(null, true)).toBe('custom');
    expect(getProjectAccessMode(db, rootId)).toBe('custom');
    const adminCtx = loadAccessContext(db, actor(otherAdmin));
    expect(canReadProject(adminCtx, rootId)).toBe(true);
    const userCtx = loadAccessContext(db, actor(maya));
    expect(canReadProject(userCtx, rootId)).toBe(true); // explicit Root user grant
    const noGrant = loadAccessContext(db, actor(owner));
    // owner is an application Admin, so Root is readable via the fallback too;
    // an application User with no Root grant would not be.
    expect(canReadProject(noGrant, rootId)).toBe(true);
  });
});

/** Helper: effective role for a user via the context. */
function getRoleOf(db: BetterSqliteDatabase, userId: string, projectId: string): string | null {
  const row = db.prepare('SELECT app_role, show_archived FROM users WHERE id = ?').get(userId) as {
    app_role: 'admin' | 'user' | 'viewer';
    show_archived: number;
  };
  const ctx = loadAccessContext(db, {
    id: userId,
    appRole: row.app_role,
    showArchived: row.show_archived === 1,
  });
  return ctx.roleById.get(projectId) ?? null;
}

describe('seeded Personal project is custom/private', () => {
  let test: TestDatabase;
  let db: BetterSqliteDatabase;
  let tristan: FixtureUser;
  let maya: FixtureUser;
  let jules: FixtureUser;
  let alex: FixtureUser;
  let personalId: string;
  let weekendId: string;
  let homeId: string;

  beforeAll(async () => {
    test = createTestDatabase({ label: 'access-seed' });
    db = test.db;
    await seedDatabase(db);
    const userId = (username: string): string =>
      (db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string }).id;
    tristan = { id: userId('tristan'), username: 'tristan', email: 't@example.com', appRole: 'admin' };
    maya = { id: userId('maya'), username: 'maya', email: 'm@example.com', appRole: 'user' };
    jules = { id: userId('jules'), username: 'jules', email: 'j@example.com', appRole: 'user' };
    alex = { id: userId('alex'), username: 'alex', email: 'a@example.com', appRole: 'viewer' };
    personalId = (
      db.prepare('SELECT id FROM projects WHERE title = ?').get('Personal') as { id: string }
    ).id;
    weekendId = (
      db.prepare('SELECT id FROM projects WHERE title = ?').get('Plan weekend trip') as { id: string }
    ).id;
    homeId = (
      db.prepare('SELECT id FROM projects WHERE title = ?').get('Home improvement') as { id: string }
    ).id;
  });

  afterAll(() => {
    test.cleanup();
  });

  it('marks Personal custom and keeps it readable for its project Admin only', () => {
    expect(getProjectAccessMode(db, personalId)).toBe('custom');
    for (const user of [tristan]) {
      expect(canAdminProject(loadAccessContext(db, actor(user)), personalId)).toBe(true);
    }
    for (const user of [maya, jules, alex]) {
      expect(canReadProject(loadAccessContext(db, actor(user)), personalId)).toBe(false);
      expect(getProjectPageData(db, actor(user), personalId)).toBeNull();
    }
  });

  it('hides Personal from Root children lists and project pages', () => {
    const tristanPage = getProjectPageData(db, actor(tristan), homeId)!;
    expect(tristanPage.project.title).toBe('Home improvement');
    for (const user of [maya, jules, alex]) {
      const rootPage = getProjectPageData(db, actor(user), (
        db.prepare('SELECT id FROM projects WHERE parent_id IS NULL').get() as { id: string }
      ).id)!;
      expect(rootPage.children.map((child) => child.title)).not.toContain('Personal');
    }
  });

  it('hides Personal and its child from search and Inbox', () => {
    for (const user of [maya, jules, alex]) {
      const results = searchProjects(db, actor(user), 'weekend');
      expect(results.map((result) => result.id)).not.toContain(weekendId);
      expect(results.map((result) => result.title)).not.toContain('Personal');
      const inbox = listInbox(db, actor(user));
      expect(inbox.map((item) => item.project.id)).not.toContain(weekendId);
    }
    // Tristan sees both Personal and its Inbox child.
    expect(searchProjects(db, actor(tristan), 'weekend').map((r) => r.id)).toContain(weekendId);
    expect(listInbox(db, actor(tristan)).map((item) => item.project.id)).toContain(weekendId);
  });

  it('drops lost-access favorites from navigation', () => {
    addFavorite(db, maya.id, personalId);
    addFavorite(db, alex.id, weekendId);
    expect(getFavoriteProjects(maya.id, db).map((favorite) => favorite.id)).not.toContain(personalId);
    expect(getFavoriteProjects(alex.id, db).map((favorite) => favorite.id)).not.toContain(weekendId);
    expect(getFavoriteProjects(tristan.id, db).map((favorite) => favorite.id)).toContain(personalId);
  });

  it('hides trashed custom projects from other users Trash lists', () => {
    // Trash a project under Personal; maya stays unable to see it.
    const errand = createProject(db, {
      title: 'Private errand',
      parentId: personalId,
      reporterId: tristan.id,
      settings: { access: 'inherit' },
    });
    grantRole(db, errand.id, tristan.id, 'admin');
    trashProjects(db, actor(tristan), [errand.id]);
    for (const user of [maya, jules, alex]) {
      expect(listTrash(db, actor(user)).map((item) => item.id)).not.toContain(errand.id);
    }
    expect(listTrash(db, actor(tristan)).map((item) => item.id)).toContain(errand.id);
  });

  it('hides Personal from dashboard widgets', () => {
    const mayaUser = findUserById(db, maya.id)!;
    const inboxWidget = getInboxWidget(db, mayaUser);
    expect(JSON.stringify(inboxWidget)).not.toContain('Personal');
    expect(JSON.stringify(inboxWidget)).not.toContain('Plan weekend trip');
    const recentWidget = getRecentWidget(db, mayaUser);
    expect(JSON.stringify(recentWidget)).not.toContain('Personal');
    expect(JSON.stringify(recentWidget)).not.toContain('Plan weekend trip');
  });

  it('hides custom child titles in a readable parent Activity', () => {
    // Home improvement is readable by maya; its custom child is not.
    const customChild = createDomainProject(db, actor(tristan), {
      parentId: homeId,
      title: 'Maya cannot see this child',
    });
    setAccess(db, customChild.id, 'custom');
    removeGrant(db, customChild.id, maya.id);

    const tristanPage = getProjectPageData(db, actor(tristan), homeId)!;
    const mayaPage = getProjectPageData(db, actor(maya), homeId)!;
    const tristanEvent = tristanPage.activity.events.find(
      (event) => event.target?.id === customChild.id,
    );
    expect(tristanEvent?.target?.title).toBe('Maya cannot see this child');
    const mayaChildEvent = mayaPage.activity.events.find(
      (event) => event.action === 'project.child_created',
    );
    expect(mayaChildEvent).toBeDefined();
    expect(mayaChildEvent?.target).toBeNull();
    // A viewer who cannot read the child must not recover the title from the
    // parent log, including the raw newValue snapshot in the JSON payload.
    expect(JSON.stringify(mayaPage.activity)).not.toContain('Maya cannot see this child');
  });
});

describe('switching access modes', () => {
  let test: TestDatabase;
  let db: BetterSqliteDatabase;
  let owner: FixtureUser;
  let maya: FixtureUser;
  let rootId: string;

  beforeAll(async () => {
    test = createTestDatabase({ label: 'access-switch' });
    db = test.db;
    owner = await createUser(db, { username: 'switch-owner', appRole: 'admin' });
    maya = await createUser(db, { username: 'switch-maya', appRole: 'user' });
    rootId = createRoot(db, owner.id).id;
    grantRole(db, rootId, maya.id, 'user');
  });

  afterAll(() => {
    test.cleanup();
  });

  function actorOwner() {
    return { id: owner.id, appRole: 'admin' as const, showArchived: false };
  }

  function makeInheritProject(title: string) {
    const project = createProject(db, {
      title,
      parentId: rootId,
      reporterId: owner.id,
    });
    createWorkflow(db, project.id, { names: ['To do', 'Done'] });
    grantRole(db, project.id, owner.id, 'admin');
    grantRole(db, project.id, maya.id, 'user');
    return project;
  }

  it('requires acknowledgement for inherit -> custom and then blocks inherited access', async () => {
    const project = makeInheritProject('Ack project');
    // An account that only inherits from Root (no explicit project grant).
    const inheritor = await createUser(db, { username: 'switch-inheritor', appRole: 'user' });
    grantRole(db, rootId, inheritor.id, 'user');
    expect(canReadProject(loadAccessContext(db, actor(inheritor)), project.id)).toBe(true);

    const unack = expectDomainError(() =>
      applyMemberChanges(db, project.id, [], { acknowledged: false, actor: actorOwner(), access: 'custom' }),
    );
    expect(unack.status).toBe(409);
    expect(unack.code).toBe('acknowledgement_required');
    expect(getProjectAccessMode(db, project.id)).toBe('inherit');

    const applied = applyMemberChanges(db, project.id, [], {
      acknowledged: true,
      actor: actorOwner(),
      access: 'custom',
    });
    expect(applied.access).toBe('custom');
    expect(getProjectAccessMode(db, project.id)).toBe('custom');
    expect(canReadProject(loadAccessContext(db, actor(inheritor)), project.id)).toBe(false);
    // An explicit project grant still works inside the custom boundary.
    expect(canReadProject(loadAccessContext(db, actor(maya)), project.id)).toBe(true);
  });

  it('allows custom -> inherit without acknowledgement and restores inheritance', async () => {
    const project = makeInheritProject('Back to inherit');
    setAccess(db, project.id, 'custom');
    removeGrant(db, project.id, maya.id);
    expect(canReadProject(loadAccessContext(db, actor(maya)), project.id)).toBe(false);
    const applied = applyMemberChanges(db, project.id, [], {
      acknowledged: false,
      actor: actorOwner(),
      access: 'inherit',
    });
    expect(applied.access).toBe('inherit');
    expect(canReadProject(loadAccessContext(db, actor(maya)), project.id)).toBe(true);
    void project;
  });

  it('never lets Root become inherit', () => {
    const error = expectDomainError(() =>
      applyMemberChanges(db, rootId, [], { acknowledged: true, actor: actorOwner(), access: 'inherit' }),
    );
    expect(error.status).toBe(422);
    expect(getProjectAccessMode(db, rootId)).toBe('custom');
    // The project settings route cannot do it either.
    const settingsError = expectDomainError(() =>
      updateProjectSettings(db, actorOwner(), rootId, { access: 'inherit' }),
    );
    expect(settingsError.status).toBe(422);
  });

  it('rejects switching to custom when the subtree would lose its last Admin', () => {
    // Grandparent has the only effective Admin; its child inherits and owns a
    // descendant. Switching the inherited child to custom drops both.
    const grandparent = createProject(db, {
      title: 'Admin grandparent',
      parentId: rootId,
      reporterId: owner.id,
    });
    grantRole(db, grandparent.id, owner.id, 'admin');
    createWorkflow(db, grandparent.id, { names: ['To do', 'Done'] });
    const inherited = createProject(db, {
      title: 'Inherited middle',
      parentId: grandparent.id,
      reporterId: owner.id,
    });
    createWorkflow(db, inherited.id, { names: ['To do', 'Done'] });
    const descendant = createProject(db, {
      title: 'Descendant of middle',
      parentId: inherited.id,
      reporterId: owner.id,
    });
    const error = expectDomainError(() =>
      applyMemberChanges(db, inherited.id, [], {
        acknowledged: true,
        actor: actorOwner(),
        access: 'custom',
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('last_admin');
    expect(error.message).toContain('Inherited middle');
    expect(error.message).toContain('Descendant of middle');
    expect(getProjectAccessMode(db, inherited.id)).toBe('inherit');

    // Giving the middle its own Admin makes the switch valid (with ack).
    grantRole(db, inherited.id, owner.id, 'admin');
    const applied = applyMemberChanges(db, inherited.id, [], {
      acknowledged: true,
      actor: actorOwner(),
      access: 'custom',
    });
    expect(applied.access).toBe('custom');
    // Descendants inherit the custom parent's explicit Admin grant.
    expect(canAdminProject(loadAccessContext(db, actorOwner()), descendant.id)).toBe(true);
  });

  it('cascades reductions over custom descendants but never propagates increases', () => {
    const project = makeInheritProject('Cascade project');
    grantRole(db, project.id, maya.id, 'admin');
    const customChild = createProject(db, {
      title: 'Custom cascade child',
      parentId: project.id,
      reporterId: owner.id,
      settings: { access: 'custom' },
    });
    createWorkflow(db, customChild.id, { names: ['To do', 'Done'] });
    grantRole(db, customChild.id, owner.id, 'admin');
    grantRole(db, customChild.id, maya.id, 'admin');

    // Bring maya's project grant back to user with acknowledgement: the custom
    // descendant's admin grant is overridden to user (owner Admin remains).
    const reduced = applyMemberChanges(db, project.id, [{ userId: maya.id, role: 'user' }], {
      acknowledged: true,
      actor: actorOwner(),
    });
    expect(reduced.cascadedProjects).toBeGreaterThanOrEqual(1);
    const cascaded = db
      .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
      .get(customChild.id, maya.id) as { role: string };
    expect(cascaded.role).toBe('user');

    // Increase on the parent does not propagate into the custom descendant.
    applyMemberChanges(db, project.id, [{ userId: maya.id, role: 'admin' }], {
      acknowledged: true,
      actor: actorOwner(),
    });
    const afterIncrease = db
      .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
      .get(customChild.id, maya.id) as { role: string };
    expect(afterIncrease.role).toBe('user');
  });
});
