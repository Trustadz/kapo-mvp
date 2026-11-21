# Changelog

## Unreleased

### Added

- First add-on plumbing and the **Assignee** reference add-on (issue #7):
  application modes, per-project enablement/inheritance, the generic
  `PATCH /api/projects/:id/addons/:identifier` value endpoint, a
  definition-driven project-page editor, registry→`addons` table sync,
  add-on search maintenance, audit/activity entries and isolated
  `onProjectPurge` hooks.

### Upgrade notes

- No schema migration: `projects.addon_data`, `projects.settings.addons` and the
  `addons` table already exist. Startup inserts a row for each registered add-on
  with mode `optional` without overwriting an existing Admin choice; existing
  installations therefore behave exactly as before until an Admin enables the
  add-on. Back up `./data` before upgrading as usual.

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
