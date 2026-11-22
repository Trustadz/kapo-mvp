import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { SESSION_COOKIE } from '@/server/auth/cookies';
import { hashSessionToken } from '@/server/auth/session';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  cookieJar,
  jsonRequest,
  resetRequestContext,
} from '../helpers/request-context';

/**
 * First-install route integration (build-spec §4, §5, §7, §10).
 * POST /api/setup creates the first Admin, Root, its workflow and settings.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const { POST: setup } = await import('@/app/api/setup/route');

let test: TestDatabase;
let db: BetterSqliteDatabase;

beforeAll(() => {
  test = createTestDatabase({ label: 'setup-route' });
  db = test.db;
});

beforeEach(() => {
  resetRequestContext();
});

afterAll(() => {
  test.cleanup();
});

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const VALID_SETUP = {
  username: 'firstadmin',
  email: 'admin@example.com',
  password: 'strong-pass-1',
  confirmation: 'strong-pass-1',
};

describe('POST /api/setup', () => {
  it('validates fields before creating anything', async () => {
    const response = await setup(
      jsonRequest('http://localhost/api/setup', {
        username: 'a',
        email: 'not-an-email',
        password: 'short',
        confirmation: 'mismatch',
      }),
    );
    expect(response.status).toBe(422);
    const payload = await body<{ error: { code: string; fields: Record<string, string> } }>(
      response,
    );
    expect(payload.error.code).toBe('validation_failed');
    expect(Object.keys(payload.error.fields).sort()).toEqual([
      'confirmation',
      'email',
      'password',
      'username',
    ]);
    const users = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    expect(users.count).toBe(0);
  });

  it('requires a matching password confirmation', async () => {
    const response = await setup(
      jsonRequest('http://localhost/api/setup', {
        ...VALID_SETUP,
        confirmation: 'different-pass-1',
      }),
    );
    expect(response.status).toBe(422);
    const payload = await body<{ error: { fields: Record<string, string> } }>(response);
    expect(payload.error.fields.confirmation).toMatch(/match/i);
  });

  it('rejects cross-origin setup attempts', async () => {
    const response = await setup(
      jsonRequest('http://localhost/api/setup', VALID_SETUP, { origin: 'https://evil.example' }),
    );
    expect(response.status).toBe(403);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe('csrf_rejected');
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
  });

  it('rejects GET with 405', async () => {
    const { GET } = await import('@/app/api/setup/route');
    expect(GET().status).toBe(405);
  });

  it('creates the first Admin, Root project, workflow and settings, then signs in', async () => {
    const response = await setup(jsonRequest('http://localhost/api/setup', VALID_SETUP));
    expect(response.status).toBe(201);
    const payload = await body<{ user: { username: string; appRole: string } }>(response);
    expect(payload.user.username).toBe('firstadmin');
    expect(payload.user.appRole).toBe('admin');

    const user = db
      .prepare('SELECT app_role, password_hash FROM users WHERE username = ?')
      .get('firstadmin') as { app_role: string; password_hash: string };
    expect(user.app_role).toBe('admin');
    expect(user.password_hash.startsWith('scrypt$')).toBe(true);

    const root = db.prepare('SELECT id, title, parent_id, status_id FROM projects').get() as {
      id: string;
      title: string;
      parent_id: string | null;
      status_id: string | null;
    };
    expect(root.title).toBe('Root');
    expect(root.parent_id).toBeNull();
    expect(root.status_id).toBeNull();

    const workflow = db
      .prepare('SELECT name, is_start, is_finish FROM statuses WHERE parent_id = ? ORDER BY position')
      .all(root.id) as Array<{ name: string; is_start: number; is_finish: number }>;
    expect(workflow).toEqual([
      { name: 'To do', is_start: 1, is_finish: 0 },
      { name: 'In progress', is_start: 0, is_finish: 0 },
      { name: 'Done', is_start: 0, is_finish: 1 },
    ]);

    const settings = db
      .prepare('SELECT key FROM settings ORDER BY key')
      .all() as Array<{ key: string }>;
    expect(settings.map((row) => row.key)).toEqual([
      'backup_enabled',
      'backup_retention',
      'backup_start_time',
      'default_account_role',
      'enabled_views',
      'inheritance_snapshot_v1',
      'installation_name',
      'mcp_enabled',
      'trash_purge_enabled',
      'trash_retention_days',
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM project_search').get()).toEqual({ count: 1 });

    const cookie = cookieJar.get(SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value).toBeTruthy();
    const session = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?')
      .get(hashSessionToken(cookie!.value)) as { count: number };
    expect(session.count).toBe(1);
  });

  it('rejects a second setup with 409', async () => {
    const response = await setup(
      jsonRequest('http://localhost/api/setup', {
        username: 'secondadmin',
        email: 'second@example.com',
        password: 'strong-pass-1',
        confirmation: 'strong-pass-1',
      }),
    );
    expect(response.status).toBe(409);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe('setup_complete');
    const users = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    expect(users.count).toBe(1);
  });
});
