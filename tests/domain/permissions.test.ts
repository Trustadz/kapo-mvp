import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  accessibleAncestors,
  applyMemberChanges,
  canAdminProject,
  canEditProject,
  canReadProject,
  descendantIdsOf,
  DomainError,
  effectiveRoleFor,
  getRole,
  isActiveProject,
  isTrashedProject,
  loadAccessContext,
  loadGrantMap,
  loadProjectTree,
  loadAccessUsers,
  loadUsernames,
  planMemberUpdate,
  readableChildIds,
  readableDescendantIds,
  type AccessUser,
  type GrantMap,
  type ProjectTree,
} from '@/server/domain/permissions';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject,
  createRoot,
  createUser,
  createWorkflow,
  grantRole,
  type FixtureHousehold,
} from '../helpers/fixtures';

/**
 * Permission engine (build-spec §6 rules 2–3, product.md §6).
 *
 * Covers inheritance, Root fallbacks, viewer read-only, archive visibility,
 * explicit descendant grants, reduction cascade, increase non-propagation and
 * last-admin validation for both projects and Root.
 */

function makeUser(id: string, appRole: AccessUser['appRole'], showArchived = false): AccessUser {
  return { id, appRole, showArchived };
}

function makeTree(entries: Array<[id: string, parentId: string | null, title: string]>): ProjectTree {
  return new Map(
    entries.map(([id, parentId, title]) => [id, { id, parentId, title }]),
  );
}

function makeGrants(
  entries: Array<[projectId: string, grants: Record<string, 'admin' | 'user' | 'viewer'>]>,
): GrantMap {
  return new Map(
    entries.map(([projectId, grants]) => [projectId, new Map(Object.entries(grants))]),
  );
}

const USERS = [
  { id: 'admin-user', appRole: 'admin' as const },
  { id: 'maya', appRole: 'user' as const },
  { id: 'jules', appRole: 'user' as const },
  { id: 'alex', appRole: 'viewer' as const },
];

describe('effectiveRoleFor (pure)', () => {
  const tree = makeTree([
    ['root', null, 'Root'],
    ['home', 'root', 'Home'],
    ['renovate', 'home', 'Renovate'],
    ['contractor', 'renovate', 'Find contractor'],
    ['private', 'home', 'Private'],
  ]);

  it('uses the nearest explicit grant walking up the tree', () => {
    const grants = makeGrants([
      ['root', { maya: 'user' }],
      ['home', { maya: 'viewer' }],
      ['renovate', { maya: 'admin' }],
    ]);
    const maya = makeUser('maya', 'user');
    expect(effectiveRoleFor(tree, grants, maya, 'root')).toBe('user');
    expect(effectiveRoleFor(tree, grants, maya, 'home')).toBe('viewer');
    expect(effectiveRoleFor(tree, grants, maya, 'renovate')).toBe('admin');
    expect(effectiveRoleFor(tree, grants, maya, 'contractor')).toBe('admin');
    // No grant anywhere below home: inherits home's viewer.
    expect(effectiveRoleFor(tree, grants, maya, 'private')).toBe('viewer');
  });

  it('maps an application Admin to Root only, never downstream implicitly', () => {
    const grants = makeGrants([]);
    const admin = makeUser('admin-user', 'admin');
    expect(effectiveRoleFor(tree, grants, admin, 'root')).toBe('admin');
    expect(effectiveRoleFor(tree, grants, admin, 'home')).toBeNull();
    expect(effectiveRoleFor(tree, grants, admin, 'contractor')).toBeNull();
  });

  it('gives application Users no implicit access anywhere', () => {
    const grants = makeGrants([]);
    expect(effectiveRoleFor(tree, grants, makeUser('maya', 'user'), 'root')).toBeNull();
    expect(effectiveRoleFor(tree, grants, makeUser('maya', 'user'), 'home')).toBeNull();
  });

  it('honours a direct grant on a descendant whose parent is inaccessible', () => {
    const grants = makeGrants([['contractor', { maya: 'admin' }]]);
    const maya = makeUser('maya', 'user');
    expect(effectiveRoleFor(tree, grants, maya, 'home')).toBeNull();
    expect(effectiveRoleFor(tree, grants, maya, 'contractor')).toBe('admin');
  });

  it('returns null for unknown projects', () => {
    expect(effectiveRoleFor(tree, makeGrants([]), makeUser('maya', 'user'), 'ghost')).toBeNull();
  });

  it('computes descendant ids depth-first', () => {
    expect(descendantIdsOf(tree, 'root')).toEqual([
      'home',
      'renovate',
      'contractor',
      'private',
    ]);
  });
});

describe('planMemberUpdate (pure)', () => {
  const tree = makeTree([
    ['root', null, 'Root'],
    ['home', 'root', 'Home improvement'],
    ['renovate', 'home', 'Renovate basement'],
    ['contractor', 'renovate', 'Find contractor'],
    ['garden', 'home', 'Garden beds'],
  ]);
  const usernames = new Map([
    ['admin-user', 'admin'],
    ['maya', 'maya'],
    ['jules', 'jules'],
    ['alex', 'alex'],
  ]);

  function baseGrants(): GrantMap {
    return makeGrants([
      ['root', { maya: 'user', jules: 'user', alex: 'viewer' }],
      ['home', { 'admin-user': 'admin', maya: 'admin', jules: 'user' }],
      ['renovate', { maya: 'admin', jules: 'user' }],
      ['contractor', { maya: 'admin', jules: 'viewer' }],
    ]);
  }

  it('cascades a reduction over existing descendant grants', () => {
    const plan = planMemberUpdate(
      tree,
      baseGrants(),
      USERS,
      'home',
      [{ userId: 'maya', role: 'user' }],
      usernames,
    );
    expect(plan.lastAdminViolations).toEqual([]);
    expect(plan.cascades).toHaveLength(1);
    expect(plan.cascades[0]?.username).toBe('maya');
    expect(plan.cascades[0]?.entries.map((entry) => [entry.title, entry.from, entry.to])).toEqual([
      ['Renovate basement', 'admin', 'user'],
      ['Find contractor', 'admin', 'user'],
    ]);
    expect(plan.nextGrants.get('renovate')?.get('maya')).toBe('user');
    expect(plan.nextGrants.get('contractor')?.get('maya')).toBe('user');
  });

  it('cascades a removal down to the role inherited from above', () => {
    const plan = planMemberUpdate(
      tree,
      baseGrants(),
      USERS,
      'home',
      [{ userId: 'maya', role: null }],
      usernames,
    );
    // maya still inherits Root's user grant, so the effective ceiling is user.
    expect(plan.cascades[0]?.entries.map((entry) => [entry.projectId, entry.to])).toEqual([
      ['renovate', 'user'],
      ['contractor', 'user'],
    ]);
    expect(plan.nextGrants.get('home')?.has('maya')).toBe(false);
    expect(plan.nextGrants.get('renovate')?.get('maya')).toBe('user');
    expect(plan.nextGrants.get('contractor')?.get('maya')).toBe('user');
  });

  it('cascades a removal to no access when nothing is inherited', () => {
    const grants = makeGrants([
      ['root', { maya: 'user' }],
      ['home', { 'admin-user': 'admin', jules: 'admin' }],
      ['renovate', { 'admin-user': 'admin', jules: 'admin' }],
      ['contractor', { jules: 'admin' }],
    ]);
    const plan = planMemberUpdate(
      tree,
      grants,
      USERS,
      'home',
      [{ userId: 'jules', role: null }],
      usernames,
    );
    expect(plan.cascades[0]?.entries.map((entry) => [entry.projectId, entry.to])).toEqual([
      ['renovate', null],
      ['contractor', null],
    ]);
    expect(plan.nextGrants.get('renovate')?.has('jules') ?? false).toBe(false);
    expect(plan.nextGrants.get('contractor')?.has('jules') ?? false).toBe(false);
  });

  it('never propagates increases to descendants', () => {
    const grants = baseGrants();
    const plan = planMemberUpdate(
      tree,
      grants,
      USERS,
      'renovate',
      [{ userId: 'jules', role: 'admin' }],
      usernames,
    );
    expect(plan.cascades).toEqual([]);
    expect(plan.nextGrants.get('renovate')?.get('jules')).toBe('admin');
    // Explicit descendant grants are untouched.
    expect(plan.nextGrants.get('contractor')?.get('jules')).toBe('viewer');
  });

  it('rejects a change that would leave a project without an Admin', () => {
    const grants = makeGrants([
      ['root', { maya: 'user' }],
      ['home', { maya: 'user' }],
      ['renovate', { maya: 'admin' }],
    ]);
    const plan = planMemberUpdate(
      tree,
      grants,
      USERS,
      'renovate',
      [{ userId: 'maya', role: null }],
      usernames,
    );
    expect(plan.lastAdminViolations.map((entry) => entry.title)).toContain('Renovate basement');
  });

  it('rejects a change that would leave Root without an application Admin', () => {
    const grants = makeGrants([
      ['root', { 'admin-user': 'admin', maya: 'user' }],
      ['home', { 'admin-user': 'admin', maya: 'admin' }],
    ]);
    const plan = planMemberUpdate(
      tree,
      grants,
      USERS,
      'root',
      [{ userId: 'admin-user', role: 'user' }],
      usernames,
    );
    expect(plan.rootAdminViolation).toBe(true);
  });

  it('allows lowering an application Admin when another app Admin remains', () => {
    const users = [
      { id: 'admin-user', appRole: 'admin' as const },
      { id: 'second-admin', appRole: 'admin' as const },
      { id: 'maya', appRole: 'user' as const },
    ];
    const plan = planMemberUpdate(
      tree,
      baseGrants(),
      users,
      'root',
      [{ userId: 'admin-user', role: 'user' }],
      usernames,
    );
    expect(plan.rootAdminViolation).toBe(false);
    expect(plan.lastAdminViolations).toEqual([]);
  });

  it('throws 404 for an unknown project', () => {
    try {
      planMemberUpdate(tree, baseGrants(), USERS, 'ghost', [], usernames);
      expect.unreachable('expected DomainError');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).status).toBe(404);
    }
  });
});

describe('permission engine against SQLite', () => {
  let test: TestDatabase;
  let db: BetterSqliteDatabase;
  let household: FixtureHousehold;

  beforeAll(async () => {
    test = createTestDatabase({ label: 'permissions' });
    db = test.db;
    household = await buildHouseholdFixture(db);
  });

  afterAll(() => {
    test.cleanup();
  });

  function contextFor(userId: string, appRole: AccessUser['appRole'], showArchived = false) {
    return loadAccessContext(db, makeUser(userId, appRole, showArchived));
  }

  it('resolves the seeded household grants', () => {
    const admin = contextFor(household.admin.id, 'admin');
    expect(getRole(admin, household.root.id)).toBe('admin');
    expect(getRole(admin, household.home.id)).toBe('admin');
    expect(getRole(admin, household.household.id)).toBeNull();
  });

  it('lets an application Admin administer Root but not bypass project grants', () => {
    // The fixture gives admin admin on Root's own grant too; use a second
    // application Admin with no grants to prove the fallback is Root-only.
    const outsider = { id: 'outsider', appRole: 'admin' as const, showArchived: false };
    const ctx = loadAccessContext(db, outsider);
    expect(canReadProject(ctx, household.root.id)).toBe(true);
    expect(canAdminProject(ctx, household.root.id)).toBe(true);
    expect(canReadProject(ctx, household.home.id)).toBe(false);
    expect(canEditProject(ctx, household.home.id)).toBe(false);
  });

  it('applies inherited project roles to descendants', () => {
    const maya = contextFor(household.maya.id, 'user');
    expect(canEditProject(maya, household.root.id)).toBe(true);
    expect(canEditProject(maya, household.home.id)).toBe(true);
    // maya is explicit admin on Renovate basement.
    expect(canAdminProject(maya, household.renovate.id)).toBe(true);
    expect(canAdminProject(maya, household.contractor.id)).toBe(true);
    // No grant on Paint hallway → inherits Home improvement's user role.
    expect(canEditProject(maya, household.paintHallway.id)).toBe(true);
    expect(canAdminProject(maya, household.paintHallway.id)).toBe(false);
  });

  it('keeps application Viewers read-only even with an admin project grant', async () => {
    const viewer = await createUser(db, { username: 'viewer-admin-grant' });
    grantRole(db, household.root.id, viewer.id, 'viewer');
    grantRole(db, household.home.id, viewer.id, 'admin');
    const ctx = loadAccessContext(db, { id: viewer.id, appRole: 'viewer', showArchived: false });
    expect(canReadProject(ctx, household.home.id)).toBe(true);
    expect(canEditProject(ctx, household.home.id)).toBe(false);
    expect(canAdminProject(ctx, household.home.id)).toBe(false);
  });

  it('exposes accessible ancestors and readable children/descendants', () => {
    const maya = contextFor(household.maya.id, 'user');
    expect(accessibleAncestors(maya, household.contractor.id).map((entry) => entry.title)).toEqual([
      'Root',
      'Home improvement',
      'Renovate basement',
    ]);
    expect(readableChildIds(maya, household.home.id).sort()).toEqual(
      [household.renovate.id, household.paintHallway.id].sort(),
    );
    expect(readableDescendantIds(maya, household.home.id).sort()).toEqual(
      [household.renovate.id, household.paintHallway.id, household.contractor.id].sort(),
    );
  });

  it('hides an archived subtree unless show_archived is on', () => {
    const archived = createProject(db, {
      title: 'Archived parent',
      parentId: household.root.id,
      reporterId: household.admin.id,
      archived: true,
      indexSearch: false,
    });
    createWorkflow(db, archived.id, { names: ['To do', 'Done'] });
    const child = createProject(db, {
      title: 'Child of archived',
      parentId: archived.id,
      reporterId: household.admin.id,
      indexSearch: false,
    });
    grantRole(db, archived.id, household.admin.id, 'admin');
    grantRole(db, child.id, household.admin.id, 'admin');

    const hidden = contextFor(household.admin.id, 'admin', false);
    expect(isActiveProject(hidden, archived.id)).toBe(false);
    expect(isActiveProject(hidden, child.id)).toBe(false);

    const shown = contextFor(household.admin.id, 'admin', true);
    expect(isActiveProject(shown, archived.id)).toBe(true);
    expect(isActiveProject(shown, child.id)).toBe(true);
    // The descendant's own archived flag is untouched.
    const row = db.prepare('SELECT archived FROM projects WHERE id = ?').get(child.id) as {
      archived: number;
    };
    expect(row.archived).toBe(0);
  });

  it('excludes trashed projects from active reads', async () => {
    const trashed = createProject(db, {
      title: 'Trashed project',
      parentId: household.root.id,
      reporterId: household.admin.id,
      trashedAt: new Date().toISOString(),
      indexSearch: false,
    });
    grantRole(db, trashed.id, household.admin.id, 'admin');
    const ctx = contextFor(household.admin.id, 'admin');
    expect(canReadProject(ctx, trashed.id)).toBe(true);
    expect(isTrashedProject(ctx, trashed.id)).toBe(true);
    expect(isActiveProject(ctx, trashed.id)).toBe(false);
  });
});

describe('applyMemberChanges', () => {
  let test: TestDatabase;
  let db: BetterSqliteDatabase;
  let admin: { id: string };
  let maya: { id: string };
  let rootId: string;
  let homeId: string;
  let renovateId: string;

  function grantBaseline(options: { homeMaya?: 'admin' | 'user' | null } = {}) {
    db.prepare('DELETE FROM project_roles').run();
    // Root grants maya user so children inherit something; Root keeps admin
    // through the application-admin fallback for `admin`.
    grantRole(db, rootId, maya.id, 'user');
    grantRole(db, homeId, admin.id, 'admin');
    const homeMaya = options.homeMaya === undefined ? 'admin' : options.homeMaya;
    if (homeMaya) grantRole(db, homeId, maya.id, homeMaya);
    grantRole(db, renovateId, maya.id, 'admin');
  }

  beforeAll(async () => {
    test = createTestDatabase({ label: 'member-changes' });
    db = test.db;
    admin = await createUser(db, { username: 'admin', appRole: 'admin' });
    maya = await createUser(db, { username: 'maya', appRole: 'user' });
    const root = createRoot(db, admin.id);
    rootId = root.id;
    const home = createProject(db, {
      title: 'Home improvement',
      parentId: rootId,
      reporterId: admin.id,
    });
    homeId = home.id;
    createWorkflow(db, homeId, { names: ['To do', 'Done'] });
    const renovate = createProject(db, {
      title: 'Renovate basement',
      parentId: homeId,
      reporterId: admin.id,
    });
    renovateId = renovate.id;
    createWorkflow(db, renovateId, { names: ['To do', 'Done'] });
  });

  beforeEach(() => {
    db.prepare('DELETE FROM project_roles').run();
  });

  afterAll(() => {
    test.cleanup();
  });

  function actor() {
    return {
      id: admin.id,
      appRole: 'admin' as const,
      showArchived: false,
    };
  }

  function roleOf(projectId: string, userId: string): string | null {
    const row = db
      .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
      .get(projectId, userId) as { role: string } | undefined;
    return row?.role ?? null;
  }

  it('requires acknowledgement before cascading a reduction', () => {
    grantBaseline();
    const error = (() => {
      try {
        applyMemberChanges(db, homeId, [{ userId: maya.id, role: 'user' }], {
          acknowledged: false,
          actor: actor(),
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error).toBeInstanceOf(DomainError);
    expect(error?.status).toBe(409);
    expect(error?.message).toMatch(/confirm/i);
    expect(roleOf(renovateId, maya.id)).toBe('admin');
  });

  it('applies the reduction and cascade once acknowledged', () => {
    grantBaseline();
    const result = applyMemberChanges(db, homeId, [{ userId: maya.id, role: 'user' }], {
      acknowledged: true,
      actor: actor(),
    });
    expect(result.cascadedProjects).toBe(1);
    expect(roleOf(homeId, maya.id)).toBe('user');
    expect(roleOf(renovateId, maya.id)).toBe('user');
  });

  it('refuses to strip the last project Admin', () => {
    grantBaseline({ homeMaya: 'user' });
    const error = (() => {
      try {
        applyMemberChanges(db, homeId, [{ userId: admin.id, role: null }], {
          acknowledged: true,
          actor: actor(),
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error).toBeInstanceOf(DomainError);
    expect(error?.status).toBe(409);
    expect(error?.code).toBe('last_admin');
    expect(error?.message).toMatch(/without an Admin/);
    // Nothing was written.
    expect(roleOf(homeId, admin.id)).toBe('admin');
  });

  it('refuses to remove the last application Admin from Root', () => {
    grantBaseline({ homeMaya: 'user' });
    const error = (() => {
      try {
        applyMemberChanges(db, rootId, [{ userId: admin.id, role: 'user' }], {
          acknowledged: true,
          actor: actor(),
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error).toBeInstanceOf(DomainError);
    expect(error?.status).toBe(409);
    expect(error?.code).toBe('last_admin');
  });

  it('returns 403 for a non-Admin actor and application Viewers', async () => {
    grantBaseline({ homeMaya: null });
    const nonAdminError = (() => {
      try {
        applyMemberChanges(db, homeId, [{ userId: admin.id, role: 'user' }], {
          acknowledged: true,
          actor: { id: maya.id, appRole: 'user', showArchived: false },
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(nonAdminError?.status).toBe(403);

    const viewer = await createUser(db, { username: 'viewer-actor' });
    grantRole(db, homeId, viewer.id, 'admin');
    const viewerError = (() => {
      try {
        applyMemberChanges(db, homeId, [{ userId: admin.id, role: 'user' }], {
          acknowledged: true,
          actor: { id: viewer.id, appRole: 'viewer', showArchived: false },
        });
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(viewerError?.status).toBe(403);
  });

  it('rejects duplicate entries for the same account', () => {
    grantBaseline();
    const error = (() => {
      try {
        applyMemberChanges(
          db,
          homeId,
          [
            { userId: maya.id, role: 'admin' },
            { userId: maya.id, role: 'user' },
          ],
          { acknowledged: true, actor: actor() },
        );
        return null;
      } catch (caught) {
        return caught as DomainError;
      }
    })();
    expect(error?.status).toBe(422);
  });

  it('loads trees, grants, users and usernames consistently', () => {
    grantBaseline();
    const tree = loadProjectTree(db);
    expect(tree.get(rootId)?.parentId).toBeNull();
    expect(tree.get(homeId)?.parentId).toBe(rootId);
    const grants = loadGrantMap(db);
    expect(grants.get(homeId)?.get(maya.id)).toBe('admin');
    const users = loadAccessUsers(db);
    expect(users.map((user) => user.id)).toEqual(expect.arrayContaining([admin.id, maya.id]));
    const names = loadUsernames(db);
    expect(names.get(maya.id)).toBe('maya');
  });
});
