# Changelog

## Unreleased

### Added

- **Inline project title editing** on the project page. Editors click the title
  (or press Enter/Space on it) to rename in place; Enter or blur saves, Escape
  cancels, and an unchanged title sends no request. Successful saves show a
  toast and refresh the page data; a rejected title keeps the editor open with
  the server field error. Viewers and trashed projects keep a plain heading.
- Reusable **Markdown** and **MarkdownTextarea** primitives in
  `src/components/ui`: a dependency-free renderer for paragraphs, line breaks,
  bold/italic/code, http(s) links and lists that never injects raw HTML, plus a
  controlled Edit/Preview textarea. Add-on longtext fields use them.
- A reusable **Combobox** primitive for searchable single-selects with optional
  avatars and descriptions. The add-on user field and `optionsSource: 'users'`
  selects use it.

### Changed

- Add-on fields now edit **inline from their Details/Properties row** for every
  field type: text, number, date, boolean, select, user-backed select and user.
  Enter/blur saves text-like fields, Escape cancels, booleans save immediately,
  selects save on change, and the editor keeps the existing user picker's
  searchable avatar list. Longtext opens a compact Markdown editor with
  Save/Cancel and renders the saved Markdown in Details/Properties. Collection
  card meta keeps longtext as stripped plain text. The per-field PATCH
  semantics, permissions, audit entries and APIs are unchanged; the old add-on
  edit dialog and its styles are removed.
- The Markdown editor is available for add-on longtext values only; no schema
  migration or release/version change is included.

## 0.4.1 — 2026-11-22

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
- Add-on fields are now real layout fields. The standalone **Add-ons** card on
  the project page is gone: add-on fields can be placed in **Details**, the
  **Properties** sidebar and per-view properties through the opaque
  `addon:<identifier>:<fieldKey>` slot reference. Field rows render the label
  and formatted value; editors open a small add-on dialog from the row, while
  Viewers and trashed projects see the value read-only. Collection views render
  compact add-on meta values, unavailable add-ons hide their slots and layout
  selectors only offer fields from add-ons effectively available for the
  project. No schema migration.
- Container images and GitHub Releases are published only by the manual
  **Publish container** workflow. Pull requests and pushes to `main` run the
  automatic **Verify** workflow without publishing; publishing calculates the
  next version from the latest stable tag (`patch`, `minor`, or `major`), so no
  release-version commit is needed. Release notes combine the curated
  `## Unreleased` section with GitHub's generated PR list.

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

## 0.4.0 — 2026-11-21

### Added

- **AI access (MCP)**: an opt-in core MCP server (`POST /api/mcp`, Streamable
  HTTP, personal bearer tokens) lets a user's own local AI client — Open WebUI
  with llama.cpp, Claude Desktop, or any MCP-capable client — read and update
  the board as that user. It ships 11 generic tools over the existing domain
  commands; add-on data is read through `get_project` and written through
  `set_addon_values`, with no per-add-on tools.
- **Per-user MCP tokens** under Profile → AI access: create, name, copy once and
  revoke. Tokens are hashed at rest, capped at 10 active per user, and
  revocation is immediate.
- **AI provenance in history**: MCP writes remain attributed to the human owner
  and show a small AI badge plus `(via <token label>)` in project activity and
  dashboard recent changes. The label is snapshotted from the token row, so a
  client cannot relabel itself.
- **Admin toggle** under Settings → AI access (MCP), off by default. Disabling
  blocks every token immediately without deleting tokens or history.
- `docs/mcp.md`: a user guide for enabling the feature, creating a token,
  connecting Open WebUI / Claude Desktop / other clients, what the assistant
  can and cannot do, security and troubleshooting.

### Changed

- MCP output omits internal bookkeeping: no `KAP-…` display numbers, no sibling
  priority values and no raw add-on audit detail. Projects are addressed by
  opaque ids and referred to by title.
- `KAPO_DEV_ORIGINS` lets `next dev` accept extra hostnames/IPs (a VM or LAN
  address). Without it the HMR socket is rejected and pages do not hydrate.
  `KAPO_E2E_PORT` and `KAPO_E2E_DATABASE` let parallel worktrees run the e2e
  suite without sharing a port or database.

### Upgrade notes

- Apply migration `004_mcp.sql`: it creates `mcp_tokens` and adds three nullable
  provenance columns to `audit_events`. It is additive; existing history is
  unchanged and shows no AI marker.
- MCP is off by default on existing installations. Enable it under
  Settings → AI access, then create a personal token under Profile → AI access.
- Back up `./data`, `./upload` and `./backup` before upgrading as usual.


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
