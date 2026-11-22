import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject as createFixtureProject,
  createWorkflow,
  getProjectRow,
  grantRole,
  type FixtureHousehold,
  type FixtureProject,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn, signOut } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';
import { syncAddonRegistry } from '@/server/domain/project-addons';

/**
 * Add-on fields as real layout/view slots (no standalone project-page card).
 *
 * Covers persistence of the opaque `addon:<identifier>:<fieldKey>` refs,
 * availability filtering and the compact card projection used by views.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const projectRoute = await import('@/app/api/projects/[id]/route');
const settingsRoute = await import('@/app/api/projects/[id]/settings/route');

const projectGet = (id: string) => projectRoute.GET(request(`/api/projects/${id}`), params(id));
const settingsPut = (id: string, body: unknown) =>
  settingsRoute.PUT(request(`/api/projects/${id}/settings`, { method: 'PUT', body }), params(id));

const ASSIGNEE_REF = 'addon:assignee:assignee';

interface PagePayload {
  layout: { main: string[]; sidebar: string[] };
  settings: {
    view_fields: Record<string, string[]>;
  };
  children: Array<{
    id: string;
    title: string;
    addonFields?: Array<{
      ref: string;
      identifier: string;
      fieldKey: string;
      addonName: string;
      label: string;
      type: string;
      value: unknown;
      displayValue: string | null;
    }>;
  }>;
  addons: { canEdit: boolean; items: Array<{ identifier: string; values: Record<string, unknown> }> };
}

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

function setAddonMode(identifier: string, mode: string): void {
  db.prepare('UPDATE addons SET mode = ? WHERE identifier = ?').run(mode, identifier);
}

function projectTree(
  title: string,
  options: { childAddonData?: Record<string, unknown> } = {},
): { parent: FixtureProject; child: FixtureProject } {
  const parent = createFixtureProject(db, {
    title: `${title} parent`,
    parentId: household.home.id,
    reporterId: household.admin.id,
    settings: { addons: { assignee: { enabled: true } } },
  });
  createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
  grantRole(db, parent.id, household.admin.id, 'admin');
  grantRole(db, parent.id, household.alex.id, 'viewer');
  const child = createFixtureProject(db, {
    title,
    parentId: parent.id,
    reporterId: household.admin.id,
    addonData: options.childAddonData ?? {},
    // Copy-on-create snapshots the parent's add-on availability. The fixture
    // inserts the child directly, so make the snapshot explicit.
    settings: { addons: { assignee: { enabled: true, inheritFromParent: false } } },
  });
  createWorkflow(db, child.id, { names: ['To do', 'Done'] });
  grantRole(db, child.id, household.admin.id, 'admin');
  grantRole(db, child.id, household.alex.id, 'viewer');
  return { parent, child };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-addon-fields' });
  db = test.db;
  household = await buildHouseholdFixture(db);
  syncAddonRegistry(db);
});

beforeEach(() => {
  resetRequestContext();
  signIn(db, household.admin.id);
  setAddonMode('assignee', 'optional');
});

afterAll(() => {
  test.cleanup();
});

describe('layout and view-field persistence', () => {
  it('stores add-on refs in Details, Properties and view properties', async () => {
    const { parent } = projectTree('Persisted slots');

    const response = await settingsPut(parent.id, {
      layout_template: {
        main: ['projectId', ASSIGNEE_REF, ASSIGNEE_REF],
        sidebar: ['status', ASSIGNEE_REF],
      },
      view_fields: {
        kanban: ['status', ASSIGNEE_REF, ASSIGNEE_REF],
        card: [ASSIGNEE_REF],
        tree: [],
        list: ['id'],
      },
    });
    expect(response.status).toBe(200);
    const saved = await json<{
      settings: {
        layout_template: { main: string[]; sidebar: string[] };
        view_fields: Record<string, string[]>;
      };
    }>(response);
    expect(saved.settings.layout_template).toEqual({
      main: ['projectId', ASSIGNEE_REF],
      sidebar: ['status', ASSIGNEE_REF],
    });
    expect(saved.settings.view_fields).toEqual({
      kanban: ['status', ASSIGNEE_REF],
      card: [ASSIGNEE_REF],
      tree: [],
      list: ['id'],
    });

    // The project page uses the effective layout and filtered view settings.
    const page = await json<PagePayload>(await projectGet(parent.id));
    expect(page.layout).toEqual({
      main: ['projectId', ASSIGNEE_REF],
      sidebar: ['status', ASSIGNEE_REF],
    });
    expect(page.settings.view_fields.kanban).toEqual(['status', ASSIGNEE_REF]);
    expect(page.addons.items.map((item) => item.identifier)).toEqual(['assignee']);
  });
});

describe('compact view projection', () => {
  it('projects only available add-on fields referenced by a view, with labels and values', async () => {
    const { parent, child } = projectTree('View projection', {
      childAddonData: { assignee: { assignee: household.maya.id } },
    });
    await settingsPut(parent.id, {
      view_fields: {
        kanban: [ASSIGNEE_REF],
        card: [],
        tree: [],
        list: [],
      },
    });

    const page = await json<PagePayload>(await projectGet(parent.id));
    const card = page.children.find((entry) => entry.id === child.id);
    expect(card).toBeDefined();
    expect(card?.addonFields).toEqual([
      {
        ref: ASSIGNEE_REF,
        identifier: 'assignee',
        fieldKey: 'assignee',
        addonName: 'Assignee',
        label: 'Assigned to',
        type: 'user',
        value: household.maya.id,
        displayValue: 'Maya',
        avatar: null,
      },
    ]);

    // A field that is not selected in any view is not projected.
    await settingsPut(parent.id, {
      view_fields: { kanban: [], card: [], tree: [], list: [] },
    });
    const withoutSelection = await json<PagePayload>(await projectGet(parent.id));
    expect(withoutSelection.children.find((entry) => entry.id === child.id)?.addonFields).toBe(
      undefined,
    );
  });
});

describe('availability filtering', () => {
  it('hides stale refs when the add-on becomes unavailable but preserves storage', async () => {
    const { parent } = projectTree('Unavailable refs');
    await settingsPut(parent.id, {
      layout_template: { main: [ASSIGNEE_REF], sidebar: [ASSIGNEE_REF] },
      view_fields: { kanban: [ASSIGNEE_REF], card: [], tree: [], list: [] },
    });

    setAddonMode('assignee', 'unavailable');
    const page = await json<PagePayload>(await projectGet(parent.id));
    expect(page.layout).toEqual({ main: [], sidebar: [] });
    expect(page.settings.view_fields.kanban).toEqual([]);
    expect(page.addons.items).toEqual([]);
    expect(page.children[0]?.addonFields).toBeUndefined();

    const stored = JSON.parse(getProjectRow(db, parent.id)!.settings) as {
      layout_template: { main: string[] };
      view_fields: { kanban: string[] };
    };
    expect(stored.layout_template.main).toEqual([ASSIGNEE_REF]);
    expect(stored.view_fields.kanban).toEqual([ASSIGNEE_REF]);

    // Re-enabling restores the same placement without re-saving.
    setAddonMode('assignee', 'optional');
    const restored = await json<PagePayload>(await projectGet(parent.id));
    expect(restored.layout.main).toEqual([ASSIGNEE_REF]);
    expect(restored.settings.view_fields.kanban).toEqual([ASSIGNEE_REF]);
  });

  it('ignores refs to unregistered add-ons without crashing', async () => {
    const { parent } = projectTree('Unregistered refs');
    db.prepare('UPDATE projects SET settings = ? WHERE id = ?').run(
      JSON.stringify({
        ...JSON.parse(getProjectRow(db, parent.id)!.settings),
        layout_template: {
          main: ['projectId', 'addon:missing:field'],
          sidebar: ['status'],
        },
        view_fields: {
          kanban: ['addon:missing:field'],
          card: [],
          tree: [],
          list: [],
        },
      }),
      parent.id,
    );

    const page = await json<PagePayload>(await projectGet(parent.id));
    expect(page.layout).toEqual({ main: ['projectId'], sidebar: ['status'] });
    expect(page.settings.view_fields.kanban).toEqual([]);
    expect(page.addons.items.map((item) => item.identifier)).toEqual(['assignee']);
  });
});

describe('permissions', () => {
  it('keeps values readable for a Viewer but reports no edit access', async () => {
    const { parent, child } = projectTree('Viewer slots', {
      childAddonData: { assignee: { assignee: household.jules.id } },
    });
    await settingsPut(parent.id, {
      view_fields: { kanban: [ASSIGNEE_REF], card: [], tree: [], list: [] },
    });

    signOut();
    signIn(db, household.alex.id);
    const page = await json<PagePayload>(await projectGet(parent.id));
    expect(page.addons.canEdit).toBe(false);
    const card = page.children.find((entry) => entry.id === child.id);
    expect(card?.addonFields?.[0]?.displayValue).toBe('Jules');
  });
});
