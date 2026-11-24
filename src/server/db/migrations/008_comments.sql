-- Basic comments capability (docs/add-on-platform.md §4 pattern).
--
-- Core owns the durable comment record, author and plaintext fallback. The
-- active comments provider owns `body` and `format`. Comments never grant
-- access; the domain checks project read/edit permissions before returning or
-- writing a row.

CREATE TABLE project_comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  format TEXT NOT NULL CHECK (length(format) > 0),
  plaintext TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX project_comments_project_created_idx
  ON project_comments (project_id, created_at, id);
CREATE INDEX project_comments_author_idx ON project_comments (author_id);
