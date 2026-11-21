import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { getProjectPageData, createProject as createDomainProject, updateProjectSettings } from '@/server/domain/projects';
import { updateProjectAddons, resolveProjectAddons, resolveLegacyProjectAddons, syncAddonRegistry } from '@/server/domain/project-addons';
import {
  INHERITANCE_SNAPSHOT_SETTING_KEY,
  snapshotInheritanceOnce,
} from '@/server/domain/inheritance-snapshot';
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
 * Copy-on-create settings migration.
 *
 * Before this change layout templates and add-on configuration resolved live
 * from the parent chain. The upgrade pass must persist exactly what each
 * project showed before, once, and never touch access inheritance.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;
let root: { id: string };
let home: FixtureProject;
let kitchen: FixtureProject;

const ADMIN_ACTOR = () => ({ id: admin.id, appRole: admin.appRole, showArchived: false });

function rawSettings(projectId: string): Record<string, unknown> {
  const row = db.prepare('SELECT settings FROM projects WHERE id = ?').get(projectId) as {
    settings: string;
  };
  return JSON.parse(row.settings) as Record<string, unknown>;
}

function markerValue(): string | undefined {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(INHERITANCE_SNAPSHOT_SETTING_KEY) as { value: string } | undefined;
  return row?.value;
}

function writeLegacySettings(projectId: string, settings: Record<string, unknown>): void {
  const raw = rawSettings(projectId);
  db.prepare('UPDATE projects SET settings = ? WHERE id = ?').run(
    JSON.stringify({ ...raw, ...settings }),
    projectId,
  );
}

function settingsSnapshot(): Record<string, string> {
  const rows = db
    .prepare('SELECT id, settings FROM projects ORDER BY seq ASC')
    .all() as Array<{ id: string; settings: string }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.settings]));
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'inheritance-snapshot' });
  db = test.db;
  admin = await createUser(db, { username: 'snapshot-admin', appRole: 'admin' });
  root = createRoot(db, admin.id);
  grantRole(db, root.id, admin.id, 'admin');

  home = createProject(db, {
    title: 'Home',
    parentId: root.id,
    reporterId: admin.id,
  });
  grantRole(db, home.id, admin.id, 'admin');
  createWorkflow(db, home.id, { names: ['To do', 'Done'] });

  kitchen = createProject(db, {
    title: 'Kitchen',
    parentId: home.id,
    reporterId: admin.id,
  });
  grantRole(db, kitchen.id, admin.id, 'admin');
  createWorkflow(db, kitchen.id, { names: ['To do', 'Done'] });

  // Registry rows need to exist for the configured mode lookup.
  syncAddonRegistry(db);

  // Legacy layout inheritance: Root and Home both define their own template;
  // Home still inherits Root's template visually, while Kitchen inherits
  // Home's *pre-upgrade* own template. The snapshot must not let Home's write
  // change what Kitchen saw.
  writeLegacySettings(root.id, {
    inherit_layout: true,
    layout_template: { main: ['reporter'], sidebar: ['status'] },
  });
  writeLegacySettings(home.id, {
    inherit_layout: true,
    layout_template: { main: ['parent'], sidebar: ['reporter'] },
  });
  writeLegacySettings(kitchen.id, {
    inherit_layout: true,
    layout_template: null,
  });

  // Legacy add-on inheritance plus unknown identifiers/keys that must survive.
  writeLegacySettings(root.id, {
    addons: {
      assignee: { enabled: true, settings: { show_avatar: false, inherited_only: 1 } },
    },
  });
  writeLegacySettings(home.id, {
    addons: {
      assignee: {
        enabled: true,
        inheritFromParent: true,
        settings: { show_avatar: true },
      },
      legacy: { enabled: true, custom: 'keep' },
    },
  });
  writeLegacySettings(kitchen.id, {
    addons: {
      assignee: {
        inheritFromParent: true,
        settings: { custom_key: 'keep' },
      },
      retired: { enabled: true, custom: 'keep' },
    },
  });
});

afterAll(() => {
  test.cleanup();
});

describe('one-time inheritance snapshot', () => {
  it('writes the pre-upgrade effective layout and add-on config exactly once', () => {
    expect(markerValue()).toBeUndefined();

    // Capture what each project effectively saw under live inheritance.
    const rootAddonsBefore = resolveLegacyProjectAddons(db, root.id);
    const homeAddonsBefore = resolveLegacyProjectAddons(db, home.id);
    const kitchenAddonsBefore = resolveLegacyProjectAddons(db, kitchen.id);
    const accessBefore = {
      root: rawSettings(root.id).access,
      home: rawSettings(home.id).access,
      kitchen: rawSettings(kitchen.id).access,
    };
    const rolesBefore = db
      .prepare('SELECT project_id, user_id, role FROM project_roles ORDER BY project_id, user_id')
      .all();

    const result = snapshotInheritanceOnce(db);
    expect(result).toEqual({
      alreadySnapshotted: false,
      projects: 3,
      addons: 1,
    });
    expect(markerValue()).toBe('1');

    // Layout is now explicit and matches the old effective layout.
    expect(rawSettings(root.id).inherit_layout).toBe(false);
    expect(rawSettings(root.id).layout_template).toEqual({
      main: ['reporter'],
      sidebar: ['status'],
    });
    // Home used to resolve Root's template because it still inherited.
    expect(rawSettings(home.id).inherit_layout).toBe(false);
    expect(rawSettings(home.id).layout_template).toEqual({
      main: ['reporter'],
      sidebar: ['status'],
    });
    // Kitchen used Home's pre-upgrade own template, not the freshly written one.
    expect(rawSettings(kitchen.id).inherit_layout).toBe(false);
    expect(rawSettings(kitchen.id).layout_template).toEqual({
      main: ['parent'],
      sidebar: ['reporter'],
    });

    // Add-ons are explicit per-project snapshots of the old resolved values.
    const rootAddons = resolveProjectAddons(db, root.id);
    const homeAddons = resolveProjectAddons(db, home.id);
    const kitchenAddons = resolveProjectAddons(db, kitchen.id);
    expect(rootAddons[0]).toEqual(
      expect.objectContaining({
        identifier: 'assignee',
        available: rootAddonsBefore[0]!.available,
        inherited: false,
        settings: rootAddonsBefore[0]!.settings,
      }),
    );
    expect(homeAddons[0]).toEqual(
      expect.objectContaining({
        available: homeAddonsBefore[0]!.available,
        inherited: false,
        settings: homeAddonsBefore[0]!.settings,
      }),
    );
    expect(kitchenAddons[0]).toEqual(
      expect.objectContaining({
        available: kitchenAddonsBefore[0]!.available,
        inherited: false,
        settings: kitchenAddonsBefore[0]!.settings,
      }),
    );
    expect(kitchenAddons[0]!.settings).toEqual({
      show_avatar: true,
      inherited_only: 1,
      custom_key: 'keep',
    });

    const kitchenStored = rawSettings(kitchen.id) as {
      addons: Record<string, Record<string, unknown>>;
    };
    expect(kitchenStored.addons.assignee).toEqual({
      inheritFromParent: false,
      enabled: true,
      settings: {
        show_avatar: true,
        inherited_only: 1,
        custom_key: 'keep',
      },
    });
    // Unknown identifiers and entry keys are preserved.
    expect(kitchenStored.addons.retired).toEqual({ enabled: true, custom: 'keep' });
    expect((rawSettings(home.id).addons as Record<string, unknown>).legacy).toEqual({
      enabled: true,
      custom: 'keep',
    });

    // Access inheritance is out of scope and must be untouched.
    expect(rawSettings(root.id).access).toBe(accessBefore.root);
    expect(rawSettings(home.id).access).toBe(accessBefore.home);
    expect(rawSettings(kitchen.id).access).toBe(accessBefore.kitchen);
    expect(
      db.prepare('SELECT project_id, user_id, role FROM project_roles ORDER BY project_id, user_id').all(),
    ).toEqual(rolesBefore);

    // The page data now reads each project's own snapshot.
    expect(getProjectPageData(db, ADMIN_ACTOR(), kitchen.id)!.layout).toEqual({
      main: ['parent'],
      sidebar: ['reporter'],
    });
  });

  it('is a no-op on the second run', () => {
    const before = settingsSnapshot();
    const result = snapshotInheritanceOnce(db);
    expect(result).toEqual({ alreadySnapshotted: true, projects: 0, addons: 0 });
    expect(settingsSnapshot()).toEqual(before);
  });

  it('does not mark the snapshot complete when the transaction fails', () => {
    db.prepare('DELETE FROM settings WHERE key = ?').run(INHERITANCE_SNAPSHOT_SETTING_KEY);
    db.exec(
      `CREATE TRIGGER fail_inheritance_snapshot
       BEFORE UPDATE ON projects
       BEGIN
         SELECT RAISE(ABORT, 'snapshot failure');
       END`,
    );
    const before = settingsSnapshot();
    expect(() => snapshotInheritanceOnce(db)).toThrow(/snapshot failure/);
    expect(markerValue()).toBeUndefined();
    expect(settingsSnapshot()).toEqual(before);
    db.exec('DROP TRIGGER fail_inheritance_snapshot');
  });
});

describe('copy on create', () => {
  it('copies layout and add-on configuration from the parent exactly once', () => {
    const parent = createProject(db, {
      title: 'Template parent',
      parentId: root.id,
      reporterId: admin.id,
    });
    grantRole(db, parent.id, admin.id, 'admin');
    createWorkflow(db, parent.id, { names: ['To do', 'Done'] });

    updateProjectSettings(db, ADMIN_ACTOR(), parent.id, {
      layout_template: { main: ['projectId', 'reporter'], sidebar: ['status'] },
      inherit_layout: false,
    });
    updateProjectAddons(db, ADMIN_ACTOR(), parent.id, {
      assignee: { enabled: true, settings: { show_avatar: false, inherited_only: 1 } },
    });

    const child = createDomainProject(db, ADMIN_ACTOR(), {
      parentId: parent.id,
      title: 'Copied child',
    });
    const childSettings = rawSettings(child.id);
    expect(childSettings.inherit_layout).toBe(false);
    expect(childSettings.layout_template).toEqual({
      main: ['projectId', 'reporter'],
      sidebar: ['status'],
    });
    expect((childSettings.addons as Record<string, unknown>).assignee).toEqual({
      enabled: true,
      inheritFromParent: false,
      settings: { show_avatar: false, inherited_only: 1 },
    });
    // Access inheritance is unchanged: the child copies grants live.
    expect(childSettings.access).toBe('inherit');
    const grants = db
      .prepare('SELECT user_id, role FROM project_roles WHERE project_id = ?')
      .all(child.id) as Array<{ user_id: string; role: string }>;
    expect(grants).toEqual([{ user_id: admin.id, role: 'admin' }]);

    // Later parent edits do not reach the existing child.
    updateProjectSettings(db, ADMIN_ACTOR(), parent.id, {
      layout_template: { main: ['updated'], sidebar: ['parent'] },
    });
    updateProjectAddons(db, ADMIN_ACTOR(), parent.id, {
      assignee: { enabled: true, settings: { show_avatar: true } },
    });

    expect(getProjectPageData(db, ADMIN_ACTOR(), child.id)!.layout).toEqual({
      main: ['projectId', 'reporter'],
      sidebar: ['status'],
    });
    expect(resolveProjectAddons(db, child.id)[0]).toEqual(
      expect.objectContaining({
        available: true,
        inherited: false,
        settings: { show_avatar: false, inherited_only: 1 },
      }),
    );

    // A project with no explicit template copies the default.
    const plainParent = createProject(db, {
      title: 'Plain parent',
      parentId: root.id,
      reporterId: admin.id,
    });
    grantRole(db, plainParent.id, admin.id, 'admin');
    createWorkflow(db, plainParent.id, { names: ['To do', 'Done'] });
    const plainChild = createDomainProject(db, ADMIN_ACTOR(), {
      parentId: plainParent.id,
      title: 'Plain child',
    });
    expect(rawSettings(plainChild.id).layout_template).toEqual({
      main: [],
      sidebar: ['status', 'reporter'],
    });
  });
});
