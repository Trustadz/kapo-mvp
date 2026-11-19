import { createHash, randomBytes } from 'node:crypto';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { newId, nowIso } from '../db/util';

/**
 * Database-backed sessions with 30-day sliding expiry (build-spec §5).
 *
 * The raw token only ever travels in the httpOnly cookie; the database stores
 * a SHA-256 hash so a database leak cannot be replayed as a live session.
 */

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Renew once a session is more than a day old, keeping writes rare. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: string;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db: BetterSqliteDatabase, userId: string): CreatedSession {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const sessionId = newId();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, userId, hashSessionToken(token), expiresAt, createdAt);
  return { token, sessionId, expiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  expiresAt: string;
  renewed: boolean;
}

/**
 * Resolves a raw cookie token to a session. Expired sessions are deleted and
 * a valid session older than a day is slid forward by another 30 days.
 */
export function resolveSession(
  db: BetterSqliteDatabase,
  token: string,
): ResolvedSession | null {
  const tokenHash = hashSessionToken(token);
  const row = db
    .prepare('SELECT id, user_id, expires_at, created_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as
    | { id: string; user_id: string; expires_at: string; created_at: string }
    | undefined;
  if (!row) return null;

  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    deleteSessionById(db, row.id);
    return null;
  }

  let expiresAt = row.expires_at;
  let renewed = false;
  if (now - new Date(row.created_at).getTime() > RENEW_AFTER_MS) {
    expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, row.id);
    renewed = true;
  }

  return { sessionId: row.id, userId: row.user_id, expiresAt, renewed };
}

export function deleteSessionByToken(db: BetterSqliteDatabase, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token));
}

export function deleteSessionById(db: BetterSqliteDatabase, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteSessionsForUser(db: BetterSqliteDatabase, userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function deleteExpiredSessions(db: BetterSqliteDatabase): number {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  return result.changes;
}
