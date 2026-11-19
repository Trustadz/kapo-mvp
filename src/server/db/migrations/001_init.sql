-- Kapo initial schema (build-spec §5).
-- IDs are UUID v4 strings; timestamps are ISO-8601 UTC strings.
-- All constraints are enforced here so every code path shares them.


CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  app_role TEXT NOT NULL DEFAULT 'user' CHECK (app_role IN ('admin', 'user', 'viewer')),
  landing_page TEXT NOT NULL DEFAULT 'home',
  appearance TEXT NOT NULL DEFAULT 'system' CHECK (appearance IN ('light', 'dark', 'system')),
  dashboard TEXT NOT NULL DEFAULT '[{"id":"inbox","visible":true},{"id":"recent","visible":true}]',
  show_archived INTEGER NOT NULL DEFAULT 0 CHECK (show_archived IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE trash_actions (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  reporter_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  parent_id TEXT REFERENCES projects (id) ON DELETE CASCADE,
  status_id TEXT REFERENCES statuses (id) ON DELETE RESTRICT,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
  inbox INTEGER NOT NULL DEFAULT 1 CHECK (inbox IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  trashed_at TEXT,
  trash_action_id TEXT REFERENCES trash_actions (id) ON DELETE SET NULL,
  purge_deadline TEXT,
  addon_data TEXT NOT NULL DEFAULT '{}',
  settings TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Root has neither a parent nor a status; every other project has both.
  CHECK ((parent_id IS NULL) = (status_id IS NULL)),
  -- Sibling priority is unique per parent, across statuses.
  -- Reorders must be two-phase (offset then rewrite) because the constraint is immediate.
  UNIQUE (parent_id, priority)
);

CREATE INDEX projects_parent_id_idx ON projects (parent_id);
CREATE INDEX projects_status_id_idx ON projects (status_id);
CREATE INDEX projects_inbox_idx ON projects (inbox) WHERE inbox = 1;
CREATE INDEX projects_trashed_at_idx ON projects (trashed_at);
CREATE INDEX projects_trash_action_id_idx ON projects (trash_action_id);

-- Only one Root project may exist.
CREATE TRIGGER projects_single_root_insert
BEFORE INSERT ON projects
WHEN NEW.parent_id IS NULL AND EXISTS (SELECT 1 FROM projects WHERE parent_id IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Only one Root project may exist');
END;

CREATE TRIGGER projects_single_root_update
BEFORE UPDATE OF parent_id ON projects
WHEN NEW.parent_id IS NULL AND NEW.id <> (SELECT id FROM projects WHERE parent_id IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Only one Root project may exist');
END;

CREATE TABLE statuses (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  is_start INTEGER NOT NULL DEFAULT 0 CHECK (is_start IN (0, 1)),
  is_finish INTEGER NOT NULL DEFAULT 0 CHECK (is_finish IN (0, 1)),
  UNIQUE (parent_id, position),
  UNIQUE (parent_id, name)
);

CREATE INDEX statuses_parent_id_idx ON statuses (parent_id);

-- At most one start and one finish status per workflow. "Exactly one" is
-- validated inside the workflow transaction (build-spec §5).
CREATE UNIQUE INDEX statuses_one_start_idx ON statuses (parent_id) WHERE is_start = 1;
CREATE UNIQUE INDEX statuses_one_finish_idx ON statuses (parent_id) WHERE is_finish = 1;

CREATE TABLE project_roles (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'viewer')),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_roles_user_id_idx ON project_roles (user_id);

CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX favorites_project_id_idx ON favorites (project_id);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX audit_events_project_id_created_at_idx ON audit_events (project_id, created_at DESC);
CREATE INDEX audit_events_actor_id_idx ON audit_events (actor_id);

-- Append-only: no update code path exists and the database rejects updates.
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE addons (
  identifier TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('required', 'always', 'optional', 'unavailable')),
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Build-spec §5: FTS5 over titles and add-on text fields. Maintained through
-- src/server/db/search.ts inside the same transaction as the project write.
CREATE VIRTUAL TABLE project_search USING fts5 (
  project_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
