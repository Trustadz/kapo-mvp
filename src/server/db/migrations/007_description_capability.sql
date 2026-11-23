-- Description capability (docs/add-on-platform.md §4 and §6).
--
-- addon_capabilities records the Admin-chosen provider for an exclusive
-- capability. The provider id intentionally has no foreign key to `addons`:
-- unregistering an add-on must keep the stored choice and its data readable.
--
-- project_descriptions is the core-owned record. `body` and `format` belong to
-- the active provider; `plaintext` is the mandatory fallback used for search,
-- previews and rendering when no provider can read `format`.

CREATE TABLE addon_capabilities (
  capability TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_descriptions (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  format TEXT NOT NULL CHECK (length(format) > 0),
  plaintext TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  mentions TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX project_descriptions_format_idx ON project_descriptions (format);
CREATE INDEX project_descriptions_updated_by_idx ON project_descriptions (updated_by);
