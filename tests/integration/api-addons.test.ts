import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject as createFixtureProject,
  createWorkflow,
  getProjectRow,
  getStartStatus,
  grantRole,
  type FixtureHousehold,
  type FixtureProject,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn, signOut } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';
import { resolveAddonConfig, syncAddonRegistry } from '@/server/domain/project-addons';

/**
 * First add-on plumbing (issue #7): registry sync, application modes,
 * per-project enablement/inheritance, generic value writes, permissions,
 * audit, validation and the Assignee reference add-on.
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
const appSettingsRoute = await import('@/app/api/settings/route');
const addonRoute = await import('@/app/api/projects/[id]/addons/[identifier]/route');
const releaseRoute = await import('@/app/api/inbox/[id]/release/route');
const moveRoute = await import('@/app/api/projects/[id]/move/route');
const searchRoute = await import('@/app/api/search/route');

const appSettingsGet = () => appSettingsRoute.GET(request('/api/settings'), EMPTY_CONTEXT);
const appSettingsPut = (body: unknown) =>
  appSettingsRoute.PUT(request('/api/settings', { method: 'PUT', body }), EMPTY_CONTEXT);
const settingsGet = (id: string) =>
  settingsRoute.GET(request(`/api/projects/${id}/settings`), params(id));
const settingsPut = (id: string, body: unknown) =>
  settingsRoute.PUT(request(`/api/projects/${id}/settings`, { method: 'PUT', body }), params(id));
const projectGet = (id: string) =>
  projectRoute.GET(request(`/api/projects/${id}`), params(id));
const addonPatch = (id: string, identifier: string, body: unknown) =>
  addonRoute.PATCH(request(`/api/projects/${id}/addons/${identifier}`, { method: 'PATCH', body }), {
    params: Promise.resolve({ id, identifier }),
  });
const releasePost = (id: string) =>
  releaseRoute.POST(request(`/api/inbox/${id}/release`, { method: 'POST', body: {} }), params(id));
const searchGet = (query: string) =>
  searchRoute.GET(request(`/api/search?q=${encodeURIComponent(query)}`), EMPTY_CONTEXT);
const movePost = (id: string, body: unknown) =>
  moveRoute.POST(request(`/api/projects/${id}/move`, { method: 'POST', body }), params(id));

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

function setAddonMode(identifier: string, mode: string): void {
  db.prepare('UPDATE addons SET mode = ? WHERE identifier = ?').run(mode, identifier);
}

function addonRow(identifier = 'assignee'): { mode: string; name: string } | undefined {
  return db.prepare('SELECT mode, name FROM addons WHERE identifier = ?').get(identifier) as
    | { mode: string; name: string }
    | undefined;
}

/**
 * Creates an isolated subtree under Home improvement so a test can toggle
 * add-on configuration without touching the shared fixture.
 */
function projectTree(
  title: string,
  options: {
    settings?: Record<string, unknown>;
    addonData?: Record<string, unknown>;
    inbox?: boolean;
    trashedAt?: string | null;
    purgeDeadline?: string | null;
  } = {},
): { parent: FixtureProject; child: FixtureProject } {
  const parent = createFixtureProject(db, {
    title: `${title} parent`,
    parentId: household.home.id,
    reporterId: household.admin.id,
  });
  createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
  grantRole(db, parent.id, household.admin.id, 'admin');
  const child = createFixtureProject(db, {
    title,
    parentId: parent.id,
    reporterId: household.admin.id,
    settings: options.settings,
    addonData: options.addonData,
    inbox: options.inbox,
    trashedAt: options.trashedAt,
    purgeDeadline: options.purgeDeadline,
  });
  createWorkflow(db, child.id, { names: ['To do', 'Done'] });
  grantRole(db, child.id, household.admin.id, 'admin');
  return { parent, child };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-addons' });
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

describe('registry → addons table sync', () => {
  it('inserts registered rows and never overwrites an Admin mode or unregistered data', () => {
    expect(addonRow()?.mode).toBe('optional');
    expect(addonRow()?.name).toBe('Assignee');

    setAddonMode('assignee', 'required');
    syncAddonRegistry(db);
    expect(addonRow()?.mode).toBe('required');

    db.prepare(
      "INSERT OR REPLACE INTO addons (identifier, name, mode, settings, created_at) VALUES ('retired-addon', 'Retired', 'unavailable', '{}', ?)",
    ).run(new Date().toISOString());
    syncAddonRegistry(db);
    expect(addonRow('retired-addon')?.mode).toBe('unavailable');
    db.prepare("DELETE FROM addons WHERE identifier = 'retired-addon'").run();
  });

  it('keeps project state working when no optional add-on is enabled', async () => {
    const { child } = projectTree('No add-ons');
    const response = await addonPatch(child.id, 'assignee', { values: { assignee: household.maya.id } });
    expect(response.status).toBe(403);
    const payload = await json<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe('forbidden');

    const read = await projectGet(child.id);
    const readPayload = await json<{ addons: { items: unknown[] } }>(read);
    expect(readPayload.addons.items).toEqual([]);
  });
});

describe('application add-on modes', () => {
  it('reads and updates a registered mode through /api/settings', async () => {
    const initial = await appSettingsGet();
    const initialPayload = await json<{ addons: Array<{ identifier: string; mode: string }> }>(
      initial,
    );
    expect(initialPayload.addons).toEqual([
      expect.objectContaining({ identifier: 'assignee', mode: 'optional' }),
    ]);

    const updated = await appSettingsPut({ addons: { assignee: { mode: 'required' } } });
    expect(updated.status).toBe(200);
    const payload = await json<{
      addons: Array<{ identifier: string; mode: string }>;
    }>(updated);
    expect(payload.addons[0]?.mode).toBe('required');
    expect(addonRow()?.mode).toBe('required');
  });

  it('is Admin only and validates identifiers and modes', async () => {
    signIn(db, household.maya.id);
    expect((await appSettingsPut({ addons: { assignee: { mode: 'required' } } })).status).toBe(403);

    signIn(db, household.admin.id);
    const invalidMode = await appSettingsPut({ addons: { assignee: { mode: 'sometimes' } } });
    expect(invalidMode.status).toBe(422);
    const unknown = await appSettingsPut({ addons: { mystery: { mode: 'required' } } });
    expect(unknown.status).toBe(422);
    const wrongShape = await appSettingsPut({ addons: { assignee: 'required' } });
    expect(wrongShape.status).toBe(422);
    expect(addonRow()?.mode).toBe('optional');
  });
});

describe('per-project enablement and inheritance', () => {
  it('requires an optional add-on to be enabled and inherits from the nearest ancestor', async () => {
    const { parent, child } = projectTree('Inheritance');

    // Disabled by default below the Root.
    expect((await addonPatch(child.id, 'assignee', { values: {} })).status).toBe(403);

    const enabled = await settingsPut(parent.id, {
      addons: { assignee: { enabled: true, inheritFromParent: true } },
    });
    expect(enabled.status).toBe(200);
    const enabledPayload = await json<{ addons: Array<{ identifier: string; available: boolean }> }>(
      enabled,
    );
    expect(enabledPayload.addons[0]?.available).toBe(true);

    const write = await addonPatch(child.id, 'assignee', {
      values: { assignee: household.maya.id },
    });
    expect(write.status).toBe(200);

    // An explicit disable on the child hides the add-on but keeps the value.
    const disabled = await settingsPut(child.id, {
      addons: { assignee: { enabled: false } },
    });
    expect(disabled.status).toBe(200);
    expect((await addonPatch(child.id, 'assignee', { values: { assignee: null } })).status).toBe(
      403,
    );
    expect(JSON.parse(getProjectRow(db, child.id)!.addon_data)).toEqual({
      assignee: { assignee: household.maya.id },
    });

    // Re-enabling sees the stored value again.
    const reenabled = await settingsPut(child.id, {
      addons: { assignee: { enabled: true, inheritFromParent: true } },
    });
    expect(reenabled.status).toBe(200);
    const page = await projectGet(child.id);
    const pagePayload = await json<{
      addons: { items: Array<{ identifier: string; values: Record<string, unknown> }> };
    }>(page);
    expect(pagePayload.addons.items).toEqual([
      expect.objectContaining({
        identifier: 'assignee',
        values: expect.objectContaining({ assignee: household.maya.id }),
      }),
    ]);
  });

  it('inherits add-on settings from the nearest ancestor and lets a child override', async () => {
    const { parent, child } = projectTree('Settings inheritance');
    const parentSave = await settingsPut(parent.id, {
      addons: {
        assignee: { enabled: true, settings: { show_avatar: false, inherited_only: 1 } },
      },
    });
    expect(parentSave.status).toBe(200);
    const childSave = await settingsPut(child.id, {
      addons: { assignee: { settings: { show_avatar: true } } },
    });
    expect(childSave.status).toBe(200);

    expect(resolveAddonConfig(db, child.id, 'assignee')).toEqual(
      expect.objectContaining({
        available: true,
        inherited: true,
        settings: { show_avatar: true, inherited_only: 1 },
      }),
    );

    // Opting out of inheritance stops the parent settings and availability;
    // the child's own settings survive.
    const optOut = await settingsPut(child.id, {
      addons: { assignee: { inheritFromParent: false } },
    });
    expect(optOut.status).toBe(200);
    expect(resolveAddonConfig(db, child.id, 'assignee')).toEqual(
      expect.objectContaining({
        available: false,
        inherited: false,
        settings: { show_avatar: true },
      }),
    );
  });

  it('makes required/always modes available everywhere and unavailable hides without deleting', async () => {
    const { child } = projectTree('Modes');

    setAddonMode('assignee', 'always');
    expect(
      (await addonPatch(child.id, 'assignee', { values: { assignee: household.jules.id } })).status,
    ).toBe(200);

    setAddonMode('assignee', 'unavailable');
    expect((await addonPatch(child.id, 'assignee', { values: { assignee: null } })).status).toBe(
      403,
    );
    const page = await projectGet(child.id);
    const pagePayload = await json<{ addons: { items: unknown[] } }>(page);
    expect(pagePayload.addons.items).toEqual([]);
    expect(JSON.parse(getProjectRow(db, child.id)!.addon_data)).toEqual({
      assignee: { assignee: household.jules.id },
    });

    setAddonMode('assignee', 'optional');
    const reenabled = await settingsPut(child.id, {
      addons: { assignee: { enabled: true } },
    });
    expect(reenabled.status).toBe(200);
    const restored = await projectGet(child.id);
    const restoredPayload = await json<{
      addons: { items: Array<{ values: Record<string, unknown> }> };
    }>(restored);
    expect(restoredPayload.addons.items[0]?.values.assignee).toBe(household.jules.id);
  });
});

describe('required mode and the Inbox-exit gate', () => {
  it('blocks release until a required add-on has a value', async () => {
    const { child } = projectTree('Required visit', { inbox: true });
    setAddonMode('assignee', 'required');

    const blocked = await releasePost(child.id);
    expect(blocked.status).toBe(422);
    const blockedPayload = await json<{
      error: { code: string; fields: Record<string, string> };
    }>(blocked);
    expect(blockedPayload.error.code).toBe('addon_validation');
    expect(blockedPayload.error.fields.assignee).toMatch(/assignee/i);
    expect(getProjectRow(db, child.id)?.inbox).toBe(1);

    const saved = await addonPatch(child.id, 'assignee', {
      values: { assignee: household.maya.id },
    });
    expect(saved.status).toBe(200);

    const released = await releasePost(child.id);
    expect(released.status).toBe(200);
    expect(getProjectRow(db, child.id)?.inbox).toBe(0);
  });
});

describe('generic value writes', () => {
  it('validates field types, permissions and trashed projects', async () => {
    const { parent, child } = projectTree('Permissions');
    await settingsPut(parent.id, { addons: { assignee: { enabled: true } } });

    signIn(db, household.alex.id);
    expect(
      (await addonPatch(child.id, 'assignee', { values: { assignee: household.maya.id } })).status,
    ).toBe(403);
    const viewerPage = await projectGet(child.id);
    const viewerPagePayload = await json<{
      addons: { canEdit: boolean; readOnlyReason: string | null; items: unknown[] };
    }>(viewerPage);
    expect(viewerPagePayload.addons.canEdit).toBe(false);
    expect(viewerPagePayload.addons.readOnlyReason).toBe('viewer');
    expect(viewerPagePayload.addons.items).toHaveLength(1);
    signIn(db, household.admin.id);

    expect((await addonPatch(child.id, 'missing', { values: {} })).status).toBe(404);
    expect(
      (await addonPatch(child.id, 'assignee', { values: { unknown: 'x' } })).status,
    ).toBe(422);
    expect(
      (await addonPatch(child.id, 'assignee', { values: { assignee: [household.maya.id] } })).status,
    ).toBe(422);
    expect(
      (await addonPatch(child.id, 'assignee', { values: { assignee: 'not-a-user' } })).status,
    ).toBe(422);

    const trashed = projectTree('Trashed values', {
      trashedAt: new Date().toISOString(),
      purgeDeadline: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await settingsPut(trashed.parent.id, { addons: { assignee: { enabled: true } } });
    expect(
      (await addonPatch(trashed.child.id, 'assignee', { values: { assignee: null } })).status,
    ).toBe(409);
  });

  it('merges values, preserves unknown data and writes an audit event', async () => {
    const { parent, child } = projectTree('Audited', {
      addonData: {
        legacy: { keep: 'yes' },
        assignee: { assignee: null, future: 'kept' },
      },
    });
    await settingsPut(parent.id, { addons: { assignee: { enabled: true } } });

    const response = await addonPatch(child.id, 'assignee', {
      values: { assignee: household.maya.id },
    });
    expect(response.status).toBe(200);
    const payload = await json<{
      addon: { values: Record<string, unknown>; mode: string; available: boolean };
    }>(response);
    expect(payload.addon.values).toEqual({
      assignee: household.maya.id,
      future: 'kept',
    });
    expect(payload.addon.available).toBe(true);

    expect(JSON.parse(getProjectRow(db, child.id)!.addon_data)).toEqual({
      legacy: { keep: 'yes' },
      assignee: { assignee: household.maya.id, future: 'kept' },
    });

    const event = db
      .prepare(
        "SELECT action, field, old_value, new_value, detail FROM audit_events WHERE project_id = ? AND action = 'project.addon_value_changed' ORDER BY created_at DESC LIMIT 1",
      )
      .get(child.id) as
      | { action: string; field: string; old_value: string | null; new_value: string | null; detail: string }
      | undefined;
    expect(event).toBeDefined();
    expect(event?.field).toBe('Assigned to');
    expect(event?.old_value).toBeNull();
    expect(event?.new_value).toBe('maya');
    expect(JSON.parse(event!.detail)).toEqual({
      addon: 'assignee',
      field: 'assignee',
      from: null,
      to: household.maya.id,
    });

    // Partial merge: a second write changes one field and keeps the rest.
    await addonPatch(child.id, 'assignee', { values: { assignee: null } });
    expect(JSON.parse(getProjectRow(db, child.id)!.addon_data)).toEqual({
      legacy: { keep: 'yes' },
      assignee: { assignee: null, future: 'kept' },
    });
  });

  it('returns 404 when the project is not readable', async () => {
    const { child } = projectTree('Private values', { settings: { access: 'custom' } });
    await settingsPut(child.id, { addons: { assignee: { enabled: true } } });
    signOut();
    signIn(db, household.jules.id);
    expect(
      (await addonPatch(child.id, 'assignee', { values: { assignee: household.jules.id } })).status,
    ).toBe(404);
  });
});

describe('project add-on configuration', () => {
  it('saves enablement while preserving other settings and unknown add-on keys', async () => {
    const { child } = projectTree('Config preserve', {
      settings: {
        default_view: 'list',
        addons: { retired: { enabled: true, custom: 'keep' } },
      },
    });

    const response = await settingsPut(child.id, {
      addons: { assignee: { enabled: true, inheritFromParent: false } },
    });
    expect(response.status).toBe(200);
    const payload = await json<{
      settings: { default_view: string };
      addons: Array<{ identifier: string; enabled: boolean | null; inheritFromParent: boolean | null }>;
    }>(response);
    expect(payload.settings.default_view).toBe('list');
    expect(payload.addons).toEqual([
      expect.objectContaining({
        identifier: 'assignee',
        enabled: true,
        inheritFromParent: false,
      }),
    ]);

    const stored = JSON.parse(getProjectRow(db, child.id)!.settings);
    expect(stored.default_view).toBe('list');
    expect(stored.addons.retired).toEqual({ enabled: true, custom: 'keep' });
    expect(stored.addons.assignee).toEqual({ enabled: true, inheritFromParent: false });

    const read = await settingsGet(child.id);
    const readPayload = await json<{ addons: Array<{ identifier: string; available: boolean }> }>(
      read,
    );
    expect(readPayload.addons[0]).toEqual(
      expect.objectContaining({ identifier: 'assignee', available: true }),
    );
  });

  it('requires project Admin and validates identifiers/shapes', async () => {
    const { child } = projectTree('Config permissions');

    signIn(db, household.maya.id);
    expect(
      (await settingsPut(child.id, { addons: { assignee: { enabled: true } } })).status,
    ).toBe(403);

    signIn(db, household.admin.id);
    expect(
      (await settingsPut(child.id, { addons: { mystery: { enabled: true } } })).status,
    ).toBe(422);
    expect(
      (await settingsPut(child.id, { addons: { assignee: { enabled: 'yes' } } })).status,
    ).toBe(422);
    expect((await settingsPut(child.id, {})).status).toBe(400);
  });
});

describe('search integration', () => {
  it('indexes searchable add-on text only while the add-on is available', async () => {
    const { registerAddon } = await import('@/server/addons/registry');
    registerAddon({
      identifier: 'searchable-notes',
      name: 'Notes',
      version: '1.0.0',
      defaultMode: 'optional',
      fields: [{ key: 'notes', label: 'Notes', type: 'text' }],
      searchFields: ['notes'],
    });
    syncAddonRegistry(db);

    const { parent, child } = projectTree('Search add-on', {
      addonData: { 'searchable-notes': { notes: 'planktonic' } },
    });
    await settingsPut(parent.id, {
      addons: { 'searchable-notes': { enabled: true } },
    });

    const found = await searchGet('planktonic');
    const foundPayload = await json<{ results: Array<{ id: string; match: { field: string } }> }>(
      found,
    );
    expect(foundPayload.results).toEqual([
      expect.objectContaining({ id: child.id, match: expect.objectContaining({ field: 'Text' }) }),
    ]);

    // A core rename preserves the add-on text in the same FTS document.
    const renamed = await projectRoute.PATCH(
      request(`/api/projects/${child.id}`, {
        method: 'PATCH',
        body: { title: 'Search add-on renamed' },
      }),
      params(child.id),
    );
    expect(renamed.status).toBe(200);
    expect((await searchGet('planktonic')).status).toBe(200);
    expect(
      (await json<{ results: Array<{ id: string }> }>(await searchGet('planktonic'))).results.map(
        (result) => result.id,
      ),
    ).toContain(child.id);

    // Moving to a parent where the add-on is not enabled hides the text but
    // keeps the stored value; enabling it there indexes the text again.
    const destination = createFixtureProject(db, {
      title: 'Search destination',
      parentId: household.home.id,
      reporterId: household.admin.id,
    });
    createWorkflow(db, destination.id, { names: ['To do', 'Done'] });
    grantRole(db, destination.id, household.admin.id, 'admin');
    const moved = await movePost(child.id, {
      destinationId: destination.id,
      mapping: { [child.statusId]: getStartStatus(db, destination.id).id },
    });
    expect(moved.status).toBe(200);
    expect(
      (await json<{ results: unknown[] }>(await searchGet('planktonic'))).results,
    ).toEqual([]);
    expect(JSON.parse(getProjectRow(db, child.id)!.addon_data)).toEqual({
      'searchable-notes': { notes: 'planktonic' },
    });

    await settingsPut(destination.id, {
      addons: { 'searchable-notes': { enabled: true } },
    });
    expect(
      (await json<{ results: Array<{ id: string }> }>(await searchGet('planktonic'))).results.map(
        (result) => result.id,
      ),
    ).toContain(child.id);

    const unavailable = await appSettingsPut({
      addons: { 'searchable-notes': { mode: 'unavailable' } },
    });
    expect(unavailable.status).toBe(200);
    const hidden = await searchGet('planktonic');
    const hiddenPayload = await json<{ results: unknown[] }>(hidden);
    expect(hiddenPayload.results).toEqual([]);

    // Values are retained even while hidden from search/pages.
    expect(JSON.parse(getProjectRow(db, child.id)!.addon_data)).toEqual({
      'searchable-notes': { notes: 'planktonic' },
    });
  });
});
