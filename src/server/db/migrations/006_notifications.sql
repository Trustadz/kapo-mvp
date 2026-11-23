-- In-app notifications and per-user project watches.
--
-- A watch is a personal subscription, never a permission grant. Notifications
-- store the event-time presentation data and the recipient's read mark. A
-- notification about a purged project is removed with the project; a
-- notification about a project whose access was revoked stays in the table but
-- is filtered out by the domain read path until access returns.

CREATE TABLE project_watches (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX project_watches_project_id_idx ON project_watches (project_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Core audit action (`project.renamed`, …) or an add-on-defined kind.
  kind TEXT NOT NULL,
  -- Plain-text fallback used by API consumers and unknown kinds. The web UI
  -- localizes known core kinds and add-on `translations` when available.
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  -- Optional JSON object keyed by locale, for add-on notifications.
  translations TEXT NOT NULL DEFAULT '{}',
  -- JSON object with interpolation values (project title, field, old/new …).
  data TEXT NOT NULL DEFAULT '{}',
  -- Human-readable source shown in the notification list.
  origin TEXT NOT NULL CHECK (length(origin) BETWEEN 1 AND 300),
  origin_type TEXT NOT NULL CHECK (origin_type IN ('project', 'addon', 'system')),
  origin_id TEXT,
  -- Internal application path only; external URLs are rejected by the domain.
  href TEXT CHECK (href IS NULL OR (length(href) <= 2048 AND substr(href, 1, 1) = '/')),
  project_id TEXT REFERENCES projects (id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  addon_identifier TEXT,
  -- The audit event that produced a watch notification, used to deduplicate an
  -- add-on notification for the same change.
  source_event_id TEXT REFERENCES audit_events (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX notifications_user_created_idx
  ON notifications (user_id, created_at DESC, id DESC);

CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX notifications_project_id_idx ON notifications (project_id);

CREATE UNIQUE INDEX notifications_user_source_event_idx
  ON notifications (user_id, source_event_id)
  WHERE source_event_id IS NOT NULL;
