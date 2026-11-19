import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { SESSION_COOKIE } from '@/server/auth/cookies';
import { hashSessionToken } from '@/server/auth/session';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  cookieJar,
  jsonRequest,
  makeRequest,
  requestCookies,
  resetRequestContext,
} from '../helpers/request-context';
import { createUser } from '../helpers/fixtures';

/**
 * Route-handler integration tests for the auth/setup endpoints
 * (build-spec §4, §7). next/headers is mocked so the real handlers run
 * against the suite's SQLite file.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: logout } = await import('@/app/api/auth/logout/route');

let test: TestDatabase;
let db: BetterSqliteDatabase;

beforeAll(() => {
  test = createTestDatabase({ label: 'auth-routes' });
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

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await createUser(db, { username: 'tristan', appRole: 'admin' });
    await createUser(db, { username: 'maya', appRole: 'user', password: 'different1' });
  });

  it('signs in with valid credentials and sets an httpOnly session cookie', async () => {
    const response = await login(
      jsonRequest('http://localhost/api/auth/login', {
        username: 'tristan',
        password: 'kapo1234',
      }),
    );
    expect(response.status).toBe(200);
    const payload = await body<{ user: { username: string; appRole: string } }>(response);
    expect(payload.user.username).toBe('tristan');
    expect(payload.user.appRole).toBe('admin');

    const cookie = cookieJar.get(SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.value).toBeTruthy();

    // The raw cookie token is not stored in the database, only its hash.
    const stored = db
      .prepare('SELECT token_hash FROM sessions WHERE token_hash = ?')
      .get(hashSessionToken(cookie!.value)) as { token_hash: string } | undefined;
    expect(stored?.token_hash).toBe(hashSessionToken(cookie!.value));
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?').get(cookie!.value),
    ).toEqual({ count: 0 });
  });

  it('accepts the username case-insensitively', async () => {
    const response = await login(
      jsonRequest('http://localhost/api/auth/login', {
        username: 'TRISTAN',
        password: 'kapo1234',
      }),
    );
    expect(response.status).toBe(200);
  });

  it('rejects a wrong password with 401', async () => {
    const response = await login(
      jsonRequest('http://localhost/api/auth/login', {
        username: 'tristan',
        password: 'wrong-password',
      }),
    );
    expect(response.status).toBe(401);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe('invalid_credentials');
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it('rejects an unknown user with the same generic error', async () => {
    const response = await login(
      jsonRequest('http://localhost/api/auth/login', {
        username: 'nobody',
        password: 'kapo1234',
      }),
    );
    expect(response.status).toBe(401);
    const payload = await body<{ error: { code: string; message: string } }>(response);
    expect(payload.error.code).toBe('invalid_credentials');
    expect(payload.error.message).toMatch(/invalid username or password/i);
  });

  it('validates missing fields with 422 and per-field errors', async () => {
    const response = await login(jsonRequest('http://localhost/api/auth/login', {}));
    expect(response.status).toBe(422);
    const payload = await body<{ error: { code: string; fields?: Record<string, string> } }>(
      response,
    );
    expect(payload.error.code).toBe('validation_failed');
    expect(payload.error.fields).toHaveProperty('username');
    expect(payload.error.fields).toHaveProperty('password');
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await login(
      makeRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost' },
        body: '{bad',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a cross-origin login attempt with 403 CSRF', async () => {
    const response = await login(
      jsonRequest(
        'http://localhost/api/auth/login',
        { username: 'tristan', password: 'kapo1234' },
        { origin: 'https://evil.example' },
      ),
    );
    expect(response.status).toBe(403);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe('csrf_rejected');
  });

  it('throttles repeated failures with 429 and Retry-After', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await login(
        jsonRequest(
          'http://localhost/api/auth/login',
          { username: 'throttled-user', password: 'wrong-password' },
          { headers: { 'x-forwarded-for': '198.51.100.23' } },
        ),
      );
      expect([401, 429]).toContain(response.status);
    }
    const blocked = await login(
      jsonRequest(
        'http://localhost/api/auth/login',
        { username: 'throttled-user', password: 'kapo1234' },
        { headers: { 'x-forwarded-for': '198.51.100.23' } },
      ),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    const payload = await body<{ error: { code: string } }>(blocked);
    expect(payload.error.code).toBe('rate_limited');
  });

  it('rejects GET with 405', async () => {
    const { GET } = await import('@/app/api/auth/login/route');
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the database session and clears the cookie', async () => {
    const loginResponse = await login(
      jsonRequest('http://localhost/api/auth/login', {
        username: 'maya',
        password: 'different1',
      }),
    );
    expect(loginResponse.status).toBe(200);
    const token = cookieJar.get(SESSION_COOKIE)!.value;

    const emailHash = hashSessionToken(token);
    const before = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?')
      .get(emailHash) as { count: number };
    expect(before.count).toBe(1);

    const response = await logout(
      makeRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'http://localhost' },
        cookies: requestCookies(),
      }),
    );
    expect(response.status).toBe(200);
    const after = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?')
      .get(emailHash) as { count: number };
    expect(after.count).toBe(0);
    expect(cookieJar.get(SESSION_COOKIE)?.value).toBe('');
    expect(cookieJar.get(SESSION_COOKIE)?.maxAge).toBe(0);
  });

  it('rejects cross-origin logout attempts', async () => {
    const response = await logout(
      makeRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(403);
  });
});
