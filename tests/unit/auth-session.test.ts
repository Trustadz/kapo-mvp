import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  createSession,
  deleteExpiredSessions,
  deleteSessionById,
  deleteSessionByToken,
  deleteSessionsForUser,
  hashSessionToken,
  resolveSession,
  SESSION_TTL_MS,
} from '@/server/auth/session';
import { nowIso } from '@/server/db/util';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import { createUser } from '../helpers/fixtures';

/** DB-backed sessions with 30-day sliding expiry (build-spec §5). */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let userId: string;

beforeAll(async () => {
  test = createTestDatabase({ label: 'sessions' });
  db = test.db;
  userId = (await createUser(db, { username: 'session-owner' })).id;
});

afterAll(() => {
  test.cleanup();
});

function sessionRows(): Array<{ id: string; token_hash: string; expires_at: string }> {
  return db
    .prepare('SELECT id, token_hash, expires_at FROM sessions ORDER BY created_at')
    .all() as Array<{ id: string; token_hash: string; expires_at: string }>;
}

describe('session lifecycle', () => {
  it('issues an opaque token and stores only its hash', () => {
    const session = createSession(db, userId);
    expect(session.token.length).toBeGreaterThanOrEqual(32);
    expect(session.token).not.toBe(session.sessionId);
    const row = db
      .prepare('SELECT token_hash, expires_at FROM sessions WHERE id = ?')
      .get(session.sessionId) as { token_hash: string; expires_at: string };
    expect(row.token_hash).toBe(hashSessionToken(session.token));
    expect(row.token_hash).not.toBe(session.token);
  });

  it('expires 30 days after issue', () => {
    const session = createSession(db, userId);
    const ttl = new Date(session.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(SESSION_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_MS + 1_000);
  });

  it('resolves a live token to its user', () => {
    const session = createSession(db, userId);
    const resolved = resolveSession(db, session.token);
    expect(resolved).not.toBeNull();
    expect(resolved?.userId).toBe(userId);
    expect(resolved?.sessionId).toBe(session.sessionId);
  });

  it('rejects an unknown token', () => {
    expect(resolveSession(db, 'not-a-real-token')).toBeNull();
  });

  it('deletes expired sessions when resolving them', () => {
    const session = createSession(db, userId);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 1_000).toISOString(),
      session.sessionId,
    );
    expect(resolveSession(db, session.token)).toBeNull();
    const row = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?').get(
      session.sessionId,
    ) as { count: number };
    expect(row.count).toBe(0);
  });

  it('slides a session older than a day forward by 30 days', () => {
    const session = createSession(db, userId);
    const oldCreatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE sessions SET created_at = ? WHERE id = ?').run(
      oldCreatedAt,
      session.sessionId,
    );
    const resolved = resolveSession(db, session.token);
    expect(resolved?.renewed).toBe(true);
    const ttl = new Date(resolved!.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(SESSION_TTL_MS - 60_000);
  });

  it('does not slide a freshly created session', () => {
    const session = createSession(db, userId);
    const resolved = resolveSession(db, session.token);
    expect(resolved?.renewed).toBe(false);
    expect(resolved?.expiresAt).toBe(
      (db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(session.sessionId) as {
        expires_at: string;
      }).expires_at,
    );
  });

  it('revokes a session by token', () => {
    const session = createSession(db, userId);
    deleteSessionByToken(db, session.token);
    expect(resolveSession(db, session.token)).toBeNull();
  });

  it('revokes a session by id and all sessions for a user', () => {
    const first = createSession(db, userId);
    const second = createSession(db, userId);
    deleteSessionById(db, first.sessionId);
    expect(resolveSession(db, first.token)).toBeNull();
    expect(resolveSession(db, second.token)).not.toBeNull();
    deleteSessionsForUser(db, userId);
    expect(resolveSession(db, second.token)).toBeNull();
    const remaining = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .get(userId) as { count: number };
    expect(remaining.count).toBe(0);
  });

  it('sweeps expired sessions in bulk and keeps live ones', () => {
    deleteSessionsForUser(db, userId);
    const live = createSession(db, userId);
    const dead = createSession(db, userId);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 5_000).toISOString(),
      dead.sessionId,
    );
    const removed = deleteExpiredSessions(db);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(resolveSession(db, live.token)).not.toBeNull();
  });

  it('deletes sessions when the user is deleted', async () => {
    const disposable = await createUser(db, { username: 'session-disposable' });
    const session = createSession(db, disposable.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(disposable.id);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?').get(session.sessionId),
    ).toEqual({ count: 0 });
  });

  it('exposes no plaintext token anywhere in the sessions table', () => {
    const session = createSession(db, userId);
    const tokens = new Set(sessionRows().map((row) => row.token_hash));
    expect(tokens.has(session.token)).toBe(false);
    expect(tokens.has(hashSessionToken(session.token))).toBe(true);
    // Keep the table small for later tests.
    db.prepare('DELETE FROM sessions WHERE created_at <= ?').run(nowIso());
  });
});
