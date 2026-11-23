import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { OIDC_TRANSACTION_COOKIE, SESSION_COOKIE } from '@/server/auth/cookies';
import { resetOidcClientCacheForTests } from '@/server/auth/oidc';
import {
  AVATAR_ROUTE_PREFIX,
  readAvatarFile,
  saveAvatar,
} from '@/server/domain/users';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  cookieJar,
  jsonRequest,
  makeRequest,
  resetRequestContext,
} from '../helpers/request-context';
import { createRoot, createUser, type FixtureUser } from '../helpers/fixtures';
import {
  MOCK_AVATAR_PNG,
  startMockOidcServer,
  type MockOidcServer,
} from '../helpers/mock-oidc-server';

/**
 * End-to-end route-handler tests for PocketID/OIDC sign-in.
 *
 * A real OIDC library talks to a local mock provider, so discovery, PKCE, the
 * token exchange and ID-token validation are exercised without mocking the
 * protocol itself.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const { GET: startSignIn } = await import('@/app/api/auth/pocketid/start/route');
const { GET: completeSignIn } = await import('@/app/api/auth/pocketid/callback/route');
const { POST: passwordLogin } = await import('@/app/api/auth/login/route');

let test: TestDatabase;
let db: BetterSqliteDatabase;
let oidc: MockOidcServer;
let admin: FixtureUser;

const ENV_KEYS = [
  'KAPO_OIDC_ISSUER',
  'KAPO_OIDC_CLIENT_ID',
  'KAPO_OIDC_CLIENT_SECRET',
  'KAPO_OIDC_SCOPES',
  'KAPO_OIDC_PROVIDER_NAME',
  'KAPO_OIDC_AUTO_PROVISION',
  'KAPO_OIDC_IMPORT_AVATAR',
  'KAPO_OIDC_ALLOW_INSECURE',
  'KAPO_PASSWORD_LOGIN',
  'KAPO_PUBLIC_URL',
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

  oidc = await startMockOidcServer({
    user: {
      sub: 'sub-admin',
      email: 'admin@example.com',
      email_verified: true,
      preferred_username: 'admin',
    },
  });

  process.env.KAPO_OIDC_ISSUER = oidc.url;
  process.env.KAPO_OIDC_CLIENT_ID = 'kapo-test';
  process.env.KAPO_OIDC_CLIENT_SECRET = 'test-secret';
  process.env.KAPO_OIDC_ALLOW_INSECURE = '1';
  process.env.KAPO_PUBLIC_URL = 'http://localhost';

  test = createTestDatabase({ label: 'auth-oidc' });
  db = test.db;
  admin = await createUser(db, {
    username: 'admin',
    email: 'admin@example.com',
    appRole: 'admin',
  });
  await createUser(db, {
    username: 'maya',
    email: 'maya@example.com',
    appRole: 'user',
  });
  createRoot(db, admin.id);
});

beforeEach(() => {
  resetRequestContext();
  resetOidcClientCacheForTests();
  oidc.setUser({
    sub: 'sub-admin',
    email: 'admin@example.com',
    email_verified: true,
    preferred_username: 'admin',
  });
  delete process.env.KAPO_OIDC_AUTO_PROVISION;
  delete process.env.KAPO_OIDC_IMPORT_AVATAR;
  delete process.env.KAPO_PASSWORD_LOGIN;
});

afterAll(async () => {
  await oidc.close();
  test.cleanup();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function beginSignIn(): Promise<string> {
  const response = await startSignIn(
    makeRequest('http://localhost/api/auth/pocketid/start'),
  );
  expect(response.status).toBe(307);
  const authorizationUrl = response.headers.get('location');
  expect(authorizationUrl).toBeTruthy();
  expect(authorizationUrl).toContain(oidc.url);

  const authorizeResponse = await fetch(authorizationUrl!, { redirect: 'manual' });
  expect(authorizeResponse.status).toBe(302);
  const callbackUrl = authorizeResponse.headers.get('location');
  expect(callbackUrl).toBeTruthy();
  return callbackUrl!;
}

async function finishSignIn(callbackUrl: string): Promise<Response> {
  return completeSignIn(makeRequest(callbackUrl));
}

function errorCode(response: Response): string | null {
  const location = response.headers.get('location');
  if (!location) return null;
  return new URL(location).searchParams.get('error');
}

function sessionUser(): string | null {
  const token = cookieJar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.user_id
         FROM sessions s
        WHERE s.token_hash = ?`,
    )
    .get(createHash('sha256').update(token).digest('hex')) as
    | { user_id: string }
    | undefined;
  return row?.user_id ?? null;
}

describe('PocketID sign-in', () => {
  it('links an existing account by email and keeps its Admin role', async () => {
    oidc.setUser({
      sub: 'sub-admin',
      email: 'admin@example.com',
      email_verified: true,
      preferred_username: 'admin',
      picture: `${oidc.url}/avatar`,
    });
    const callbackUrl = await beginSignIn();
    const response = await finishSignIn(callbackUrl);

    expect(response.status).toBe(307);
    expect(errorCode(response)).toBeNull();
    expect(sessionUser()).toBe(admin.id);

    const identity = db
      .prepare(
        'SELECT user_id, subject FROM user_identities WHERE provider = ? AND subject = ?',
      )
      .get(oidc.url, 'sub-admin') as { user_id: string; subject: string } | undefined;
    expect(identity?.user_id).toBe(admin.id);

    expect(
      db.prepare('SELECT app_role FROM users WHERE id = ?').get(admin.id),
    ).toEqual({ app_role: 'admin' });

    const avatar = db
      .prepare('SELECT avatar FROM users WHERE id = ?')
      .get(admin.id) as { avatar: string | null };
    expect(avatar.avatar).toMatch(/^\/api\/me\/avatar\//);
    expect(
      readAvatarFile(avatar.avatar!.slice(AVATAR_ROUTE_PREFIX.length)),
    ).toEqual(MOCK_AVATAR_PNG);
  });

  it('auto-provisions an unknown email as a Viewer with a Root grant', async () => {
    oidc.setUser({
      sub: 'sub-new',
      email: 'new-person@example.com',
      email_verified: true,
      preferred_username: 'New Person',
      picture: `${oidc.url}/avatar`,
    });

    const callbackUrl = await beginSignIn();
    const response = await finishSignIn(callbackUrl);
    expect(errorCode(response)).toBeNull();

    const created = db
      .prepare('SELECT id, username, app_role FROM users WHERE email = ?')
      .get('new-person@example.com') as
      | { id: string; username: string; app_role: string }
      | undefined;
    expect(created).toBeDefined();
    expect(created?.app_role).toBe('viewer');
    expect(created?.username).toBe('New-Person');
    expect(sessionUser()).toBe(created?.id);

    const avatar = db
      .prepare('SELECT avatar FROM users WHERE id = ?')
      .get(created!.id) as { avatar: string | null };
    expect(avatar.avatar).toMatch(/^\/api\/me\/avatar\//);
    expect(
      readAvatarFile(avatar.avatar!.slice(AVATAR_ROUTE_PREFIX.length)),
    ).toEqual(MOCK_AVATAR_PNG);

    const root = db
      .prepare('SELECT id FROM projects WHERE parent_id IS NULL')
      .get() as { id: string };
    expect(
      db
        .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
        .get(root.id, created!.id),
    ).toEqual({ role: 'viewer' });
  });

  it('keeps an existing local avatar instead of overwriting it', async () => {
    const existing = await createUser(db, {
      username: 'has-avatar',
      email: 'has-avatar@example.com',
      appRole: 'user',
    });
    const original = saveAvatar(db, existing.id, MOCK_AVATAR_PNG, 'image/png');
    oidc.setUser({
      sub: 'sub-has-avatar',
      email: 'has-avatar@example.com',
      email_verified: true,
      preferred_username: 'has-avatar',
      picture: `${oidc.url}/avatar`,
    });

    const response = await finishSignIn(await beginSignIn());
    expect(errorCode(response)).toBeNull();
    expect(
      db.prepare('SELECT avatar FROM users WHERE id = ?').get(existing.id),
    ).toEqual({ avatar: original });
  });

  it('does not fetch a picture from another origin', async () => {
    oidc.setUser({
      sub: 'sub-foreign-picture',
      email: 'foreign-picture@example.com',
      email_verified: true,
      preferred_username: 'foreign-picture',
      picture: 'https://example.com/avatar.png',
    });

    const response = await finishSignIn(await beginSignIn());
    expect(errorCode(response)).toBeNull();
    expect(
      db
        .prepare('SELECT avatar FROM users WHERE email = ?')
        .get('foreign-picture@example.com'),
    ).toEqual({ avatar: null });
  });

  it('ignores a non-image picture response without blocking sign-in', async () => {
    oidc.setUser({
      sub: 'sub-bad-picture',
      email: 'bad-picture@example.com',
      email_verified: true,
      preferred_username: 'bad-picture',
      picture: `${oidc.url}/avatar-not-an-image`,
    });

    const response = await finishSignIn(await beginSignIn());
    expect(errorCode(response)).toBeNull();
    expect(
      db
        .prepare('SELECT avatar FROM users WHERE email = ?')
        .get('bad-picture@example.com'),
    ).toEqual({ avatar: null });
  });

  it('can disable avatar import', async () => {
    process.env.KAPO_OIDC_IMPORT_AVATAR = '0';
    oidc.setUser({
      sub: 'sub-no-avatar-import',
      email: 'no-avatar-import@example.com',
      email_verified: true,
      preferred_username: 'no-avatar-import',
      picture: `${oidc.url}/avatar`,
    });

    const response = await finishSignIn(await beginSignIn());
    expect(errorCode(response)).toBeNull();
    expect(
      db
        .prepare('SELECT avatar FROM users WHERE email = ?')
        .get('no-avatar-import@example.com'),
    ).toEqual({ avatar: null });
  });

  it('reuses an existing identity even when the email changes', async () => {
    const stable = await createUser(db, {
      username: 'stable-email',
      email: 'stable@example.com',
      appRole: 'user',
    });
    oidc.setUser({
      sub: 'sub-stable',
      email: 'stable@example.com',
      email_verified: true,
      preferred_username: 'stable',
    });

    const first = await finishSignIn(await beginSignIn());
    expect(errorCode(first)).toBeNull();
    resetRequestContext();

    oidc.setUser({
      sub: 'sub-stable',
      email: 'renamed@example.com',
      email_verified: true,
      preferred_username: 'stable',
    });
    const second = await finishSignIn(await beginSignIn());
    expect(errorCode(second)).toBeNull();

    const row = db
      .prepare('SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?')
      .get(oidc.url, 'sub-stable') as { user_id: string } | undefined;
    expect(row?.user_id).toBe(stable.id);
  });

  it('rejects an email shared by multiple accounts', async () => {
    await createUser(db, {
      username: 'dup-one',
      email: 'shared@example.com',
      appRole: 'user',
    });
    await createUser(db, {
      username: 'dup-two',
      email: 'shared@example.com',
      appRole: 'user',
    });
    oidc.setUser({
      sub: 'sub-shared',
      email: 'shared@example.com',
      email_verified: true,
    });

    const callbackUrl = await beginSignIn();
    const response = await finishSignIn(callbackUrl);
    expect(errorCode(response)).toBe('email_ambiguous');
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it('does not let a second subject take over an already-linked email', async () => {
    const linked = await createUser(db, {
      username: 'linked-account',
      email: 'linked@example.com',
      appRole: 'user',
    });
    oidc.setUser({
      sub: 'sub-linked',
      email: 'linked@example.com',
      email_verified: true,
    });
    const first = await finishSignIn(await beginSignIn());
    expect(errorCode(first)).toBeNull();
    resetRequestContext();

    oidc.setUser({
      sub: 'sub-attacker',
      email: 'linked@example.com',
      email_verified: true,
    });
    const response = await finishSignIn(await beginSignIn());
    expect(errorCode(response)).toBe('account_conflict');
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);

    const identity = db
      .prepare('SELECT subject FROM user_identities WHERE provider = ? AND user_id = ?')
      .get(oidc.url, linked.id) as { subject: string } | undefined;
    expect(identity?.subject).toBe('sub-linked');
  });

  it('refuses to provision when auto-provisioning is disabled', async () => {
    process.env.KAPO_OIDC_AUTO_PROVISION = '0';
    oidc.setUser({
      sub: 'sub-unknown',
      email: 'unknown@example.com',
      email_verified: true,
    });

    const callbackUrl = await beginSignIn();
    const response = await finishSignIn(callbackUrl);
    expect(errorCode(response)).toBe('account_not_found');
    expect(
      db.prepare('SELECT id FROM users WHERE email = ?').get('unknown@example.com'),
    ).toBeUndefined();
  });

  it('rejects an unverified email', async () => {
    oidc.setUser({
      sub: 'sub-unverified',
      email: 'unverified@example.com',
      email_verified: false,
    });

    const callbackUrl = await beginSignIn();
    const response = await finishSignIn(callbackUrl);
    expect(errorCode(response)).toBe('email_not_verified');
    expect(
      db.prepare('SELECT id FROM users WHERE email = ?').get('unverified@example.com'),
    ).toBeUndefined();
  });

  it('rejects a state mismatch and clears the transaction cookie', async () => {
    const callbackUrl = await beginSignIn();
    const target = new URL(callbackUrl);
    target.searchParams.set('state', 'not-the-state');

    const response = await finishSignIn(target.toString());
    expect(errorCode(response)).toBe('sso_state_invalid');
    expect(cookieJar.get(OIDC_TRANSACTION_COOKIE)?.value).toBeFalsy();
  });

  it('rejects a tampered transaction cookie', async () => {
    const callbackUrl = await beginSignIn();
    cookieJar.set({ name: OIDC_TRANSACTION_COOKIE, value: 'tampered' });

    const response = await finishSignIn(callbackUrl);
    expect(errorCode(response)).toBe('sso_state_invalid');
  });

  it('rejects a replayed callback', async () => {
    const callbackUrl = await beginSignIn();
    const first = await finishSignIn(callbackUrl);
    expect(errorCode(first)).toBeNull();

    resetRequestContext();
    const second = await finishSignIn(callbackUrl);
    expect(errorCode(second)).toBe('sso_state_invalid');
  });
});

describe('password login switch', () => {
  it('returns 403 when password login is disabled', async () => {
    process.env.KAPO_PASSWORD_LOGIN = 'disabled';
    const response = await passwordLogin(
      jsonRequest('http://localhost/api/auth/login', {
        username: 'maya',
        password: 'kapo1234',
      }),
    );
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('password_login_disabled');
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it('still allows password login when SSO is not configured', async () => {
    const savedIssuer = process.env.KAPO_OIDC_ISSUER;
    delete process.env.KAPO_OIDC_ISSUER;
    process.env.KAPO_PASSWORD_LOGIN = 'disabled';
    try {
      const response = await passwordLogin(
        jsonRequest('http://localhost/api/auth/login', {
          username: 'maya',
          password: 'kapo1234',
        }),
      );
      expect(response.status).toBe(200);
    } finally {
      process.env.KAPO_OIDC_ISSUER = savedIssuer;
    }
  });
});
