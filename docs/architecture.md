# Kapo implementation architecture

**Status:** normative for the MVP build · **Owner:** architect · **Scope:** this iteration.
Companion documents: [build-spec.md](build-spec.md) (binding decisions), [add-ons.md](add-ons.md)
(extension contract), [architecture-review.md](architecture-review.md) (findings against code).

Precedence: `docs/build-spec.md` wins over this document; this document wins over older notes in
`design-review.md` and `dashboard.md` where it records an implementation decision. Where this
document names a module or function that code does not yet have, `architecture-review.md` records
the drift; do not "fix" the doc to match accidental implementation.

---

## 1. Runtime topology

One Next.js 16 application in one container, one SQLite database file on one mounted volume, no
external services. One Node.js process. That single-process assumption is a load-bearing
architectural decision, not an accident: migrations, the trash scheduler, and FTS maintenance all
assume exclusive ownership of the database file.

```
browser / PWA
   │  HTTPS (terminated by reverse proxy in production)
   ▼
Next.js 16 process ─┬─ React 19 server components  (reads; migrations run on first DB access)
                    ├─ /api/* route handlers        (all mutations + client reads)
                    ├─ instrumentation startup      (purge sweep at boot, then every 6 hours;
                    │                                daily backup scheduler; registry→addons
                    │                                sync still FORWARD)
                    └─ better-sqlite3 (WAL) ── ./data/kapo.db
                                                 ./data/uploads/*
                                                 /backup/kapo-YYYYMMDD-HHMMSS/
```

Deployment invariants:

- `replicas: 1`. Two processes against the same SQLite file (two containers, or `next start` twice)
  is unsupported: SQLite allows many readers but one writer, and the in-process scheduler and
  migration runner would race. Do not put the app behind a load balancer with more than one
  upstream.
- The database and uploads directory must live on a named volume, not the container layer.
- `next build` is done in the image; `next start` (or the standalone server) runs at boot.
- Application code runs as a non-root user; the data directory is the only writable path.

The Web client is a thin, server-authoritative layer. There is no client-side data store to keep
in sync and no offline write queue (offline operation is explicitly not promised).

## 2. Layers and dependency rules

Six layers, strict one-way imports.

| # | Layer | Location | May import | Must never import |
|---|---|---|---|---|
| 1 | Routes / RSC pages | `src/app/**` | 2–6, `src/lib` | — |
| 2 | Domain services | `src/server/domain/**` | 3, 4, `src/lib` | React, Next.js, `src/app/**`, `src/components/**` |
| 3 | Add-on registry | `src/server/addons/**` | `src/lib`, add-on definitions | React client code, `src/app/**`, `src/components/**`; domain modules only through injected capabilities |
| 4 | Persistence | `src/server/db/**` | `src/lib` | `src/server/domain/**` |
| 5 | Auth primitives | `src/server/auth/**` | 4, `src/lib` | `src/app/**`, `src/components/**` |
| 6 | Shared UI | `src/components/**`, `src/lib/**` | `src/lib` only | every `src/server/**` module from client components |

Rules that are enforced by review and must not be relaxed:

1. **No business rules in components.** A React component may format, lay out, disable controls and
   call a route handler. It may not decide a role, status transition, trash deadline, priority
   index or audit event.
2. **Domain never imports React or Next.** `src/server/domain/*` is plain TypeScript over a
   `better-sqlite3` `Database` handle. This is what makes the domain testable in vitest without a
   browser and what keeps `docs/add-ons.md` contracts framework-agnostic.
3. **Client components never import `src/server/**`.** They receive serialisable props from a
   server component and mutate through `/api/*` with `fetch`. Type-only imports from `src/lib` are
   the only shared surface.
4. **Server components may read through domain query functions directly** (no HTTP round trip on
   the server), but **all mutations go through route handlers** under `/api/*`. Server Actions are
   not used in this build: one mutation surface keeps the CSRF check, error shape, and add-on
   validation hook in one place (see §7).
5. **No `any` in exported signatures.** Unknown JSON is `unknown` and narrowed at the boundary.

```ts
// the only database handle domain code sees
import type Database from 'better-sqlite3';
export type Db = Database.Database;
```

`src/server/domain/*` functions are synchronous (better-sqlite3 is synchronous). Route handlers are
`async` only because the Next.js signature is async and because request-body parsing is async.

### 2.1 Request paths

**Read path (server component):**

```
RSC page (src/app/**) → requireUser() → domain query(db, viewerId, …) → serialised props → client component
```

**Mutation path (route handler):**

```
route handler → assertSameOrigin(req) → requireUser()/requireRole() → parse+validate body
              → domain command(db, actorId, …) → withTransaction(BEGIN IMMEDIATE) → audit + FTS + addon hooks
              → JSON response; client calls router.refresh()
```

Route handlers share helpers, currently in two stacks (consolidation pending, AR-041):
`src/server/http.ts` (`isSameOrigin`, `jsonOk`/`jsonError`, `readJsonBody`),
`src/app/api/projects/_shared.ts` (`requireApiUser`, `guardMutation`, `handleDomainError`) and
`src/server/api-session.ts` / `api-errors.ts` (`apiSession`/`apiAdminSession`, `sameOriginGuard`,
`domainErrorResponse`). The prologue is: same-origin (mutations only), auth, JSON body parse, domain
call, map `DomainError`/`AccountError`/`SettingsError` to the error envelope; unexpected errors
bubble to a Next 500. Handlers stay thin; no handler contains rule logic.

### 2.2 Errors

There is no shared `domain/errors.ts` yet; `DomainError` lives in
`src/server/domain/permissions.ts` and the account/settings domains add `AccountError` and
`SettingsError` with the same shape (consolidation recommended, AR-041):

```ts
// src/server/domain/permissions.ts (actual)
export class DomainError extends Error {
  readonly status: number;   // HTTP status the route should return
  readonly code: string;     // machine code: not_found, forbidden, validation_failed,
  readonly fields?: Record<string, string>; // mapping_required, last_admin, acknowledgement_required,
}                            // trashed_read_only, already_trashed, not_trashed, parent_trashed, …
```

API error contract (build-spec §7): `{ "error": { "code", "message", "fields?" } }`. Observed codes
include `unauthenticated`, `forbidden`, `not_found`, `validation_failed`, `mapping_required`,
`last_admin`, `acknowledgement_required`, `trashed_read_only`, `already_trashed`,
`username_taken`, `csrf_rejected`, `rate_limited`. Validation failures use 422; missing/invalid
auth 401; project authorization uses **404 for projects the caller may not read** (never confirm
existence); 403 is used for a known project where the caller lacks the capability. Domain mutations
never return `null` on failure; they throw and route handlers map the error.

## 3. Data model rationale

`src/server/db/migrations/001_init.sql` implements build-spec §5. The choices that need explaining:

| Table | Why this shape |
|---|---|
| `projects` | One self-referencing table for "everything is a project": Root is the single row with `parent_id IS NULL` and `status_id IS NULL`. `seq` is the human display id (`KAP-<seq>`) and is separate from UUID `id`; `priority` is sibling order, shared across statuses. `trashed_at`/`purge_deadline`/`trash_action_id` are denormalised per row because purge is scheduled per project and restore is scoped per trash action. |
| `statuses` | `statuses.parent_id` is the **workflow owner**, i.e. the project whose children use these statuses. A project's own `status_id` must reference a status whose `parent_id = projects.parent_id` (Root has none). This is what makes "each parent owns its children's workflow" a relational fact rather than an application convention. |
| `project_roles` | Explicit grants only, PK `(project_id, user_id)`. There is no materialised effective-role table and no transitive closure. Effective role is a walk up `parent_id` to the nearest grant (see §6.2). Why: increases never propagate, reductions cascade, and a per-user row per project would require rewriting the whole subtree on every change and would still not encode "nearest wins". Explicit-only keeps the table small (≈10 users × projects) and makes each row auditable. |
| `trash_actions` | One row per trash operation. Restore restores exactly the projects carrying that `trash_action_id`; a descendant trashed earlier keeps its own action, which is how "restore only what this action trashed" works without a tree diff. The 30-day deadline is per project, so a project already in trash keeps its original deadline when an ancestor is trashed. |
| `audit_events` | `project_id` is the **log owner**, `target_id` is the affected project. A child creation writes an event into the child's log and one into the parent's log; routine child edits only touch the child's log. Append-only is an invariant of the table (§9), not just of UI: no code path updates or deletes events except the purge of that project's own log. |
| `project_search` | FTS5 virtual table `(project_id UNINDEXED, title, body)`. It is an index, never a source of truth: rows are rebuilt from `projects` inside the same transaction as the write. `project_id` is UNINDEXED because queries always join it back to `projects` to apply permission and lifecycle filters; the FTS row is never returned directly to a client. |
| `sessions` | Opaque random token, only its SHA-256 hash stored. DB-backed so logout and role changes are effective immediately; no signed-cookie forensics. |
| `settings` | Key/value because application settings are few, typed at the repository boundary, and expected to grow (add-on modes). |

### 3.1 SQL-level invariants

These are enforced in SQL as a second line of defence behind the domain transaction; a bug in one
service must not be able to persist a corrupt workflow.

```sql
-- src/server/db/migrations/001_init.sql, verified in the build
PRAGMA foreign_keys = ON;          -- set on every connection
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE UNIQUE INDEX statuses_one_start_idx  ON statuses(parent_id) WHERE is_start  = 1;
CREATE UNIQUE INDEX statuses_one_finish_idx ON statuses(parent_id) WHERE is_finish = 1;
-- workflow owner owns ordered columns; exact-one-start/finish is a transaction rule
UNIQUE (statuses.parent_id, statuses.position);
UNIQUE (statuses.parent_id, statuses.name);
-- sibling priority is unique per parent across statuses; includes trashed rows
UNIQUE (projects.parent_id, projects.priority);
CREATE UNIQUE INDEX projects_seq ON projects(seq);
-- Root is unique by trigger, not by a NULL parent constraint:
CREATE TRIGGER projects_single_root_insert ...
CREATE TRIGGER projects_single_root_update ...
```

Notes (verified against `001_init.sql`):

- `projects.id` is a UUID v4 string (`crypto.randomUUID()`), `seq` is the human display id. The
  foundation allocates `MAX(seq)+1` at Root creation; every later create must allocate inside a
  `BEGIN IMMEDIATE` transaction. `MAX(seq)+1` reuses the highest id after a purge of the newest
  project — acceptable for the MVP but a known audit-reference wart (review finding: prefer a
  persistent counter).
- **The priority uniqueness constraint includes trashed siblings.** Reorder is two-phase
  (`BEGIN IMMEDIATE`, offset the affected range, then rewrite `0..n-1`) and must account for
  trashed rows when computing slots, or it will collide. This is a real implementation trap; the
  invariant tests must cover trash + reorder.
- `project_roles` and `favorites` are `ON DELETE CASCADE`; `projects.parent_id` and
  `projects.status_id` are the tree/status FKs (`parent_id` CASCADE on purge, `status_id` RESTRICT
  so an in-use status cannot be deleted before remapping).
- `audit_events.project_id` is `ON DELETE CASCADE`; only an `UPDATE`-blocking trigger exists
  (`audit_events_append_only`). Deletes happen for a purged project's own log through the cascade;
  no domain code may delete audit rows otherwise.
- `project_search` has no FK or uniqueness; rows are replaced by `indexProject` (delete then
  insert) in the same transaction as the project write, and removed on purge.

## 4. Module contracts

`src/server/domain/` is the only place business rules live. Signatures below are the implemented
contract (verified against the code at review round R3); parameter names are stable enough for
tests to depend on.

```ts
// projects.ts (1184 lines; owns create/update/move/reorder/settings/page data)
createProject(db, user: AccessUser, { parentId, title }): ProjectCard;
updateProject(db, user, projectId, { title?, statusId?, archived? }): { project };
moveProject(db, user, projectId, { destinationId, mapping }): ProjectCard;
reorderProject(db, user, projectId, { statusId?, beforeId? }): ProjectCard;
getProjectPageData(db, user, projectId): ProjectPageData | null;
getMoveInfo(db, user, projectId): MoveInfo;
getProjectSettings(db, user, projectId): ProjectSettingsData;
updateProjectSettings(db, user, projectId, input): ProjectSettingsData;
setProjectFavorite(db, user, projectId, favorite: boolean | null): { favorite };
```

```ts
// permissions.ts (735 lines; owns authz, visibility, member changes)
loadAccessContext(db, user: AccessUser): AccessContext;  // full tree + grants once per request
getRole(ctx, projectId): ProjectRole | null;
canReadProject / canEditProject / canAdminProject(ctx, projectId): boolean;
isActiveProject / isTrashVisibleProject / isArchivedHidden(ctx, projectId): boolean;
visibleProjectIds(ctx): Set<string>;                     // permission-filtered active set
applyMemberChanges(db, projectId, changes: MemberChange[], { acknowledged, actor }): result;
planMemberUpdate(...): MemberUpdatePlan;                 // pure simulation for previews/tests
listProjectMembers(db, projectId): ProjectMember[];
```

```ts
// workflow.ts (523 lines; owns parent-owned child workflows + remapping)
listWorkflow(db, parentId): Status[];
ensureWorkflow(db, parentId): Status[];                  // mutating commands only (create/move); read paths use listWorkflow
replaceWorkflow(db, actor, parentId, rawStatuses, rawMapping): ReplaceWorkflowResult;
getWorkflowData(db, parentId): { statuses, usage, retired };
pruneRetiredStatuses(db, parentId): number;
```

```ts
// trash.ts (420 lines; owns the 30-day lifecycle)
trashProjects(db, actor, projectIds, requestedActionId?): { actionId, trashed };
restoreProject(db, actor, projectId, rawMapping?): { project, restored };
getRestoreInfo(db, actor, projectId): RestoreInfo;       // deferred mapping preview
listTrash(db, actor): TrashItem[];
```

```ts
// audit.ts (179 lines; append-only writes + paginated reads)
recordAuditEvent(db, event: AuditEventInput): void;      // inside the mutating transaction
listActivity(db, projectId, { limit?, cursor? }): ActivityPage;
```

```ts
// search.ts (158 lines; FTS + permission filtering)
searchProjects(db, actor, rawQuery, { limit? }): SearchResultItem[];
searchTrash(db, actor, rawQuery): TrashItem[];
```

```ts
// inbox.ts (82 lines)
listInbox(db, actor): InboxItem[];
releaseInboxProject(db, actor, projectId): ProjectCard;   // clears inbox, keeps status
```

```ts
// users.ts (724 lines; includes avatar storage + profile)
createUser(db, { username, email, password, appRole? }): Promise<AccountUser>;
updateUser(db, { id, ...patch }): Promise<AccountUser>;
updateOwnProfile(db, userId, input): AuthUser;
changeOwnPassword(db, userId, currentSessionId, input): Promise<void>;
saveAvatar(db, userId, buffer, declaredMime): string;     // magic-byte checked, safe filename
listUsers / getUserAccount / resolveLandingHref(db, user): string;
```

`settings.ts` owns application settings/clients (`getApplicationSettings`,
`updateApplicationSettings`). `dashboard.ts` did not exist at R3; dashboard payloads are still
pending (owner: builder-settings).

Transaction boundaries: the code uses better-sqlite3's synchronous `db.transaction(() => …)`
directly in each command instead of a shared `BEGIN IMMEDIATE` helper. That is atomic, but
`db.transaction` defaults to deferred locking; a read-then-write inside the callback can contend
under concurrency. Household scale makes this acceptable for the MVP; a shared immediate-transaction
helper is the recommended hardening (review AR-030). Domain functions never import React/Next; they
do import view-model types from `src/components/projects/types.ts` today, a layering inversion the
review flags (AR-028).

## 5. Domain rules and where they are enforced (build-spec §6)

Every row is a rule, the module that owns it, and the test that must fail if it regresses. Test
files are owned by the tester per build-spec §11; names are the required minimum.

| # | Rule | Module / function | Enforced in | Required test expectation |
|---|---|---|---|---|
| 1 | Create: title required; id/status/priority/server fields derived; parent start status; appended last sibling; Inbox unless parent `skip_inbox`; reporter defaults to creator | `domain/projects.createProject`, `domain/permissions` | one transaction; title validated by `src/lib/validation` (`422 validation_failed` for empty/too-long) before insert; priority computed inside the transaction | `tests/domain/capture.test.ts`: title → project with parent start status, last priority, `inbox=1`; skip_inbox parent → `inbox=0`; reporter defaults to actor; empty title 422 |
| 2 | Effective role walking up; app admin→admin on Root only; app user no implicit project access; app Viewer read-only; child creation needs `user` on parent; project must retain one Admin; Root retains one app Admin | `domain/permissions.getEffectiveRole` / `requireRole` / `assertLastAdmin` | every read path in SQL/CTE or `requireRole`; member changes validate whole subtree before write; user-role change validates Root admin count | `tests/domain/permissions.test.ts`: nearest grant wins; grant on descendant without ancestor access; app viewer cannot write anywhere; last project admin removal rejected naming project; last app admin demotion rejected |
| 3 | Reduction/removal cascades to descendants overriding existing grants; increases never propagate; validate whole subtree and reject naming losers | `domain/permissions.setMemberRole`, `validateSubtreeAdmins` | transaction: compute subtree, simulate, reject with `LAST_ADMIN_REQUIRED` + `fields.projects`; then rewrite grants | `tests/domain/cascade.test.ts`: parent user→viewer rewrites descendant admin row; increasing parent leaves descendant row; losing last admin rejected and DB unchanged (rollback) |
| 4 | Move: explicit mapping for every old status in use (even equal names); reject cycles; reject destination without permission; descendants keep statuses; add-on data preserved | `domain/projects.moveProject`, `domain/workflow` | transaction validates mapping keys = distinct statuses of moved roots, destination role, `destination ∉ subtree`; only moved roots get new status; `addon_data` untouched | `tests/domain/move.test.ts`: missing mapping key rejected; same-name status still requires mapping; cycle rejected; destination forbidden rejected; add-on JSON unchanged after move |
| 5 | Workflow edits: removing/replacing in-use status requires explicit remapping; trashed children defer mapping to restore | `domain/workflow.replaceWorkflow`, `domain/trash.restoreAction` | transaction counts children in workflow by status; rejects with mapping requirement; restore accepts mapping for now-invalid statuses | `tests/domain/workflow.test.ts`: delete in-use status without mapping rejected; with mapping children updated; trashed child skipped; restore without mapping rejected, with mapping succeeds |
| 6 | Inbox: release clears flag, keeps status; any status change clears it; flag not status; add-on required gate before exit | `domain/inbox.releaseInboxProject`, `domain/projects.updateProject` (`statusChanged ? inbox=0`), `domain/projects.reorderProject`, `domain/addon-hooks.assertInboxExitAllowed` | release/status-change/reorder/move/bulk-move/workflow-remap call `assertInboxExitAllowed` before writing; it runs every registered add-on's `beforeLeaveInbox` then `validate` and throws `422 addon_validation`. Empty MVP registry → no-op; mode resolves to `'optional'` until registry→`addons` sync exists (AR-054) | `tests/domain/projects.test.ts` (inbox cases) + add-on tests: release keeps status, clears inbox; status change clears inbox; skip_inbox project has no Inbox; gate invocation order/issue aggregation; no partial write on gate rejection |
| 7 | Kanban: cross-column = status only; within-column rewrite sibling priority; priority shared across statuses | `domain/projects.reorderProject` / `updateProject` | reorder only touches `priority` of siblings; status update never touches priority | `tests/domain/priority.test.ts`: cross-column leaves priority vector unchanged; within-column creates contiguous order; all-status sibling order preserved |
| 8 | Archive: parent hides subtree; descendants' flags untouched; `show_archived` per user app-wide | `domain/projects.setArchived`, read queries | no subtree writes; visibility joins on `users.show_archived` and effective ancestor archive state | `tests/domain/archive.test.ts`: archive parent leaves child flag; hidden by default; child visible after unarchive according to own flag; toggle shows subtree |
| 9 | Trash: batch action id + own deadline; already-trashed keeps deadline; restore only same action; read-only; purge only scheduled | `domain/trash.*` | `trashProjects` one transaction sets `trash_action_id`/`purge_deadline` per row; `assertWritable` on every mutating domain function; only `purgeExpired` deletes | `tests/domain/trash.test.ts`: action id shared by newly trashed; existing trash keeps action and deadline; restore same-action only; trashed edit rejected; restore re-trasha gets new deadline |
| 10 | Audit: own field changes, creation, archive, trash; parent logs child create + child trash only; no purging event | `domain/audit.logEvent` called by each command | writes bundled in same transaction; no event for purge; append-only trigger/table policy | `tests/domain/audit.test.ts`: title change logs old+new in own log; create logs in own and parent log; child edit not in parent; child trash logged in parent; purge leaves no purge event |
| 11 | Search: FTS titles (+future add-on text), permission filtered, prefixes, archived per visibility, trash excluded | `domain/search.searchProjects`, `db/search.indexProject` | FTS5 query with quoted prefix tokens; results filtered through `AccessContext` (`isActiveProject`) in the domain; `body` is currently always empty (no add-ons); trash excluded, archived follows `show_archived` | `tests/unit/search-fts.test.ts` + future `tests/domain/search.test.ts`: prefix match; inaccessible title absent; trashed absent; archived only when toggled; reindex after title edit |
| 12 | Every read path permission filtered server-side; never leak titles or counts | `domain/permissions.loadAccessContext` + every read helper; route handlers return 404 for unreadable ids | the whole tree+grants are loaded once per request into `AccessContext`; helpers filter in the domain process (not SQL) before serialising; inaccessible single item → 404, never 403; `listActivity` relies on its caller to have checked access (review AR-029) | `tests/domain/permissions.test.ts` (privacy cases) + future `tests/domain/privacy.test.ts`: list/inbox/search/dashboard/activity never include inaccessible titles; 404 not 403; counts match visible set only |

Cross-cutting expectations that are not a single §6 rule but are release-blocking:

- The transaction is rolled back on any thrown `DomainError`; no partial audit/FTS/priority write.
- `GET` handlers never mutate. `ensureWorkflow` (the lazy To do/Done seed) is called only from
  mutating commands (`createProject`, `moveProject`/`moveProjects`); read paths use `listWorkflow`
  and are read-only (AR-032/AR-052 resolved).
- All mutations validate server-side even when the UI disables the control.

### 5.1 Why this shape

Rule enforcement is centralised rather than spread across handlers and components: one command =
one transaction = one place to audit, reindex, run add-on hooks and validate permissions. The
invariant tests target the domain commands, and the API integration tests only prove the handler
plugs the command in correctly.

## 6. Auth, session, CSRF, authorization

### 6.1 Passwords and sessions

Verified against `src/server/auth/*`:

- Hashing: `node:crypto` `scrypt`, per-password 16-byte salt, current parameters `N=16384, r=8,
  p=1`, 64-byte key, `timingSafeEqual` compare. Stored as
  `scrypt$N$r$p$<salt base64url>$<hash base64url>` so parameters can be raised later without a
  schema change; verification parses parameters from the stored value (bounded to sensible ranges).
- Session token: 32 random bytes (base64url), sent as `kapo_session`; only its SHA-256 hex digest is
  stored in `sessions.token_hash` (unique). Never log the token.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Expires` 30 days; `Secure` when
  `NODE_ENV=production` and the request is HTTPS (`X-Forwarded-Proto: https`, or
  `KAPO_FORCE_SECURE_COOKIES=1`). Appearance is mirrored in a separate non-`HttpOnly`
  `kapo_appearance` preference cookie for the pre-paint theme script (not a credential).
- Expiry: 30-day sliding. `resolveSession` deletes expired rows and, when the session is older than
  24 hours, slides `expires_at` to `now + 30d`. This writes on nearly every request after the first
  day (the condition compares `created_at`, not remaining lifetime) — correct sliding behaviour,
  avoidable write amplification, tracked in the review log.
- Logout deletes the row and clears the cookie. A self-service password change deletes the user's
  other sessions and keeps the current one; an Admin password reset deletes all of the target
  user's sessions. There is no account-disable/delete feature in the MVP, so no other session
  revocation path exists.
- `/setup` is enabled only while `users` is empty and creates the first admin and a session.
- Auth helpers (`src/server/auth/current-user.ts`): `getSessionUser(): Promise<AuthUser | null>`,
  `requireUser()` / `requireAdmin()` / `requireAppRole()` (redirect for server components), plus
  `isFirstRun()`. Route handlers use `getSessionUser` and return a JSON 401 explicitly; they must
  not call the redirecting helpers. There is no `React cache()` wrapper in the foundation yet — a
  server component that calls `getSessionUser` twice resolves the session twice (cookie + one DB
  read); acceptable at this scale, worth deduplicating per request if profiling shows it.
- Login throttling exists: `src/server/auth/rate-limit.ts`, in-memory, 10 failures / 15 minutes per
  `username|ip`, cleared on success. It is per process (fine for one container), resets on restart,
  and trusts `X-Forwarded-For` (only safe behind a proxy that overwrites the header).

### 6.2 Authorization algorithm (verified against `src/server/domain/permissions.ts`)

The engine loads the whole project tree plus the viewer's explicit grants once per request
(`loadAccessContext`) and walks Depth-first from each Root:

```
role(project) =
    explicit grant at project                       -> that role
  | parent != null and an ancestor has a grant      -> nearest ancestor grant (walk continues down)
  | project is Root                                 -> appRole == 'admin' ? 'admin' : null
  | otherwise                                       -> null
```

Consequences that the implementation and tests preserve (and that `tests/domain/permissions.test.ts`
asserts):

- App Admin is **not** a superuser. The Root fallback applies only to the Root project itself and is
  never passed down; a project with no grant stays private from an app Admin. The seed grants Root
  `project_roles` to non-admin accounts explicitly, and grants shared projects explicitly.
- App User and app Viewer have no implicit project access. The product sentence "all other accounts
  receive Root's User project role" is implemented as an **explicit Root grant synced on account
  creation/role change**: `users.createUser` and `users.updateUser` call `syncRootProjectRole`, which
  writes the Root `project_roles` row for an application User (`user`) or Viewer (`viewer`), and for
  an application Admin deletes any stale explicit Root row so the implicit Root Admin fallback
  applies. Account create/update is therefore the single owner of Root membership (AR-021 resolved).
  The setup path only creates the first admin, covered by the Root fallback.
- Creating a child requires edit capability (`user` or `admin`) on the parent. `createProject` copies
  the parent's explicit grants onto the new child and then upserts the creator as project Admin. That
  materialisation is what makes "increases never propagate" true for already-created children and
  makes the reduction cascade auditable.
- Application Viewers are read-only everywhere: the walk may find an explicit `admin` grant, but
  `canEditProject`/`canAdminProject` return false when `isReadOnlyViewer(user)`. `Viewer` is a
  capability clamp, not a role rewrite; the member list may still display the grant.
- "A project must retain one project Admin" and "Root must retain one application Admin" are checked
  by simulating the whole affected subtree (`planMemberUpdate` → `effectiveRolesByUser`) before the
  write; the rejection names the losing projects.
- Member reductions cascade over descendant explicit grants that are higher than the new effective
  role; lower descendant grants are left alone (no accidental increase). Increases only write the
  target project's row.
- Root's member list is explicit-grants-only (`listProjectMembers`); an app Admin's implicit Root
  admin is not a row, so the UI must treat it separately (review AR-031).

### 6.3 Query filtering (actual model)

The implementation filters **in the domain process**, not in SQL: `loadAccessContext` computes an
`AccessContext` with per-project effective roles and archive visibility; every read helper
(`isActiveProject`, `isTrashVisibleProject`, `readableChildIds`, `visibleProjectIds`, search, inbox,
trash, page data) consults it before serialising. Inaccessible single items return 404 (never 403).
This satisfies build-spec §6.12 (server-side, no title/count leak) with a simpler tree walk than a
recursive SQL CTE; the tradeoff is loading the full project table per authenticated request, which is
acceptable at household scale (≤ a few thousand projects) but is the first thing to move into SQL if
that assumption changes.

Rules that still hold:

- Trashed projects never appear in ordinary reads; `listTrash` is the only reader and still applies
  access + `show_archived`.
- Archived visibility is `users.show_archived`, applied to the whole visible set (parent archived
  hides its subtree).
- Read helpers that sit close to the data (`listActivity`) require the caller to have checked access;
  the API route and page do so, but the function itself is a misuse trap (review AR-029).
- Counts/limits are computed over the filtered set, not the raw table.

### 6.4 CSRF / same-origin (verified against `src/server/http.ts`)

`isSameOrigin(request)` is called by every mutating handler before touching the database:

1. If an `Origin` header is present, its host must equal the request `Host` (scheme is not compared;
   the deployment terminates TLS at the proxy, so scheme comparison would false-negative on
   `http://internal:3000`).
2. If there is no `Origin`, `Sec-Fetch-Site` must be `same-origin` or `none` when present.
3. If neither header is present, the request is allowed. That keeps CLI/server-to-server calls
   working and is defensible for non-browser clients, but it means the check is not a proof of
   browser origin: same-site cookie + `SameSite=Lax` are the compensating controls. This is recorded
   as a residual risk in the review log; do not weaken it further, and do not add CORS headers.
4. `rejectCrossOrigin` returns 403 `csrf_rejected`. `readJsonBody` enforces a JSON object body;
   content-type is not sniffed (the JSON parser fails on non-JSON anyway).

## 7. Route handlers and UI boundary

`src/app/api/**` implements build-spec §7 exactly. Handler shape:

```ts
// actual shape (src/app/api/projects/[id]/move/route.ts)
export async function POST(request: Request, context: RouteContext) {
  const guard = guardMutation(request);            // same-origin, mutations only
  if (guard) return guard;
  const auth = await requireApiUser();             // JSON 401, never a redirect
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const project = moveProject(getDb(), toAccessUser(auth.user), id, body.data);
    return jsonOk({ project });
  } catch (error) {
    return handleDomainError(error);
  }
}
```

No handler imports `fs`, `child_process`, or SQL directly; validation of field types is in the
domain/`src/lib/validation.ts` (there is no zod/schema dependency).

Server components read through domain functions; client components mutate by `fetch` and then
`router.refresh()` (or `revalidatePath` equivalent) so RSC data is re-rendered. The project page and
view components receive serialisable view models (`ProjectDetail`, `children`, `statuses`,
`permissions`, `activityPage`, `lastUsedView`) computed server-side.

The add-on UI surface is contract-only in MVP: `src/server/addons/` ships `types.ts`, `registry.ts`
and `index.ts` with an **empty registry**, no add-ons registered, no endpoints and no UI slot
renderers. The **Inbox-exit hook gate is wired** (`src/server/domain/addon-hooks.ts`) and is a no-op
while the registry is empty; modes default to `'optional'` until registry→`addons` sync exists
(§8.3, R20). Add-on rules in this document are therefore verified by construction and by registry /
contract tests, not by an end-to-end add-on flow. One forward contract worth stating here: the
`AddonWidgetContext` dashboard loader receives `{ viewerId, visibleProjectIds, query(sql, params) }`
and `query` must stay a **read-only** helper — no raw writable `Db`, no transaction object, no
permission helper, ever. `visibleProjectIds` is the core-computed permission result; loaders may
narrow it, never expand it. Future implementations must not weaken this invariant; it is recorded in
`architecture-review.md`.

## 8. Audit, purge, scheduler

### 8.1 Audit

- `logEvent(tx, {projectId, actorId, action, field?, oldValue?, newValue?, targetId?, detail?})` is
  called only inside the mutating transaction; an event never exists for a change that rolled back.
- Append-only is enforced in the schema as: (a) no exported update/delete function in the domain;
  (b) a `BEFORE UPDATE` trigger (`audit_events_append_only`) aborts every update; (c) the Activity UI
  has no edit controls. Deletes are possible only through the `audit_events.project_id ON DELETE
  CASCADE` when a project row is deleted by purge — no other code path may delete audit rows. If a
  purge is expected to delete a project's own history (product.md §4) that is exactly the cascade.
- Parent events for child create/trash store the child title in `detail` (JSON snapshot) because
  `target_id` may point at a project that is later purged; rendering never depends on a live join.
- `listActivity` is cursor-paginated newest-first but does **not** take a viewer: the route/page must
  check project access first (they do). It joins `target_id` to `projects` for the target title and
  falls back to the stored `new_value`; for a child event whose target is no longer readable (or is
  purged), the live join can expose the target's current title to a reader of the parent log — a
  privacy edge to fix by snapshotting/validating the target (review AR-029).
- **Status events store names and ids:** `old_value`/`new_value` keep the display names and `detail`
  JSON carries `{"fromId": <old status id>, "toId": <new status id>}` from every status-changing path
  (update, reorder, move, bulk move, workflow remap). That is what makes the deferred "Completed last
  week" widget countable without an event-schema change (AR-033 resolved; see `add-ons.md` §13).
- The audit vocabulary includes `project.inbox_released` and `workflow.updated`; unknown actions are
  no longer expected, though activity rendering should still degrade gracefully.

### 8.2 Purge

`src/server/domain/purge.ts#purgeExpired(now)` (the only purge implementation) runs in one
transaction: select projects with `trashed_at IS NOT NULL AND purge_deadline <= now` (never Root),
expand to the complete subtree (a descendant may have a later deadline than an expired ancestor and
must still go), sort leaf-first to respect `projects.status_id ON DELETE RESTRICT` against statuses
owned by parents, delete `project_search` rows for the whole set (no FK), then delete the project
rows. Foreign keys cascade the rest: `audit_events` (the project's own history),
`statuses` where the project owns a workflow, `project_roles`, `favorites`, `trash_actions`
references, and descendants through `projects.parent_id ON DELETE CASCADE`. Result counts are
returned for logging. A failure rolls the whole batch back and the next sweep retries. Nothing writes
an audit event for purge; parent-log events referencing the purged child survive. Add-on
`onProjectPurge` does not exist yet (FORWARD); add-on JSON is deleted with the project row and
add-on tables must declare `ON DELETE CASCADE`.

### 8.3 Scheduler (implemented)

- `src/instrumentation.ts` (`register()`) is the Next.js entry. It skips during
  `NEXT_PHASE === 'phase-production-build'`, when `KAPO_DISABLE_PURGE=1`, and on non-Node runtimes,
  then dynamically imports `src/instrumentation-node.ts` (keeps `better-sqlite3` out of the Edge
  trace).
- `startPurgeScheduler()` runs one sweep immediately, then sets a 6-hour `setInterval` (timer
  `unref`'d, re-entrancy-guarded by a module-level `started` flag). Errors are logged, never fatal;
  maintenance must not take the server down.
- `scripts/purge.ts` is a thin CLI wrapper around the same `purgeExpired()` for operators/cron
  (`npm run db:purge`) and closes the DB handle; the container does not need it.
- Migrations run on first database access (`openDatabase`), which the scheduler's first sweep
  triggers at boot in the container. Registry→`addons` table sync (FORWARD) will join this startup
  sequence when the first add-on ships.
- Idempotent by construction: a second sweep finds nothing; missed intervals are recovered by the
  next sweep because purge is deadline-based. AR-020 is resolved.

### 8.4 Backup scheduler (implemented, issue #13)

- `src/instrumentation.ts` also starts `src/server/backup/schedule.ts#startBackupScheduler()` through
  the same Node-only `startSchedulers()` entry. Purge and backups start independently: a failure or
  `KAPO_DISABLE_PURGE=1` never disables backups.
- The scheduler reads the Admin settings (enabled, local `HH:MM`, retention 1–30) and sets one
  `setTimeout` for the next run (timer unref'd). After every attempt it recomputes the next run from
  the current clock and settings; `PUT /api/settings` calls `rescheduleBackupScheduler()` so a
  changed time takes effect without a restart. It never starts a second copy while a run is in
  flight and no-ops during builds/tests.
- The configured time is server-local wall clock. The container documents `TZ` (Compose default
  `UTC`); `docker-compose.yaml` mounts `kapo-backup:/backup` and sets `KAPO_BACKUP_DIR=/backup`.
- Missed runs while the process was down are not replayed; the next run is the next scheduled local
  time. Failures are logged and do not take the server down.
- `src/server/backup/service.ts` captures the database with better-sqlite3's online backup API into a
  temporary folder, converts the snapshot to a single rollback-journal `kapo.db`, copies `uploads/`,
  then renames the folder to `kapo-YYYYMMDD-HHMMSS` and prunes older recognised folders to the
  retention count. Only names matching the backup scheme are deleted. See §9.2 for restore.

## 9. Deployment, volumes, backups, migrations, upgrades

### 9.1 Image and Compose

- Multi-stage Dockerfile: `builder` installs dev deps (needs `python3`/`make`/`g++` for
  better-sqlite3 if no prebuilt binary), runs `npm run build`; runtime stage copies the Next.js
  standalone output plus `node_modules` required for `better-sqlite3`, runs as non-root `node`.
- `docker-compose.yaml`: one service `kapo`, `build: .`,
  `${KAPO_BIND:-127.0.0.1}:${KAPO_PORT:-3000}:3000` (localhost-only by default for a host
  reverse proxy), `init: true`, `stop_grace_period: 30s`, rotated json-file logs, env
  `NODE_ENV=production`, `DATABASE_PATH=/app/data/kapo.db`, `UPLOAD_DIR=/app/data/uploads`,
  `KAPO_BACKUP_DIR=/backup`, `TZ=${TZ:-UTC}`, optional `SESSION_SECRET` (not required; tokens are
  random, the env is reserved for future signed artifacts), volumes `kapo-data:/app/data` and
  `kapo-backup:/backup`, `restart: unless-stopped`, healthcheck curling `/healthz`.
  `.dockerignore` excludes `data/`, `node_modules`, `.next`, tests, docs.
- No outbound network dependency at runtime; no external SaaS. PWA manifest and service worker are
  served from `public/`; installation is documented for iOS/Android in README, and the service
  worker must never cache API responses or authenticated HTML.

### 9.2 Data volume

| Path | Contents | Notes |
|---|---|---|
| `/app/data/kapo.db` | SQLite database | WAL mode produces `-wal`/`-shm` next to it |
| `/app/data/uploads/` | avatar files | random names, extension from verified magic bytes |
| `/backup/kapo-YYYYMMDD-HHMMSS/kapo.db` | consistent database snapshot | single rollback-journal file, created by the online backup API |
| `/backup/kapo-YYYYMMDD-HHMMSS/uploads/` | copied avatar files | omitted when `UPLOAD_DIR` does not exist |

Rolling backups are automatic (Admin settings: enabled, local `HH:MM`, retention 1–30, default
enabled/`02:00`/3). Each run writes a temporary folder, snapshots the DB with better-sqlite3's
backup API, copies uploads, renames to the timestamped folder, and then prunes the oldest recognised
folders. A hot copy of a WAL database without the backup API can miss committed pages; that is why
the implementation never copies the live file. Restore is manual and documented in the README:
stop the container, replace `/app/data/kapo.db` **and** `/app/data/uploads` from one backup folder,
fix ownership (1001:1001), start the container, then run `PRAGMA integrity_check` and verify a known
row. `/backup` is a separate named volume (`kapo-backup`), so it survives replacing `kapo-data`;
operators should still copy it off-host for disaster recovery.

### 9.3 Migrations

- `src/server/db/migrations/NNN_name.sql`, forward-only, applied in filename order, each file in its
  own transaction, recorded in `schema_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE,
  applied_at TEXT)` (`src/server/db/migrate.ts`). There is no `PRAGMA user_version` mirror; the table
  is the record.
- Migrations run when a connection is opened (`openDatabase` → `runMigrations`), before the
  connection is handed out; in a container that is process start. A failed migration throws, aborts
  startup, and the container restarts and retries; a failed migration must not partially commit.
- Migration directory resolution: `KAPO_MIGRATIONS_DIR`, then `./src/server/db/migrations`,
  then `./migrations` (`src/server/db/paths.ts`); the standalone image copies migrations and sets
  the env var.
- Rules: never drop/rename a column in place (create new, copy, keep old until a later version);
  never rewrite `addon_data` destructively; keep `001_init.sql` untouched after first release;
  additive changes only for patch releases. Note `001_init.sql` has not been released yet, so it may
  still change during the build — after the first shipped version it is frozen.
- Add-on migrations (when add-ons ship) register namespaced versions and run after core migrations;
  an add-on migration failure disables that add-on, not the application.

### 9.4 Upgrades and rollback

Upgrade = pull new image, `docker compose up -d`; startup migrates. Take a volume snapshot before
upgrading. Rollback = redeploy previous image **only if the schema change was backward-compatible**;
otherwise restore the pre-upgrade volume backup. The README states this plainly. Application
downgrade with a newer schema is unsupported.

### 9.5 Environment

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_PATH` | `./data/kapo.db` | SQLite file (`src/server/db/paths.ts`) |
| `UPLOAD_DIR` | `./data/uploads` | avatar storage |
| `KAPO_MIGRATIONS_DIR` | resolved from candidates | migration directory in the standalone image |
| `KAPO_FORCE_SECURE_COOKIES` | unset | force `Secure` cookies when TLS termination is not visible as `X-Forwarded-Proto: https` |
| `SESSION_SECRET` | unset | reserved; sessions are DB-backed random tokens and need no signing key |
| `KAPO_PUBLIC_URL` | `http://localhost:3000` | metadata base URL / deployment guidance |
| `KAPO_DISABLE_PURGE` | unset | `1` disables the in-process 6-hourly purge scheduler (external cron then owns purge); does not affect backups |
| `KAPO_BACKUP_DIR` | `/backup` (Docker), `./data/backups` (dev fallback) | rolling backup destination; Compose mounts `kapo-backup` there |
| `TZ` | `UTC` (Compose) | IANA timezone for the local backup schedule and backup folder names |
| `KAPO_BIND` | `127.0.0.1` (Compose) | host interface that publishes the app port; `0.0.0.0` only for direct LAN access without a proxy |
| `KAPO_PORT` | `3000` | host port published by Compose (container port stays 3000) |
| `PORT` | `3000` | Next.js port |

HTTPS is terminated by the operator's reverse proxy (Caddy/nginx/Traefik). The app sets `Secure`
cookies only when `NODE_ENV=production` and it sees an HTTPS signal, so plain-HTTP localhost
development still works. The purge scheduler runs at boot and every 6 hours (code constant); set
`KAPO_DISABLE_PURGE=1` to disable it in environments that run `npm run db:purge` externally. The
backup scheduler runs independently at the configured local time; `KAPO_BACKUP_DIR` and `TZ` are
the only backup-related deployment variables.

## 10. Testing strategy

| Level | Tool / location | What it proves | What it must not do |
|---|---|---|---|
| Unit | `tests/unit/*.test.ts` (vitest): schema/constraints, FTS, password/session/rate-limit/HTTP helpers, add-on registry, first-run | foundation + contract invariants that do not need the full domain | mock `better-sqlite3`; touch the dev DB |
| Domain integration | `tests/domain/*.test.ts` with a temp SQLite file per suite (`tests/helpers/db.ts`): permissions/cascade/last-admin, project create/move/reorder/inbox/audit/search/trash as they land | every §6 rule, transactions/rollback, audit + FTS + trash semantics | depend on the seeded `data/kapo.db` |
| API integration | `tests/integration/*.test.ts`: call route handlers with a `Request` + session context helper | auth/CSRF, error envelope, status codes, permission filtering at the boundary | start a real server for every test |
| E2E | `tests/e2e/*.spec.ts` + `start-server.mjs`, Playwright chromium if installable | first install, login, capture → Inbox → release, Kanban status vs priority, viewer read-only, dashboard persistence, trash/restore | require network assets or a seeded dev DB checked into git |
| Static | `npm run typecheck` | strict TS (`noUncheckedIndexedAccess`), no `any` leaks; domain must not import React/Next (review + import inspection; no ESLint script exists) | — |

Snapshot at review round R4: `npm test` is green (`19 files / 245 passing / 1 expected-fail`) and
`npm run typecheck` is clean. The suite is not "done" until:
every §5 row has a failing-on-regression test, `npm test` is green from a clean checkout, typecheck
is clean, and at least one deliberate-regression check has been demonstrated. Test evidence at R3
covered schema, FTS, auth, HTTP, registry, rate limit, setup/login, permissions/cascade, and project
ABI/API integration; audit/trash/search/inbox/workflow domain tests were still pending.

Each rule in §5 maps to at least one named test expectation. A test suite is "done" for a rule only
when it fails on a deliberate regression (e.g. removing the permission join) — the tester verifies
at least one such mutation manually.

**Intentionally not tested / not covered by automation:**

- Visual fidelity against Penpot (designer review, sampled).
- Screen-reader and full keyboard traversal; only the documented a11y checklist is verified.
- Load, throughput, and multi-process concurrency (unsupported architecture).
- HTTPS termination, proxy configuration, container orchestration beyond a single Compose service.
- Restore automation/UI: restores are manual and documented; backup creation, retention, settings
  permissions and opening a backup for a known row are covered by unit/integration tests.
- Email, password recovery delivery (not a feature), OAuth/SSO (not a feature).
- Browser matrix beyond Chromium; Safari/iOS PWA install is manual.
- End-to-end add-on behaviour: no add-on ships. The registry contract and the Inbox-exit hook gate
  are covered by unit/contract tests (registration validation, hook order, issue aggregation), but
  there is no real add-on flow, settings surface, renderer or widget consumer to exercise; that
  coverage arrives with the first add-on (AR-054/055/056).

## 11. Risks, open questions, deferred work

Severity = impact if it goes wrong in the MVP. Code-level findings are tracked in
[architecture-review.md](architecture-review.md); this section is design-level.

| # | Risk / question | Severity | Position / mitigation |
|---|---|---|---|
| R1 | Add-on registry is contract-only and the generic plumbing (settings tab, field slots, add-on value endpoint, search indexing, widget bridge, registry→`addons` sync) does not exist; only the Inbox-exit hook gate is wired | Major for the add-on story, not for MVP flows | Contracts are in `add-ons.md`; the registry is empty; core preserves `addon_data`/`settings.addons` JSON. The first add-on delivers the generic plumbing once (AR-054/055/056). |
| R2 | Single SQLite writer + in-process scheduler: no horizontal scaling, long transactions block the event loop | Major (accepted MVP constraint) | Keep transactions short; no network I/O inside a transaction; document unsupported multi-replica deployment. |
| R3 | CSRF relies on Origin/Host match plus SameSite, not a per-form token; a request with neither `Origin` nor `Sec-Fetch-Site` passes | Major residual | §6.4 is the implemented rule; no CORS headers; never weaken the header check. |
| R4 | Login brute force is throttled in memory only (10 failures / 15 min per username+IP), resets on restart, and trusts `X-Forwarded-For` | Minor (mitigated) | Fine for one household/one process; deploy behind a proxy that overwrites `X-Forwarded-For`; documented as defence-in-depth, not a guarantee. |
| R5 | Priority/status writes under concurrent tabs: last write wins, no optimistic version check | Major (data correctness) | All writes `BEGIN IMMEDIATE` and recompute from current state; reorder is idempotent by target position. No `updated_at` precondition in MVP; accepted risk. |
| R6 | Purge orphan cleanup | Major → **largely resolved** | `domain/purge.ts#purgeExpired` deletes FTS rows for the whole subtree, expands descendant subtrees, deletes leaf-first, and relies on FKs for audit/roles/favorites/statuses; tested by the purge suite. Remaining: add-on tables must declare `ON DELETE CASCADE` (no add-on ships), and avatar files of deleted users still need a cleanup decision. |
| R7 | Audit append-only is enforced by an UPDATE trigger only; DELETE is possible through the project cascade (intended for purge) and must not be reachable elsewhere | Major | No domain delete API; review every raw `DELETE FROM audit_events`; purge relies on cascade, not on manual audit deletes. |
| R8 | Avatar upload: content-type spoofing, path traversal, SVG/HTML XSS via served files | Major | Accept png/jpeg/webp magic bytes only, ≤2 MB, random filename, serve with `Content-Disposition`/`nosniff`, never as `text/html`. |
| R9 | App Admin/Viewer semantics (Root-only implicit admin, explicit Root role rows for non-admins) are inferred from the spec; ambiguity could cause privacy bugs | Major | Algorithm in §6.2 is normative; tests must cover "private from app admin" and "viewer gets no write" explicitly. Product owner should confirm. |
| R10 | Move can strand a project without an effective Admin (its Admin access may have come from the old parent) | Major open question | Recommended: validate effective admin after simulated move and reject with `LAST_ADMIN_REQUIRED`, naming projects. Confirm with product owner; tests encode whichever wins. |
| R11 | Audit coverage beyond "create, field change, archive, trash": move, restore, unarchive, membership change, workflow change | Minor open question | Default: log them in the affected project's log (and old/new parent for move) as field events; no parent duplication except child create/trash. |
| R12 | Search snippets for future add-on text fields and visibility of disabled add-on values | Minor (no add-ons ship) | Add-on values are indexed only while effectively available; availability change triggers reindex; disabled values are never searchable. Contract in `add-ons.md`. |
| R13 | Trashed project restore requires explicit mapping when its status left the parent workflow; UI must surface it | Minor (edge case) | `restoreAction` accepts mapping and raises `STATUS_MAPPING_REQUIRED`; test covers it. |
| R14 | No manual purge UI; purge depends on the in-process scheduler firing | Minor | Startup sweep plus 6-hourly interval recover automatically (runs at boot); `npm run db:purge` is the operator fallback when `KAPO_DISABLE_PURGE=1`. |
| R15 | `show_archived` is stored per user and applies app-wide; toggling from a project menu affects dashboard/search/views | Minor UX | Single user preference read in every visibility query; toggle writes `users.show_archived`, no per-view override. |
| R16 | Dashboard preference forward compatibility — **resolved:** `parseDashboard` preserves unknown ids/order, the write path keeps them and appends missing known widgets as hidden, and the editor keeps unknown entries in their slots (only Restore defaults drops them) | Formerly major, now closed | Rendering/editor still filter to known ids; when the widget bridge lands, add the "unavailable widget" editor row. No schema change. |
| R17 | Session sliding renewal compares `created_at` and writes on most requests after day one | Minor (write amplification) | Change the condition to remaining lifetime (e.g. renew when < 1 day remains) or accept; correctness is fine. |
| R18 | `MAX(seq)+1` display-id allocation reuses ids after purging the newest project | Minor (audit references) | Prefer a persistent counter allocated in the same transaction; otherwise document and test monotonicity expectations. |
| R19 | Priority uniqueness includes trashed siblings; a reorder that ignores trashed rows can collide | Major (data correctness) | Reorder must account for trashed siblings or the unique constraint must become partial; test trash + reorder. Tracked in the review log. |
| R20 | Add-on gate is **wired** (`domain/addon-hooks.assertInboxExitAllowed` on release/status-change/reorder/move/bulk-move/workflow-remap; both hooks run) but **inert**: registry empty, no registry→`addons` sync (mode defaults to `'optional'`), no project enablement, no value write endpoint / settings surface / renderer or widget consumer | Major for the add-on story (accepted MVP scope) | Fine while the registry is empty; the first add-on needs the generic sync/enablement/value-endpoint/settings/renderer/bridge work once, not per add-on. `add-ons.md` §3–§9 and `architecture-review.md` AR-054/055/056 record the gaps. |
| R21 | Audit status transitions — **resolved:** status events carry `detail {fromId,toId}` in addition to names, and `project.inbox_released` / `workflow.updated` are in the vocabulary, so the deferred Completed-last-week widget can count finish-status transitions | Formerly major, now closed | Keep the ids authoritative (names may be edited); add the renamed-status counting test when the widget returns. |
| R22 | GET reads mutating — **resolved:** `ensureWorkflow` (the lazy To do/Done seed) is now called only from mutating commands (`createProject`, `moveProject`/`moveProjects`); page/workflow/move-info reads use `listWorkflow` and are read-only | Formerly major, now closed | Keep new read paths on `listWorkflow`; the only lazy write left is the first `ensureWorkflow` during create/move, inside their transaction. |
| R23 | New-account Root access — **resolved:** `users.createUser`/`updateUser` call `syncRootProjectRole`, which writes the explicit Root `project_roles` row for app Users (`user`) and Viewers (`viewer`) and removes any stale explicit row on promotion to app Admin (implicit Root Admin fallback); last-app-Admin demotion is still guarded | Formerly major, now closed | Keep account create/update as the single owner of Root membership; test that promotion removes the stale row and demotion is rejected when it is the last Admin. |

Deferred (explicitly out of scope, do not build): Assignee and its dashboard widget, descriptions,
tags/custom fields, additional collection views (Portfolio), a restore UI/automated restore, freeform
dashboard layout / query builder / shared dashboards / engagement metrics, native apps, kiosk mode,
offline operation, and the built-in **Completed last week** widget (removed from this iteration;
reintroduction without schema change is documented in `add-ons.md` §13). Scope creep in any of
these must be rejected at review.
