import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  getOidcConfig,
  mapOidcClaims,
  oidcCallbackUrl,
  oidcRedirectUri,
  OidcLoginError,
} from '@/server/auth/oidc';
import {
  signOidcTransaction,
  verifyOidcTransaction,
} from '@/server/auth/oidc-state';
import { generateUsername } from '@/server/domain/identities';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import { createUser } from '../helpers/fixtures';

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

const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

describe('getOidcConfig', () => {
  it('is disabled and keeps password login on by default', () => {
    setEnv({});
    const config = getOidcConfig();
    expect(config.enabled).toBe(false);
    expect(config.passwordLoginEnabled).toBe(true);
    expect(config.autoProvision).toBe(true);
    expect(config.importAvatar).toBe(true);
    expect(config.providerName).toBe('PocketID');
    expect(config.scopes).toBe('openid profile email');
  });

  it('reads a complete configuration and trims the issuer', () => {
    setEnv({
      KAPO_OIDC_ISSUER: 'https://id.example.com/',
      KAPO_OIDC_CLIENT_ID: 'kapo',
      KAPO_OIDC_CLIENT_SECRET: 'secret',
      KAPO_OIDC_SCOPES: 'profile,email',
      KAPO_OIDC_PROVIDER_NAME: 'Household ID',
      KAPO_PUBLIC_URL: 'https://kapo.example.com/',
    });
    const config = getOidcConfig();
    expect(config.enabled).toBe(true);
    expect(config.issuer).toBe('https://id.example.com');
    expect(config.clientId).toBe('kapo');
    expect(config.clientSecret).toBe('secret');
    expect(config.scopes).toBe('openid profile email');
    expect(config.providerName).toBe('Household ID');
    expect(config.publicUrl).toBe('https://kapo.example.com');
  });

  it('stays disabled when the issuer is malformed or the client id is missing', () => {
    setEnv({ KAPO_OIDC_ISSUER: 'not-a-url', KAPO_OIDC_CLIENT_ID: 'kapo' });
    expect(getOidcConfig().enabled).toBe(false);

    setEnv({ KAPO_OIDC_ISSUER: 'https://id.example.com' });
    expect(getOidcConfig().enabled).toBe(false);
  });

  it('rejects an http issuer unless the explicit local-testing switch is set', () => {
    setEnv({
      KAPO_OIDC_ISSUER: 'http://localhost:8080',
      KAPO_OIDC_CLIENT_ID: 'kapo',
    });
    expect(getOidcConfig().enabled).toBe(false);

    setEnv({
      KAPO_OIDC_ISSUER: 'http://localhost:8080',
      KAPO_OIDC_CLIENT_ID: 'kapo',
      KAPO_OIDC_ALLOW_INSECURE: '1',
    });
    expect(getOidcConfig().enabled).toBe(true);
    expect(getOidcConfig().allowInsecure).toBe(true);
  });

  it('refuses to disable password login without a usable OIDC configuration', () => {
    setEnv({ KAPO_PASSWORD_LOGIN: 'disabled' });
    expect(getOidcConfig().passwordLoginEnabled).toBe(true);

    setEnv({
      KAPO_PASSWORD_LOGIN: 'disabled',
      KAPO_OIDC_ISSUER: 'https://id.example.com',
      KAPO_OIDC_CLIENT_ID: 'kapo',
    });
    expect(getOidcConfig().passwordLoginEnabled).toBe(false);
  });

  it('defaults auto-provisioning and avatar import on, with explicit off switches', () => {
    setEnv({});
    expect(getOidcConfig().autoProvision).toBe(true);
    expect(getOidcConfig().importAvatar).toBe(true);

    setEnv({ KAPO_OIDC_AUTO_PROVISION: '0' });
    expect(getOidcConfig().autoProvision).toBe(false);

    setEnv({ KAPO_OIDC_IMPORT_AVATAR: '0' });
    expect(getOidcConfig().importAvatar).toBe(false);
  });
});

describe('oidcRedirectUri', () => {
  it('uses KAPO_PUBLIC_URL when set', () => {
    setEnv({
      KAPO_OIDC_ISSUER: 'https://id.example.com',
      KAPO_OIDC_CLIENT_ID: 'kapo',
      KAPO_PUBLIC_URL: 'https://kapo.example.com',
    });
    expect(
      oidcRedirectUri(getOidcConfig(), new Request('http://localhost/login')),
    ).toBe('https://kapo.example.com/api/auth/pocketid/callback');
  });

  it('falls back to the request origin for local development', () => {
    setEnv({
      KAPO_OIDC_ISSUER: 'https://id.example.com',
      KAPO_OIDC_CLIENT_ID: 'kapo',
    });
    expect(
      oidcRedirectUri(getOidcConfig(), new Request('http://localhost:3000/login')),
    ).toBe('http://localhost:3000/api/auth/pocketid/callback');
  });
});

describe('oidcCallbackUrl', () => {
  it('keeps the public origin and callback query behind a TLS proxy', () => {
    setEnv({
      KAPO_OIDC_ISSUER: 'https://id.example.com',
      KAPO_OIDC_CLIENT_ID: 'kapo',
      KAPO_PUBLIC_URL: 'https://kapo.example.com',
    });

    // The proxy terminates TLS and forwards the callback to the container
    // over its internal http:// address.
    const callback = oidcCallbackUrl(
      getOidcConfig(),
      new Request(
        'http://10.0.0.5:3000/api/auth/pocketid/callback?code=abc&state=xyz',
      ),
    );

    expect(callback.toString()).toBe(
      'https://kapo.example.com/api/auth/pocketid/callback?code=abc&state=xyz',
    );
  });
});

describe('mapOidcClaims', () => {
  it('keeps the standard claims Kapo needs', () => {
    expect(
      mapOidcClaims({
        sub: 'abc',
        email: ' Person@Example.com ',
        email_verified: true,
        preferred_username: 'person',
        picture: 'https://id.example.com/avatar/person',
      }),
    ).toEqual({
      subject: 'abc',
      email: 'Person@Example.com',
      emailVerified: true,
      preferredUsername: 'person',
      picture: 'https://id.example.com/avatar/person',
    });
  });

  it('rejects a claims set without a subject', () => {
    expect(() => mapOidcClaims({ email: 'x@example.com' })).toThrow(OidcLoginError);
  });
});

describe('OIDC transaction cookie', () => {
  const transaction = {
    state: 'state',
    nonce: 'nonce',
    codeVerifier: 'verifier',
    createdAt: Date.now(),
  };

  it('round-trips a signed transaction', () => {
    const value = signOidcTransaction(transaction);
    expect(verifyOidcTransaction(value)).toEqual(transaction);
  });

  it('rejects a tampered payload or signature', () => {
    const value = signOidcTransaction(transaction);
    const [payload, signature] = value.split('.');
    expect(verifyOidcTransaction(`${payload}x.${signature}`)).toBeNull();
    expect(verifyOidcTransaction(`${payload}.${signature}x`)).toBeNull();
    expect(verifyOidcTransaction('not-a-token')).toBeNull();
  });

  it('expires after ten minutes and rejects a far-future timestamp', () => {
    expect(
      verifyOidcTransaction(
        signOidcTransaction({
          ...transaction,
          createdAt: Date.now() - 11 * 60 * 1000,
        }),
      ),
    ).toBeNull();
    expect(
      verifyOidcTransaction(
        signOidcTransaction({
          ...transaction,
          createdAt: Date.now() + 5 * 60 * 1000,
        }),
      ),
    ).toBeNull();
  });
});

describe('generateUsername', () => {
  let test: TestDatabase;
  let db: BetterSqliteDatabase;

  beforeAll(async () => {
    test = createTestDatabase({ label: 'oidc-username' });
    db = test.db;
    await createUser(db, { username: 'alex', email: 'alex@example.com' });
    await createUser(db, { username: 'alex-2', email: 'alex2@example.com' });
  });

  afterAll(() => {
    test.cleanup();
  });

  it('uses preferred_username and de-duplicates case-insensitively', () => {
    expect(generateUsername(db, 'Alex', 'alex@example.com')).toBe('Alex-3');
  });

  it('sanitises spaces and punctuation', () => {
    expect(generateUsername(db, 'New Person!', 'new@example.com')).toBe('New-Person');
  });

  it('falls back to the email local part and then to "user"', () => {
    expect(generateUsername(db, null, 'sam@example.com')).toBe('sam');
    expect(generateUsername(db, 'é', 'sam@example.com')).toBe('user');
    expect(generateUsername(db, 'a', 'sam@example.com')).toBe('user');
  });

  it('caps the generated name at 32 characters', () => {
    const generated = generateUsername(db, 'x'.repeat(40), 'long@example.com');
    expect(generated.length).toBeLessThanOrEqual(32);
    expect(generated.startsWith('x')).toBe(true);
  });

  it('enforces identity uniqueness and cascades on user delete', async () => {
    const one = await createUser(db, {
      username: 'identity-one',
      email: 'identity-one@example.com',
    });
    const two = await createUser(db, {
      username: 'identity-two',
      email: 'identity-two@example.com',
    });
    const insert = db.prepare(
      `INSERT INTO user_identities (
         id, user_id, provider, subject, email_at_link, created_at, last_login_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    insert.run('identity-a', one.id, 'https://id.example.com', 'sub-a', one.email, now, now);
    expect(() =>
      insert.run('identity-b', one.id, 'https://id.example.com', 'sub-b', one.email, now, now),
    ).toThrow();
    expect(() =>
      insert.run('identity-c', two.id, 'https://id.example.com', 'sub-a', two.email, now, now),
    ).toThrow();

    db.prepare('DELETE FROM users WHERE id = ?').run(one.id);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM user_identities WHERE user_id = ?')
        .get(one.id),
    ).toEqual({ count: 0 });
  });
});
