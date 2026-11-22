import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { AddonApplicationConfig } from '@/lib/addons';
import type { AddonDefinition } from '@/server/addons';
import { registerAddon } from '@/server/addons/registry';
import { syncAddonRegistry } from '@/server/domain/project-addons';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import { buildHouseholdFixture, type FixtureHousehold } from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, request, signIn } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';

/**
 * Application add-on settings contract (Application settings → Add-ons):
 *
 * - the serialisable config carries `settingsFields` so the client can render
 *   generic controls;
 * - `updateApplicationAddons` validates declared types/required/options/
 *   bounds/length/date while preserving unknown keys;
 * - unsupported declarations stay read-only and malformed definitions never
 *   crash a request;
 * - mode-only updates keep the existing API behaviour.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const appSettingsRoute = await import('@/app/api/settings/route');
const appSettingsGet = () => appSettingsRoute.GET(request('/api/settings'), EMPTY_CONTEXT);
const appSettingsPut = (body: unknown) =>
  appSettingsRoute.PUT(request('/api/settings', { method: 'PUT', body }), EMPTY_CONTEXT);

const DEMO = 'settings-demo';
const MALFORMED = 'settings-malformed';

const demoAddon: AddonDefinition = {
  identifier: DEMO,
  name: 'Settings demo',
  version: '1.0.0',
  defaultMode: 'optional',
  fields: [],
  settingsFields: [
    { key: 'enabled', label: 'Enabled', type: 'boolean' },
    { key: 'limit', label: 'Limit', type: 'number', min: 1, max: 5 },
    { key: 'label', label: 'Label', type: 'text', maxLength: 4 },
    { key: 'notes', label: 'Notes', type: 'longtext' },
    { key: 'starts_on', label: 'Starts on', type: 'date' },
    {
      key: 'frequency',
      label: 'Frequency',
      type: 'select',
      options: [
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
      ],
    },
    { key: 'required_note', label: 'Required note', type: 'text', required: true },
    { key: 'owner', label: 'Owner', type: 'user' },
  ],
};

// Runtime-invalid on purpose: a malformed definition must not take the request
// (or the settings page) down.
const malformedAddon = {
  identifier: MALFORMED,
  name: 'Malformed settings',
  version: '1.0.0',
  defaultMode: 'optional',
  fields: [],
  settingsFields: 'not-an-array',
} as unknown as AddonDefinition;

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

const validSettings: Record<string, unknown> = {
  enabled: true,
  limit: 3,
  label: 'abc',
  notes: 'line one\nline two',
  starts_on: '2026-11-21',
  frequency: 'weekly',
  required_note: 'hello',
};

function demoConfig(payload: { addons: AddonApplicationConfig[] }): AddonApplicationConfig {
  const found = payload.addons.find((addon) => addon.identifier === DEMO);
  if (!found) throw new Error('Settings demo add-on missing from response');
  return found;
}

async function putDemo(settings: Record<string, unknown>, mode = 'optional'): Promise<Response> {
  return appSettingsPut({ addons: { [DEMO]: { mode, settings } } });
}

async function expectFieldError(
  response: Response,
  key: string,
): Promise<Record<string, string>> {
  expect(response.status).toBe(422);
  const payload = await json<{ error: { fields: Record<string, string> } }>(response);
  expect(payload.error.fields[`addons.${DEMO}.settings.${key}`]).toBeTruthy();
  return payload.error.fields;
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-application-addon-settings' });
  db = test.db;
  household = await buildHouseholdFixture(db);
  registerAddon(demoAddon);
  registerAddon(malformedAddon);
  syncAddonRegistry(db);
});

beforeEach(() => {
  resetRequestContext();
  signIn(db, household.admin.id);
  db.prepare(
    "UPDATE addons SET mode = 'optional', settings = '{}' WHERE identifier IN (?, ?)",
  ).run(DEMO, MALFORMED);
});

afterAll(() => {
  test.cleanup();
});

describe('serialisable application add-on config', () => {
  it('returns settings field definitions for the client renderer', async () => {
    const response = await appSettingsGet();
    expect(response.status).toBe(200);
    const payload = await json<{ addons: AddonApplicationConfig[] }>(response);
    const config = demoConfig(payload);

    expect(config.settingsFields.map((field) => field.key)).toEqual([
      'enabled',
      'limit',
      'label',
      'notes',
      'starts_on',
      'frequency',
      'required_note',
      'owner',
    ]);
    expect(
      config.settingsFields.find((field) => field.key === 'frequency')?.options,
    ).toEqual([
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
    ]);
    expect(config.settingsFields.find((field) => field.key === 'limit')).toEqual(
      expect.objectContaining({ min: 1, max: 5 }),
    );
    expect(config.settingsFields.find((field) => field.key === 'owner')?.type).toBe('user');
  });
});

describe('application add-on settings validation', () => {
  it('saves valid values, normalises text and preserves unknown/read-only keys', async () => {
    // Pre-existing keys owned by another version / the user picker.
    db.prepare('UPDATE addons SET settings = ? WHERE identifier = ?').run(
      JSON.stringify({ owner: 'user-1', legacy_key: 'keep' }),
      DEMO,
    );

    const response = await putDemo({
      ...validSettings,
      label: ' abcd ',
      unknown_from_client: 'kept',
    });
    expect(response.status).toBe(200);
    const payload = await json<{ addons: AddonApplicationConfig[] }>(response);
    const config = demoConfig(payload);
    expect(config.settings).toEqual(
      expect.objectContaining({
        enabled: true,
        limit: 3,
        label: 'abcd',
        notes: 'line one\nline two',
        starts_on: '2026-11-21',
        frequency: 'weekly',
        required_note: 'hello',
        owner: 'user-1',
        legacy_key: 'keep',
        unknown_from_client: 'kept',
      }),
    );

    const stored = JSON.parse(
      (db.prepare('SELECT settings FROM addons WHERE identifier = ?').get(DEMO) as {
        settings: string;
      }).settings,
    ) as Record<string, unknown>;
    expect(stored.owner).toBe('user-1');
    expect(stored.legacy_key).toBe('keep');
    expect(stored.label).toBe('abcd');

    // A later save that omits unknown/read-only keys keeps them.
    const { unknown_from_client: _ignored, ...withoutUnknown } = {
      ...validSettings,
      label: 'xyz',
      unknown_from_client: 'kept',
    };
    expect((await putDemo(withoutUnknown)).status).toBe(200);
    const after = JSON.parse(
      (db.prepare('SELECT settings FROM addons WHERE identifier = ?').get(DEMO) as {
        settings: string;
      }).settings,
    ) as Record<string, unknown>;
    expect(after.owner).toBe('user-1');
    expect(after.legacy_key).toBe('keep');
    expect(after.unknown_from_client).toBe('kept');
    expect(after.label).toBe('xyz');
  });

  it('validates boolean, number bounds, text length and single-line text', async () => {
    await expectFieldError(
      await putDemo({ ...validSettings, enabled: 'yes' }),
      'enabled',
    );
    await expectFieldError(
      await putDemo({ ...validSettings, limit: '3' }),
      'limit',
    );
    await expectFieldError(
      await putDemo({ ...validSettings, limit: 0 }),
      'limit',
    );
    await expectFieldError(
      await putDemo({ ...validSettings, limit: 6 }),
      'limit',
    );
    await expectFieldError(
      await putDemo({ ...validSettings, label: 'abcde' }),
      'label',
    );
    await expectFieldError(
      await putDemo({ ...validSettings, label: 'ab\ncd' }),
      'label',
    );
    await expectFieldError(
      await putDemo({ ...validSettings, limit: [3] }),
      'limit',
    );
  });

  it('validates required fields, select options and dates', async () => {
    await expectFieldError(
      await putDemo({ ...validSettings, required_note: '  ' }),
      'required_note',
    );
    await expectFieldError(
      await putDemo({ ...validSettings, frequency: 'monthly' }),
      'frequency',
    );
    await expectFieldError(
      await putDemo({ ...validSettings, starts_on: '2026-02-30' }),
      'starts_on',
    );
  });

  it('rejects writes to unsupported declarations but preserves their stored values', async () => {
    db.prepare('UPDATE addons SET settings = ? WHERE identifier = ?').run(
      JSON.stringify({ owner: 'user-1' }),
      DEMO,
    );

    const fields = await expectFieldError(
      await putDemo({ ...validSettings, owner: 'user-2' }),
      'owner',
    );
    expect(fields[`addons.${DEMO}.settings.owner`]).toContain('not supported');
    const stored = JSON.parse(
      (db.prepare('SELECT settings FROM addons WHERE identifier = ?').get(DEMO) as {
        settings: string;
      }).settings,
    ) as Record<string, unknown>;
    expect(stored.owner).toBe('user-1');
  });

  it('keeps mode-only updates working without validating existing settings', async () => {
    const response = await appSettingsPut({ addons: { [DEMO]: { mode: 'required' } } });
    expect(response.status).toBe(200);
    const payload = await json<{ addons: AddonApplicationConfig[] }>(response);
    expect(demoConfig(payload).mode).toBe('required');
    expect(
      (db.prepare('SELECT mode FROM addons WHERE identifier = ?').get(DEMO) as {
        mode: string;
      }).mode,
    ).toBe('required');
  });

  it('never crashes on a malformed settings definition', async () => {
    const response = await appSettingsPut({
      addons: { [MALFORMED]: { mode: 'optional', settings: { anything: 'thing' } } },
    });
    expect(response.status).toBe(200);
    const payload = await json<{ addons: AddonApplicationConfig[] }>(response);
    const config = payload.addons.find((addon) => addon.identifier === MALFORMED);
    expect(config?.settingsFields).toEqual([]);
    expect(config?.settings).toEqual({ anything: 'thing' });
  });
});
