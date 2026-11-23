import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject as createFixtureProject,
  type FixtureHousehold,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';
import { nowIso } from '@/server/db/util';
import {
  reindexAllProjectAddonSearch,
  syncAddonRegistry,
} from '@/server/domain/project-addons';

/**
 * First capability vertical slice: core-owned description records, the active
 * Markdown provider, plaintext fallback, permissions, audit and search.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const descriptionRoute = await import('@/app/api/projects/[id]/description/route');
const projectRoute = await import('@/app/api/projects/[id]/route');
const appSettingsRoute = await import('@/app/api/settings/route');
const searchRoute = await import('@/app/api/search/route');

const descriptionGet = (id: string) =>
  descriptionRoute.GET(request(`/api/projects/${id}/description`), params(id));
const descriptionPatch = (id: string, body: unknown) =>
  descriptionRoute.PATCH(
    request(`/api/projects/${id}/description`, { method: 'PATCH', body }),
    params(id),
  );
const projectGet = (id: string) => projectRoute.GET(request(`/api/projects/${id}`), params(id));
const appSettingsGet = () => appSettingsRoute.GET(request('/api/settings'), EMPTY_CONTEXT);
const appSettingsPut = (body: unknown) =>
  appSettingsRoute.PUT(request('/api/settings', { method: 'PUT', body }), EMPTY_CONTEXT);
const searchGet = (query: string) =>
  searchRoute.GET(request(`/api/search?q=${encodeURIComponent(query)}`), EMPTY_CONTEXT);

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

interface DescriptionPayload {
  description: {
    provider: { identifier: string } | null;
    record: { body: string; format: string; plaintext: string } | null;
    canEdit: boolean;
    unsupportedFormat: boolean;
  };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-description' });
  db = test.db;
  household = await buildHouseholdFixture(db);
  syncAddonRegistry(db);
});

beforeEach(() => {
  resetRequestContext();
  db.prepare('DELETE FROM project_descriptions').run();
  db.prepare('DELETE FROM addon_capabilities').run();
  reindexAllProjectAddonSearch(db);
  signIn(db, household.admin.id);
});

afterAll(() => {
  test.cleanup();
});

describe('description capability', () => {
  it('defaults to the Markdown provider and saves a core-owned record', async () => {
    const read = await descriptionGet(household.home.id);
    expect(read.status).toBe(200);
    const initial = await json<DescriptionPayload>(read);
    expect(initial.description.provider?.identifier).toBe('description-markdown');
    expect(initial.description.record).toBeNull();
    expect(initial.description.canEdit).toBe(true);

    const saved = await descriptionPatch(household.home.id, {
      body: '**Planktonic** notes',
      format: 'markdown@1',
      plaintext: 'Planktonic notes',
    });
    expect(saved.status).toBe(200);
    const payload = await json<DescriptionPayload>(saved);
    expect(payload.description.record).toEqual(
      expect.objectContaining({
        body: '**Planktonic** notes',
        format: 'markdown@1',
        plaintext: 'Planktonic notes',
      }),
    );

    const page = await projectGet(household.home.id);
    const pagePayload = await json<DescriptionPayload>(page);
    expect(pagePayload.description.record?.plaintext).toBe('Planktonic notes');

    const audit = db
      .prepare(
        "SELECT action FROM audit_events WHERE project_id = ? AND action = 'project.description_updated'",
      )
      .get(household.home.id) as { action: string } | undefined;
    expect(audit?.action).toBe('project.description_updated');

    const search = await searchGet('Planktonic');
    const results = await json<{ results: Array<{ id: string; match: { field: string } }> }>(search);
    expect(results.results).toEqual([
      expect.objectContaining({ id: household.home.id, match: expect.objectContaining({ field: 'Text' }) }),
    ]);
  });

  it('keeps viewers read-only and refuses trashed projects', async () => {
    signIn(db, household.alex.id);
    const read = await descriptionGet(household.home.id);
    expect(read.status).toBe(200);
    const payload = await json<DescriptionPayload>(read);
    expect(payload.description.canEdit).toBe(false);

    const rejected = await descriptionPatch(household.home.id, {
      body: 'Viewer edit',
      format: 'markdown@1',
      plaintext: 'Viewer edit',
    });
    expect(rejected.status).toBe(403);

    signIn(db, household.admin.id);
    const trashed = createFixtureProject(db, {
      title: 'Trashed with description',
      parentId: household.home.id,
      reporterId: household.admin.id,
      trashedAt: nowIso(),
    });
    const trashedWrite = await descriptionPatch(trashed.id, {
      body: 'Trashed edit',
      format: 'markdown@1',
      plaintext: 'Trashed edit',
    });
    expect(trashedWrite.status).toBe(409);
  });

  it('serves plaintext when the stored format is unsupported and rewrites it on save', async () => {
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO project_descriptions
         (project_id, body, format, plaintext, metadata, mentions, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', '[]', ?, ?, ?, ?)`,
    ).run(
      household.home.id,
      '<p>HTML body</p>',
      'html@1',
      'HTML body',
      household.admin.id,
      household.admin.id,
      timestamp,
      timestamp,
    );

    const read = await descriptionGet(household.home.id);
    const payload = await json<DescriptionPayload>(read);
    expect(payload.description.unsupportedFormat).toBe(true);
    expect(payload.description.record?.plaintext).toBe('HTML body');

    const rewritten = await descriptionPatch(household.home.id, {
      body: 'Markdown now',
      format: 'markdown@1',
      plaintext: 'Markdown now',
    });
    expect(rewritten.status).toBe(200);
    const rewrittenPayload = await json<DescriptionPayload>(rewritten);
    expect(rewrittenPayload.description.unsupportedFormat).toBe(false);
    expect(rewrittenPayload.description.record?.format).toBe('markdown@1');
  });

  it('lets an Admin select or clear the exclusive provider', async () => {
    const initial = await appSettingsGet();
    const initialPayload = await json<{
      capabilities: {
        description: {
          activeProvider: string | null;
          providers: Array<{ identifier: string }>;
        };
      };
    }>(initial);
    expect(initialPayload.capabilities.description.activeProvider).toBe('description-markdown');
    expect(initialPayload.capabilities.description.providers).toEqual([
      expect.objectContaining({ identifier: 'description-markdown' }),
    ]);

    const selected = await appSettingsPut({
      capabilities: { description: 'description-markdown' },
    });
    expect(selected.status).toBe(200);

    const cleared = await appSettingsPut({ capabilities: { description: null } });
    expect(cleared.status).toBe(200);
    const clearedPayload = await json<{
      capabilities: { description: { activeProvider: string | null } };
    }>(cleared);
    expect(clearedPayload.capabilities.description.activeProvider).toBeNull();

    const unknown = await appSettingsPut({ capabilities: { description: 'nope' } });
    expect(unknown.status).toBe(422);

    signIn(db, household.maya.id);
    const forbidden = await appSettingsPut({
      capabilities: { description: 'description-markdown' },
    });
    expect(forbidden.status).toBe(403);
  });
});
