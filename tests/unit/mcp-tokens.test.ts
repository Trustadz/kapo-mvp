import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import { createUser } from '../helpers/fixtures';
import {
  createMcpToken,
  hashMcpToken,
  isValidMcpTokenLabel,
  listMcpTokens,
  resolveMcpToken,
  revokeMcpToken,
} from '@/server/auth/mcp-token';

/**
 * Personal MCP tokens: creation, hashing, resolution and revocation.
 *
 * The raw token must never be stored; a database leak must not yield a usable
 * credential, and revocation must be immediate.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let maya: { id: string };
let jules: { id: string };

beforeAll(async () => {
  test = createTestDatabase({ label: 'mcp-tokens' });
  db = test.db;
  maya = await createUser(db, { username: 'maya', appRole: 'user' });
  jules = await createUser(db, { username: 'jules', appRole: 'user' });
});

afterAll(() => {
  test.cleanup();
});

describe('token creation', () => {
  it('returns a prefixed raw token exactly once and stores only its hash', () => {
    const created = createMcpToken(db, maya.id, 'Claude Desktop');
    expect(created.token.startsWith('kapo_mcp_')).toBe(true);
    expect(created.token.length).toBeGreaterThan(40);
    expect(created.summary.label).toBe('Claude Desktop');
    expect(created.summary.revokedAt).toBeNull();

    const row = db
      .prepare('SELECT token_hash FROM mcp_tokens WHERE id = ?')
      .get(created.summary.id) as { token_hash: string };
    expect(row.token_hash).toBe(hashMcpToken(created.token));
    expect(row.token_hash).not.toContain(created.token);

    const stored = JSON.stringify(listMcpTokens(db, maya.id));
    expect(stored).not.toContain(created.token);
    expect(stored).not.toContain('token_hash');
  });

  it('trims the label and rejects empty or overlong names', () => {
    const created = createMcpToken(db, maya.id, '  Open WebUI  ');
    expect(created.summary.label).toBe('Open WebUI');

    expect(isValidMcpTokenLabel('')).toBe(false);
    expect(isValidMcpTokenLabel('   ')).toBe(false);
    expect(isValidMcpTokenLabel(42)).toBe(false);
    expect(isValidMcpTokenLabel('x'.repeat(60))).toBe(true);
    expect(isValidMcpTokenLabel('x'.repeat(61))).toBe(false);
    expect(() => createMcpToken(db, maya.id, '   ')).toThrow();
  });
});

describe('resolution', () => {
  it('resolves a live token to its owner and label', () => {
    const created = createMcpToken(db, maya.id, 'Llama');
    const resolved = resolveMcpToken(db, created.token);
    expect(resolved?.user.id).toBe(maya.id);
    expect(resolved?.user.username).toBe('maya');
    expect(resolved?.tokenId).toBe(created.summary.id);
    expect(resolved?.label).toBe('Llama');
  });

  it('ignores unknown and malformed tokens', () => {
    expect(resolveMcpToken(db, 'kapo_mcp_not-a-real-token')).toBeNull();
    expect(resolveMcpToken(db, 'not-even-prefixed')).toBeNull();
  });

  it('touches last_used_at on first use', () => {
    const created = createMcpToken(db, maya.id, 'Touch');
    expect(created.summary.lastUsedAt).toBeNull();
    resolveMcpToken(db, created.token);
    const row = db
      .prepare('SELECT last_used_at FROM mcp_tokens WHERE id = ?')
      .get(created.summary.id) as { last_used_at: string | null };
    expect(row.last_used_at).not.toBeNull();
  });
});

describe('revocation', () => {
  it('stops resolving the token immediately and is idempotent-safe', () => {
    const created = createMcpToken(db, maya.id, 'Temporary');
    expect(resolveMcpToken(db, created.token)).not.toBeNull();
    expect(revokeMcpToken(db, maya.id, created.summary.id)).toBe(true);
    expect(resolveMcpToken(db, created.token)).toBeNull();
    expect(revokeMcpToken(db, maya.id, created.summary.id)).toBe(false);
  });

  it('cannot revoke another user’s token', () => {
    const created = createMcpToken(db, jules.id, 'Jules');
    expect(revokeMcpToken(db, maya.id, created.summary.id)).toBe(false);
    expect(resolveMcpToken(db, created.token)?.user.id).toBe(jules.id);
  });
});
