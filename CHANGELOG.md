# Changelog

## Unreleased

### Changed

- **Layout and add-on settings copy from the parent once at project creation**
  instead of syncing live. Later parent changes no longer affect existing
  children. Access/permission inheritance is unchanged and stays live.
- Project **General** settings no longer duplicate Default view or Inherit
  layout; **Layout** no longer offers Inherit layout; the project **Add-ons**
  tab no longer offers Inherit from parent. Enable/disable and field editing
  remain.
- Project settings tabs now guard unsaved edits with a translated “Discard
  unsaved changes?” confirmation and a `beforeunload` warning, and show an
  “Unsaved changes” indicator.

### Upgrade notes

- No schema migration is needed. On first startup after upgrading (and in
  `db:migrate` / seed / setup), a one-time snapshot is applied: each existing
  project gets its pre-upgrade effective layout written to its own
  `settings.layout_template` with `inherit_layout=false`, and an explicit
  add-on configuration (`enabled` = previously resolved availability,
  `inheritFromParent=false`, `settings` = previously resolved settings).
  Unknown add-on identifiers and config keys are preserved, so nothing visible
  changes.
- The snapshot is marked by the `inheritance_snapshot_v1` application setting
  and runs in a single transaction. If it fails, the marker is not written and
  startup logs the error and retries on the next boot (startup is not blocked).
  Back up `./data` before upgrading as usual.

## 0.3.0 — 2026-11-21

### Added

- **Touch drag and drop** across Inbox Card/Tree and project Card/Tree/List,
  with long-press activation, release rail, ghost/insertion previews,
  autoscroll and cancel cleanup. Kanban keeps its existing touch path.
- First add-on plumbing and the **Assignee** reference add-on (issue #7):
  application modes, per-project enablement/inheritance, the generic
  `PATCH /api/projects/:id/addons/:identifier` value endpoint, a
  definition-driven project-page editor, registry→`addons` table sync,
  add-on search maintenance, audit/activity entries and isolated
  `onProjectPurge` hooks.
- Wider Inbox cards with the release rail fixed at sidebar width.
- Project view position (above/below Details and Properties) from the
  **Layout** tab, with Above listed first.
- Mobile browser/overscroll edges now match the top and bottom bars.

### Changed

- Changed-field feedback is now a quiet background tint without the left
  accent stripe or negative margins.

### Upgrade notes

- No schema migration: `projects.addon_data`, `projects.settings.addons` and the
  `addons` table already exist. Startup inserts a row for each registered add-on
  with mode `optional` without overwriting an existing Admin choice; existing
  installations therefore behave exactly as before until an Admin enables the
  add-on. Back up `./data` before upgrading as usual.
- No other upgrade steps; use the normal `docker compose pull && docker compose
  up -d` update flow.

## 0.2.0 — 2026-11-20

First production-oriented release. See the GitHub release notes for the full
summary; the upgrade steps below are the important part.

### Upgrade notes

- **Uploads moved out of the database folder.** The default is now `./upload`
  (container `/app/upload`), alongside `./data` (SQLite) and `./backup`. Existing
  installs must move `data/uploads/*` to `upload/` before starting 0.2.0, then
  add the `./upload:/app/upload` mount to Compose, or avatars will appear to be
  missing.
- **Compose simplified.** The production file now uses the prebuilt
  `ghcr.io/trustadz/kapo-mvp:latest` image, host folders `./data`, `./upload`
  and `./backup`, and no variables/init container. The image entrypoint repairs
  folder ownership and drops to UID/GID 1001.
- **Trash purge is an application setting.** `KAPO_DISABLE_PURGE` has been
  removed. Use **Settings → Application settings → Automatically purge trash**;
  it is enabled by default with a **30-day** retention (1–365). Changing the
  retention updates deadlines for projects already in Trash.
- **Upgrade steps:** stop the container, move/upload the old upload files,
  update the Compose mounts/image, then `docker compose pull && docker compose up -d`.
  Database migrations run automatically. Back up `./data`, `./upload` and
  `./backup` before upgrading.
