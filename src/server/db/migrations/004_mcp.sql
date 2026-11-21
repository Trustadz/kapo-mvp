-- 004_mcp.sql — opt-in MCP access (issue: core MCP capability).
--
-- Personal MCP tokens are separate from browser sessions: a token is a
-- long-lived, revocable credential scoped to one user, and the raw value is
-- only ever shown once (the database stores a SHA-256 hash, like sessions).
--
-- Provenance columns on audit_events record that a write arrived through an MCP
-- client. They are nullable: NULL means an ordinary browser/API write. The
-- label is a snapshot taken from the token row at write time, because the
-- audit log is append-only and a renamed/revoked token must not rewrite it.

CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX mcp_tokens_user_id_idx ON mcp_tokens (user_id);

ALTER TABLE audit_events ADD COLUMN via_channel TEXT;
ALTER TABLE audit_events ADD COLUMN via_agent TEXT;
ALTER TABLE audit_events ADD COLUMN via_token_id TEXT;
