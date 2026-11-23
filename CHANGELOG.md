# Changelog

## Unreleased

### Added

- **Project descriptions** with a swappable provider. Core owns the durable
  description record and a mandatory plaintext fallback; the built-in
  **Markdown description** provider supplies the editor (with Edit/Preview
  tabs) and renderer. Admins choose the active provider under Settings →
  Add-ons. Descriptions are permission-checked, audited, searchable through
  their plaintext and read-only for Viewers and trashed projects. When no
  provider is active, the description stays editable as plain text; the
  Markdown provider can reopen plain-text records.
- **Capability protocol** for compiled-in add-ons: capabilities and declared
  read/write formats. The first capability is `description`; add-ons without a
  capability declaration remain property add-ons.
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
- The **reporter filter** now uses the same searchable avatar Combobox as the
  add-on user picker, replacing the native select.
- **Focused project layout**: Project settings → Layout now offers a
  “Children and history only” page that hides the Details and Properties
  cards, leaving the child viewer and project history. Root uses this layout
  by default; Root also no longer shows its redundant breadcrumb, page title
  or Favorite control, while the project actions menu stays available.
  Ordinary projects keep the full layout by default and can switch either way.
  The choice is stored in `settings.layout_mode`; no schema migration is
  needed.
- **PocketID / OpenID Connect single sign-on**, configured with `KAPO_OIDC_*`
  environment variables rather than database settings, so the client secret is
  never stored in SQLite or its backups. The login page shows a **Continue with
  PocketID** button. An email that matches exactly one existing account and is
  not reported as unverified links it and keeps its role; an unmatched email
  creates a Viewer. A missing, explicitly unverified, ambiguous or already-linked
  email is rejected. `sub` is stored as the permanent identity, so later email
  changes do not move the account.
- `KAPO_PASSWORD_LOGIN=disabled` hides and rejects password sign-in. Kapo keeps
  password login enabled when OIDC is not configured, so a configuration
  mistake cannot lock the household out. The first-run `/setup` Admin still
  uses a local password.
- `KAPO_OIDC_AUTO_PROVISION=0` refuses unknown emails instead of creating
  Viewers. `KAPO_OIDC_ALLOW_INSECURE=1` exists only for local HTTP testing.
- When an account has no Kapo avatar, the PocketID `picture` claim is imported
  through the existing avatar validation: issuer origin only, no redirects,
  five-second timeout, 2 MB cap, PNG/JPEG/WebP magic bytes. A locally uploaded
  avatar is never overwritten; `KAPO_OIDC_IMPORT_AVATAR=0` disables the fetch.
- New `user_identities` table (migration `005`) mapping the OIDC issuer and
  subject to a local user. OIDC sign-in ends by creating the same
  database-backed Kapo session as password login, so guards and API routes are
  unchanged.
- Integration and e2e coverage uses a local mock OIDC provider; no PocketID
  container is required in CI.

- **In-app notifications.** A bell in the desktop top bar (right of Search)
  and next to the avatar on mobile shows the unread count. The overflow panel
  lists the newest notifications with message, project/add-on origin, action
  link and timestamp; unread items are visually distinct. Closing the panel
  marks all visible notifications read. A full `/notifications` page provides
  the paginated history and an explicit “Mark all as read” action.
- **Watch a project.** An eye toggle beside Favorite subscribes the current
  user to a project. Every history entry for that project creates a
  notification for its watchers, including child-created/child-trashed entries
  that belong to the watched project's own history. Routine edits inside child
  projects do not notify parent watchers, and a user is never notified about
  their own action. Watching is personal and never grants access.
- **Add-on notification endpoint.** Add-ons can supply an `onValuesSaved`
  hook and call `notify({ recipients, message, kind, translations, data, href,
  sourceEventId })` after their value write commits. Core owns storage, read
  state, badge and UI; recipients are permission-filtered, so an add-on cannot
  notify a non-member. Core and add-on copy supports English/Dutch, with a
  plain-text fallback.
- Per-user retention keeps the latest 200 notifications; older read rows are
  pruned on write. Notifications are removed with a purged project.

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
- The project page now groups **Details, Properties and the collection view** in
  one white workspace instead of separate cards, with a divider between Details
  and Properties.
- Form controls (search, status, reporter/add-on comboboxes and inputs) share
  the same softer border treatment. Mobile Activity history uses tighter side
  padding, and the drag instructions are visually hidden while remaining
  available to screen readers.
- The Markdown editor is available for add-on longtext values only; no schema
  migration or release/version change is included.

- Added [docs/markdown.md](docs/markdown.md), documenting the supported Markdown
  subset, link safety, and compact/collection-card behavior.
- The child-collection view selector and Add action now share the filter row,
  and the button reads “Add new”.

### Fixed

- Installed PWAs now receive manifest changes (theme colour, name, icons) instead
  of serving a frozen copy from the service worker cache. The manifest is no
  longer precached or intercepted by `public/sw.js`.

### Security notes

- Disabling a user in PocketID does not revoke an existing Kapo session (up to
  30 days). Signing out of Kapo does not sign out of PocketID. Set
  `SESSION_SECRET` when SSO is enabled to keep in-flight sign-ins valid across
  restarts.

### Upgrade notes

- Migration `007_description_capability.sql` adds the `project_descriptions`
  and `addon_capabilities` tables. Existing projects start without a
  description and no data migration is needed. The only registered description
  provider is active by default; an Admin can choose another provider or
  plain-text-only mode in Settings.
- Migration `006_notifications.sql` adds `project_watches` and
  `notifications`. No manual action is required; existing projects, history
  and access are unchanged.
- Push notifications are intentionally not part of this change. The
  notification service is the single insertion point a future Web Push
  delivery layer can use.
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
