import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countUsers, findUserById, findUserByUsername, isFirstRun } from '@/server/auth/current-user';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import { createUser, fixturePasswordHash } from '../helpers/fixtures';

/** First-run detection and user lookup helpers (build-spec §4, §5). */

let test: TestDatabase;

beforeAll(() => {
  test = createTestDatabase({ label: 'first-run' });
});

afterAll(() => {
  test.cleanup();
});

describe('first-run detection', () => {
  it('reports first run while the users table is empty', async () => {
    expect(await isFirstRun()).toBe(true);
    expect(countUsers()).toBe(0);
  });

  it('reports first run as false once an account exists', async () => {
    await createUser(test.db, { username: 'first-admin', appRole: 'admin' });
    expect(await isFirstRun()).toBe(false);
    expect(countUsers()).toBe(1);
  });
});

describe('user lookup', () => {
  it('finds a user by id and exposes the mapped shape', async () => {
    const created = await createUser(test.db, {
      username: 'maya',
      appRole: 'user',
      appearance: 'dark',
      showArchived: true,
    });
    const found = findUserById(test.db, created.id);
    expect(found).not.toBeNull();
    expect(found?.username).toBe('maya');
    expect(found?.appRole).toBe('user');
    expect(found?.appearance).toBe('dark');
    expect(found?.showArchived).toBe(true);
    expect(found?.dashboard).toEqual([
      { id: 'inbox', visible: true },
      { id: 'recent', visible: true },
    ]);
  });

  it('finds a user by username case-insensitively and includes the password hash', async () => {
    const hash = await fixturePasswordHash();
    const found = findUserByUsername(test.db, 'MAYA');
    expect(found).not.toBeNull();
    expect(found?.username).toBe('maya');
    expect(found?.passwordHash).toBe(hash);
    expect(await verifyPassword('kapo1234', found!.passwordHash)).toBe(true);
  });

  it('returns null for unknown users', () => {
    expect(findUserById(test.db, 'missing')).toBeNull();
    expect(findUserByUsername(test.db, 'nobody')).toBeNull();
  });

  it('does not expose the password hash on the general user shape', async () => {
    const created = await createUser(test.db, { username: 'hash-free' });
    const found = findUserById(test.db, created.id);
    expect(found).not.toBeNull();
    expect(found).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(found)).not.toContain('scrypt$');
  });

  it('round-trips a custom password', async () => {
    const hash = await hashPassword('a different secret');
    const created = await createUser(test.db, { username: 'custom-pass', password: 'a different secret' });
    const found = findUserByUsername(test.db, 'custom-pass');
    expect(await verifyPassword('a different secret', found!.passwordHash)).toBe(true);
    expect(found?.passwordHash).not.toBe(hash);
    expect(created.id).toBeTruthy();
  });
});
