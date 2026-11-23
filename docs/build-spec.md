# Kapo build spec (tech lead decisions)

This is the binding engineering contract for the MVP build. It resolves open questions in
`product.md`, `design-handoff.md`, `design-review.md` and `dashboard.md`. Where this document
and an older document disagree, this document wins; where it is silent, the Penpot design wins.

## 1. Locked product decisions

| Decision | Value |
|---|---|
| Scope | Full MVP per `product.md` §11, phased. Add-on registry ships as backend contracts + docs only. |
| Stack | Next.js 16 App Router, React 19, TypeScript strict, SQLite (better-sqlite3), single container. |
| Precedence | Penpot design > `product.md`. This spec > both where it records a decision. |
| Project page | Page 01 composition (breadcrumb, Favorite, settings menu, right Properties sidebar) + page 07 collection toolbar and four views. Page 07's alternate header (inline Status + `…`) is not implemented. |
| Completed-last-week widget | Cut from this iteration. Not registered, not in defaults, not in the editor. `docs/add-ons.md` records how to reintroduce it. |
| Viewer rights | May edit own profile, password, appearance and dashboard. Read-only on all project data. |
| Tablets | Inferred responsively; no separate tablet designs. |
| Purge | Automatic by default, 30 days after entering trash; Admin-configurable retention/enabled. No manual purge UI. |
| Theme | Light / Dark / System, stored per user, default System. |
| Install seed | Empty first run (`/setup` creates first Admin). Mock household data only via `npm run db:seed`. |
| SSO | Optional PocketID/OIDC sign-in configured by `KAPO_OIDC_*` environment variables. Existing users match by email (explicitly unverified emails are rejected) and keep their role; unmatched emails become Viewers. The `picture` claim is imported when the account has no avatar and `KAPO_OIDC_IMPORT_AVATAR` is on. Password login can be disabled with `KAPO_PASSWORD_LOGIN=disabled`. |

## 2. Repository layout

```
docs/                  product + engineering docs, reference screenshots
public/                logo.svg, manifest, icons, sw.js
scripts/               seed.ts, reset.ts
src/app/               routes (server components by default)
src/app/api/           JSON route handlers
src/components/        shared UI (CSS Modules)
src/lib/               client-safe helpers, formatting, types shared with UI
src/server/db/         connection, migration runner, migrations/*.sql
src/server/auth/       password hashing, sessions, current-user helpers
src/server/domain/     pure domain services (projects, workflow, permissions, trash, audit, search)
src/server/addons/     registry + types (no add-ons ship)
src/styles/            tokens.css, base.css, layout.css
tests/                 vitest unit/integration + e2e helpers
```

No `any` in exported signatures. No business rules in React components: components call
`src/server/domain/*` through route handlers or server functions. Domain modules must not import
React or Next.js.

## 3. Design tokens (source of truth)

Light: brand `#28614A`, brandDark `#1D4A38`, brandLight `#E8F2EC`, canvas `#F5F3EC`,
surface `#FFFFFF`, surfaceAlt `#F7F6F2`, border `#DDDCD5`, text `#173629`, muted `#65786B`,
soft `#9AABA0`, warning `#AA6736`, warningBg `#FFF2E5`, pulled `#F3F1EC`,
disabled `#F0EFEB`, disabledText `#8B8C85`.
Dark tokens mirror the Penpot `Kapo-Dark` / `Kapo-Theme-Dark` sets. Read them from the Penpot
tokens before implementing; do not invent colours.

Spacing `4/8/12/16/24/32`, radii `8/12/18`, font sizes `14/20/32` for body/title/display.
UI font Inter, icons Material Symbols Outlined (both self-hosted via npm packages; ship
licences). The Foundations specimen text in Penpot is stale (`#F7F9F6`, `#DDE7DF`); ignore it.

There are **no** brand illustrations, gradients or decorative shadows. Cards are white, 1px
border `#DDDCD5`, radius 12, no shadow. Buttons: primary filled brand, quiet = light
`brandLight` background, ghost/text where the design shows it. Focus ring 2px brandLight offset.
Archived rows use dashed border + muted text, never opacity below 0.7.

## 4. Routes

| Route | Purpose |
|---|---|
| `/setup` | First-install Create account (only when zero users). Creates Admin, signs in. |
| `/login` | Sign in. |
| `/` | Home dashboard (widgets per user). |
| `/inbox` | Global Inbox, Card presentation + release/Pulled. |
| `/search` | Search results; tabs Search / Trash. |
| `/trash` | Redirects to `/search?tab=trash`. |
| `/p/[id]` | Project page: header, details, properties sidebar, child collection (Kanban/Card/Tree/List), Activity. |
| `/p/[id]/settings` | Project settings: General, Workflow, Members, Layout tabs (`?tab=`). |
| `/profile` | Account, landing page, appearance, password change, avatar. |
| `/settings` | Application settings (Admin). |
| `/users` | User management (Admin). |
| `/api/*` | JSON endpoints, see §7. |

Root is `/p/<root-id>`; it has no status, no parent, cannot be archived/trashed/moved.
`/` shows the dashboard; the sidebar lists Home, Root, Inbox, Search, then Favorites.

## 5. Data model (SQLite)

`users` id, username unique nocase, email, password_hash, avatar, app_role
(`admin|user|viewer`), landing_page, appearance (`light|dark|system`), dashboard (JSON),
show_archived (0/1), created_at.

`sessions` id, user_id, token_hash unique, expires_at, created_at. 30-day sliding expiry.
Cookie `kapo_session`, httpOnly, sameSite lax, secure when `NODE_ENV=production` and HTTPS.

`user_identities` id, user_id, provider (issuer URL), subject, email_at_link, created_at,
last_login_at, unique `(provider, subject)` and `(provider, user_id)`; cascades on user delete.

`projects` id (uuid), seq (integer, `KAP-<seq>` display id), title, reporter_id, parent_id
(null only for Root), status_id (null only for Root), priority (integer, unique per parent,
0-based), inbox (0/1), archived (0/1), trashed_at, trash_action_id, purge_deadline,
addon_data (JSON), settings (JSON: `access` `inherit|custom`, inherit_layout, child_position
`below|above`, default_view, enabled_views, hidden_statuses, skip_inbox, layout_template),
created_by, created_at, updated_at.

`statuses` id, parent_id (the project that owns the workflow for its children), name,
position, is_start, is_finish. Exactly one start and one finish per parent (enforced in a
transaction); statuses are ordered and define Kanban columns.

`project_roles` project_id, user_id, role (`admin|user|viewer`), explicit grants only.

`favorites` user_id, project_id.

`audit_events` id, project_id (the log owner), actor_id, action, field, old_value, new_value,
target_id, detail, created_at. Append-only; no update/delete code paths.

`trash_actions` id, actor_id, created_at. Groups projects trashed in one operation.

`project_search` FTS5(project_id UNINDEXED, title, body). Maintained on every write.

`settings` key/value: `default_account_role`, `enabled_views` (JSON array), `trash_purge_enabled`,
`trash_retention_days` (default 30, 1–365), `installation_name`.

`addons` identifier, name, mode, settings JSON, created_at (empty in MVP).

IDs are UUID v4 strings. Timestamps are ISO-8601 UTC strings.

## 6. Domain rules to implement (non-negotiable)

1. Creating a project requires a title; id/status/priority/server fields are derived. New
   projects get the parent's start status, are appended last among siblings, and enter Inbox
   unless the parent sets `skip_inbox`. Reporter defaults to creator.
2. Permissions: each project has `settings.access` = `inherit` (default) or `custom`.
   `inherit`: effective role = explicit `project_roles` row if present, else the parent's
   effective role, recursively. `custom`: explicit `project_roles` rows only, no walk-up, so a
   project can be private even from application Admins. Root is `custom` with explicit grants
   plus the implicit Admin for application Admins. App Viewer is read-only everywhere. Creating
   a child requires at least `user` on the parent. A project must retain at least one effective
   project Admin; Root must retain at least one application Admin. Private = `custom` with only
   the chosen users.
3. Permission reduction/removal on a project cascades to descendants, overriding existing
   grants. Increases never propagate. Validate the whole subtree before writing; reject the
   operation if any project would lose its last Admin, naming them.
4. Moving a project requires explicit status mapping for every old status in use, even when
   names match. Reject cycles, reject destination without permission. Descendants keep their
   own statuses. Inapplicable add-on data is preserved.
5. Workflow edits: removing/replacing an in-use status requires explicit remapping of affected
   children. Trashed projects defer mapping until restore.
6. Inbox: release action clears `inbox` and keeps status; any status change clears it. Inbox
   is a flag, not a status.
7. Kanban: cross-column move changes status only; within-column reorder rewrites sibling
   priorities. Priority is shared across statuses among siblings.
8. Archive: archiving a parent hides the subtree; descendants' own flags are untouched.
   `show_archived` is per user and application-wide for that user.
9. Trash: trash action stamps every newly trashed descendant with the same `trash_action_id`
   and its own deadline from the Admin retention setting (default 30 days). A project already in
   trash keeps its original deadline unless an Admin changes the retention setting, which updates
   all trashed deadlines. Restore restores only projects from the same action; read-only until
   restored. Purge via the scheduled cleanup when enabled (`scripts/purge.ts` + app startup sweep).
10. Audit: project logs own field changes, creation, archive, trash. Parent logs child
    creation and child trashing only. No audit event for purge.
11. Search: FTS over titles (and future add-on text fields), permission-filtered, prefixes
    supported; archived results follow visibility; trashed never in ordinary results.
12. Every read path must be permission-filtered server-side; never leak titles or counts.

## 7. API conventions

JSON only. Errors: HTTP status + `{ "error": { "code", "message", "fields?" } }`.
Auth required except `/api/auth/*` and `/api/setup`. CSRF: same-origin check on mutating
requests (Origin/Host match) plus SameSite cookie. All mutations validate server-side.

```
POST /api/setup                       create first admin
POST /api/auth/login | logout         session
GET  /api/auth/pocketid/start         begin PocketID/OIDC sign-in
GET  /api/auth/pocketid/callback      complete PocketID/OIDC sign-in
GET  /api/me                          current user + prefs
PATCH /api/me                         profile/landing/appearance/dashboard/show_archived
POST /api/me/password                 change password
POST /api/me/avatar                   upload (png/jpeg/webp, <=2MB)
GET  /api/dashboard                   widget payloads, permission filtered
GET  /api/projects/:id                project + children + statuses + permissions + activity page
POST /api/projects                    create (parentId, title)
PATCH /api/projects/:id               title/status/archived/favorite
POST /api/projects/:id/move           { destinationId, mapping: {oldStatusId:newStatusId} }
POST /api/projects/:id/trash          { actionId? }  batch support
POST /api/projects/:id/restore        { mapping? }
POST /api/projects/:id/reorder        { statusId, beforeId|null }
GET  /api/projects/:id/workflow       statuses
PUT  /api/projects/:id/workflow       statuses + remapping
GET/PUT /api/projects/:id/settings    layout/view settings
GET/PUT /api/projects/:id/members     roles + cascade validation
GET  /api/inbox                       permission-filtered queue
POST /api/inbox/:id/release           clear inbox flag
GET  /api/search?q=                   results
GET  /api/users  POST/PATCH           admin user management
GET/PUT /api/settings                 application settings
```

## 8. UI rules

- Use `docs/reference/*.png` and the Penpot file as the visual source. Fonts, spacing, colours
  and control sizes come from there, not from Tailwind defaults.
- 244px sidebar (collapsed 72px, icon-only with tooltips), 64px top bar with global capture and
  Search, content max-width follows the design (project page fills, settings forms 1100px).
- Buttons 40px tall, radius 8; inputs 42px tall, radius 8, border token; labels beside controls
  on desktop, above on mobile; field widths reflect content, never full-bleed.
- Mobile: 390px reference, bottom bar Home / Root / Add / Inbox / Search, capture via Add sheet.
- Every destructive/transition flow gets a dialog with explicit mapping or confirmation.
- Empty states are short and actionable. No fake demo content in an empty install.
- Accessibility: semantic landmarks, labels for every control, keyboard-operable menus,
  visible focus, 4.5:1 text contrast, `aria-current` on nav.

## 9. Commands

```
npm run dev            # next dev
npm run build          # next build
npm run start          # next start
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm run test:e2e       # playwright (if browser available)
npm run db:seed        # mock household data
npm run db:reset       # drop + migrate + seed
```

Environment: `DATABASE_PATH=./data/kapo.db`, `UPLOAD_DIR=./upload`,
`SESSION_SECRET` optional (sessions are DB-backed random tokens; also signs the
short-lived OIDC state cookie). PocketID SSO is configured with
`KAPO_OIDC_ISSUER`, `KAPO_OIDC_CLIENT_ID`, `KAPO_OIDC_CLIENT_SECRET`,
`KAPO_OIDC_SCOPES`, `KAPO_OIDC_PROVIDER_NAME`, `KAPO_OIDC_AUTO_PROVISION`,
`KAPO_OIDC_IMPORT_AVATAR`, `KAPO_OIDC_ALLOW_INSECURE` and
`KAPO_PASSWORD_LOGIN`.

## 10. Mock data (seed)

Users: `admin` / `kapo1234` (Admin), `maya` / `kapo1234` (User), `jules` / `kapo1234` (User),
`alex` / `kapo1234` (Viewer). Root workflow: To do (start), In progress, Done (finish).
Projects: Home improvement (Root child, with Renovate basement → Find contractor, Paint hallway,
Install hall shelf, Garden beds, Fix kitchen tap), Household (Paint porch, Book boiler service),
Personal (Plan weekend trip). Inbox: Book boiler service, Plan weekend trip, Renovate basement.
Favorites: Home improvement, Household, Personal. Activity events across all actors, with
previous/new values. Dashboard default: Inbox + Recent changes (Completed last week omitted).

## 11. Agent write scopes (avoid concurrent edits)

| Agent | Owns |
|---|---|
| builder-foundation | config, `src/server/db`, `src/server/auth`, `src/server/addons`, `src/styles`, `src/app` layout+shell, `src/components/ui`, `src/components/shell`, `public`, Docker, seed, README |
| builder-projects | `src/app/p/**`, `src/app/inbox/**`, `src/app/search/**`, `src/app/api/projects/**`, `src/app/api/inbox/**`, `src/app/api/search/**`, `src/server/domain/projects*`, workflow, permissions, trash, audit, search |
| builder-settings | `src/app/profile/**`, `src/app/settings/**`, `src/app/users/**`, `src/app/api/me/**`, `src/app/api/users/**`, `src/app/api/settings/**`, `src/app/api/dashboard/**`, `src/server/domain/users`, dashboard, settings |
| tester | `tests/**`, `playwright.config.ts` |
| architect | `docs/architecture.md`, `docs/add-ons.md`, `docs/architecture-review.md` |
| designer | `docs/design-review-app.md`, `docs/screenshots/**` |
| product-owner | `docs/product-review.md` |

## 12. Add-on contracts (first add-on plumbing shipped in issue #7)

`src/server/addons/types.ts` defines `AddonMode` (`required|always|optional|unavailable`),
`AddonFieldType` (`boolean|number|text|longtext|date|select|user`), `AddonFieldDefinition`
(with static `options`, or `optionsSource: 'users'` for a permission-filtered dynamic list),
`AddonDefinition` (identifier `/^[a-z][a-z0-9-]*$/`, name, version, fields, `searchFields`,
`compactRenderer`, `dashboardWidgets`, hooks `validate` / `beforeLeaveInbox`), and
`AddonWidgetContext { viewerId, visibleProjectIds, query(sql, params) }` — a read-only helper,
never a write handle.

`registry.ts` validates identifier shape, duplicates (add-on and field keys), `select`
`options`/`optionsSource`, that `user` fields have neither, and that `searchFields` reference
`text`/`longtext` fields. The manifest registers the **Assignee** reference add-on; a malformed
definition is logged and skipped rather than crashing startup.

Storage is live: `projects.addon_data[identifier][fieldKey]` holds values and survives
disabling/unavailability; `projects.settings.addons[identifier] = { enabled,
inheritFromParent, settings }` holds enablement. Issue #7 implements the generic
`PATCH /api/projects/:id/addons/:identifier` value write, `/settings` add-on modes and the
project Add-ons tab, registry→`addons` table sync, search maintenance and `onProjectPurge`
hooks. Per-add-on renderer/widget consumers remain FORWARD in `docs/add-ons.md`.
