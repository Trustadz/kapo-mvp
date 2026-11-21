import { createHash, randomBytes } from 'node:crypto';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { AuthUser } from '@/lib/types';
import {
  MCP_TOKEN_LABEL_MAX_LENGTH,
  type McpTokenSummary,
} from '@/lib/mcp';
import { newId, nowIso } from '../db/util';
import { findUserById } from './current-user';

/**
 * Personal MCP tokens (core AI-access capability).
 *
 * A token is a long-lived, revocable credential owned by exactly one user. It
 * is deliberately separate from browser sessions: no cookie, no CSRF, and the
 * raw value is shown once. The database stores only a SHA-256 hash, so a
 * database leak cannot be replayed as a live credential.
 *
 * The token's `label` ("Claude Desktop", "Local llama.cpp", …) is chosen by the
 * user when the token is created and is snapshotted onto audit events. It is
 * never read from the MCP request, so a client cannot relabel itself.
 */

const TOKEN_PREFIX = 'kapo_mcp_';
const TOKEN_BYTES = 32;
/** Avoid a write on every single tool call; minute-granularity is enough. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export type { McpTokenSummary };

export interface CreatedMcpToken {
  /** Raw token — returned exactly once, never persisted. */
  token: string;
  summary: McpTokenSummary;
}

export interface ResolvedMcpToken {
  user: AuthUser;
  tokenId: string;
  label: string;
}

interface McpTokenRow {
  id: string;
  user_id: string;
  label: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isValidMcpTokenLabel(label: unknown): label is string {
  return (
    typeof label === 'string' &&
    label.trim().length > 0 &&
    label.trim().length <= MCP_TOKEN_LABEL_MAX_LENGTH
  );
}

function mapSummary(row: McpTokenRow): McpTokenSummary {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export function listMcpTokens(
  db: BetterSqliteDatabase,
  userId: string,
): McpTokenSummary[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, label, token_hash, created_at, last_used_at, revoked_at
         FROM mcp_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC`,
    )
    .all(userId) as McpTokenRow[];
  return rows.map(mapSummary);
}

export function createMcpToken(
  db: BetterSqliteDatabase,
  userId: string,
  rawLabel: unknown,
): CreatedMcpToken {
  if (!isValidMcpTokenLabel(rawLabel)) {
    throw new Error(`A token name between 1 and ${MCP_TOKEN_LABEL_MAX_LENGTH} characters is required.`);
  }
  const label = rawLabel.trim();
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  const row: McpTokenRow = {
    id: newId(),
    user_id: userId,
    label,
    token_hash: hashMcpToken(token),
    created_at: nowIso(),
    last_used_at: null,
    revoked_at: null,
  };
  db.prepare(
    `INSERT INTO mcp_tokens (id, user_id, label, token_hash, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.user_id,
    row.label,
    row.token_hash,
    row.created_at,
    row.last_used_at,
    row.revoked_at,
  );
  return { token, summary: mapSummary(row) };
}

/**
 * Revokes a token. Returns false when the token does not exist or belongs to
 * another user, so the caller can answer 404 without leaking ownership.
 */
export function revokeMcpToken(
  db: BetterSqliteDatabase,
  userId: string,
  tokenId: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE mcp_tokens
          SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), tokenId, userId);
  return result.changes > 0;
}

/** Resolves a raw bearer token to its owner. Revoked tokens never resolve. */
export function resolveMcpToken(
  db: BetterSqliteDatabase,
  rawToken: string,
): ResolvedMcpToken | null {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
  const row = db
    .prepare(
      `SELECT id, user_id, label, token_hash, created_at, last_used_at, revoked_at
         FROM mcp_tokens
        WHERE token_hash = ?`,
    )
    .get(hashMcpToken(rawToken)) as McpTokenRow | undefined;
  if (!row || row.revoked_at !== null) return null;

  const user = findUserById(db, row.user_id);
  if (!user) return null;

  const now = Date.now();
  const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (now - lastUsed > TOUCH_INTERVAL_MS) {
    db.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(
      new Date(now).toISOString(),
      row.id,
    );
  }

  return { user, tokenId: row.id, label: row.label };
}
