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
Next.js 16 process ─┬─ React 19 server components  (reads)
                    ├─ /api/* route handlers        (all mutations + client reads)
                    ├─ instrumentation startup      (migrate, sync add-ons, purge sweep, interval)
                    └─ better-sqlite3 (WAL) ── ./data/kapo.db
                                                 ./data/uploads/*
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

One helper owns the common prologue (`src/app/api/_lib/route.ts`): auth, same-origin, content-type,
JSON body parse, `DomainError` → HTTP error body, unexpected error → 500 with a logged stack and a
generic message. Handlers stay thin; no handler contains rule logic.

### 2.2 Errors

`src/server/domain/errors.ts`:

```ts
export type ErrorCode =
  | 'TITLE_REQUIRED' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT' | 'CONFLICT'
  | 'CYCLE_REJECTED' | 'STATUS_MAPPING_REQUIRED' | 'LAST_ADMIN_REQUIRED'
  | 'WORKFLOW_IN_USE' | 'ADDON_VALIDATION_FAILED' | 'READ_ONLY_TRASHED' | 'UNKNOWN';

export class DomainError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number,
              message: string, readonly fields?: Record<string, string>) { … }
}
```

API error contract (build-spec §7): `{ "error": { "code", "message", "fields?" } }`. Validation
failures use 422; missing/invalid auth 401; authorization 403 for known projects and **404 for
projects the caller may not read** (never confirm existence). Domain mutations never return
`null` on failure, they throw `DomainError`; route handlers map it.

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

`src/server/domain/` is the only place business rules live. Signatures below are the contract the
builders implement; parameter names are stable enough for tests and add-on hooks to depend on.

```ts
// projects.ts
createProject(db, { actorId, parentId, title, reporterId? }): Project;
getProject(db, viewerId, projectId): ProjectDetail | throws DomainError('NOT_FOUND');
listChildren(db, viewerId, parentId, opts: { includeArchived: boolean }): ProjectSummary[];
updateProject(db, actorId, projectId, patch: { title?, statusId?, archived?, favorite? }): Project;
moveProject(db, actorId, projectId, destinationId, mapping: Record<StatusId, StatusId>): void;
reorderProject(db, actorId, projectId, targetStatusId, beforeId: ProjectId | null): void;
listAncestors(db, projectId): ProjectBreadcrumb[];
```

```ts
// permissions.ts
getEffectiveRole(db, userId, projectId): ProjectRole | null;       // admin | user | viewer
requireRole(db, userId, projectId, min: ProjectRole): ProjectRole;  // throws FORBIDDEN/NOT_FOUND
listMembers(db, actorId, projectId): MemberView[];
setMemberRole(db, actorId, projectId, userId, role: ProjectRole | null): void;
validateSubtreeAdmins(db, projectId, change): { ok: true } | { ok: false; projects: ProjectRef[] };
// every read helper uses accessibleProjectIds(db, viewerId) (recursive CTE), never JS filtering
accessibleProjectIds(db, viewerId): Set<ProjectId> | SQL view/CTE;
```

```ts
// workflow.ts
getWorkflow(db, parentId): Status[];                               // ordered by position
replaceWorkflow(db, actorId, parentId, next: WorkflowInput): void; // validates in-use remapping
validateWorkflow(next: WorkflowInput): WorkflowIssue[];
assertStatusBelongsToWorkflow(db, projectId, statusId): void;
```

```ts
// trash.ts
trashProjects(db, actorId, projectIds: ProjectId[]): { actionId: TrashActionId; affected: ProjectId[] };
restoreAction(db, actorId, projectId, mapping?: Record<StatusId, StatusId>): { restored: ProjectId[] };
purgeExpired(db, now = new Date()): { purged: ProjectId[] };        // scheduler entry point
listTrash(db, viewerId, opts): TrashPage;                            // action-grouped
assertWritable(db, projectId): void;                                 // READ_ONLY_TRASHED
```

```ts
// audit.ts
logEvent(tx: Db, e: AuditInput): void;   // called inside the mutating transaction only
listActivity(db, viewerId, projectId, cursor?): { events: AuditEvent[]; nextCursor: string | null };
```

```ts
// search.ts
search(db, viewerId, query: string, opts: { includeArchived: boolean }): SearchHit[];
reindexProject(tx: Db, projectId: ProjectId): void;
rebuildSearchIndex(db): void;            // scripts/repair.ts and tests
```

```ts
// inbox.ts
listInbox(db, viewerId): InboxItem[];
releaseFromInbox(db, actorId, projectId): Project;   // clears flag, keeps status, runs add-on gate
```

```ts
// users.ts / settings.ts / dashboard.ts
createUser(db, actorId, input): User;      updateUser(db, actorId, userId, patch): User;
getAppSettings(db): AppSettings;           updateAppSettings(db, actorId, patch): AppSettings;
getDashboard(db, viewerId): DashboardPayload;   // built-ins only; permission filtered
```

All mutating functions own their transaction boundary. The foundation's
`src/server/db/connection.ts` does not export a transaction helper yet; the domain layer must own a
single `withTransaction(db, fn)` (wrapping better-sqlite3's `db.transaction(...)` in `BEGIN
IMMEDIATE` semantics, or an explicit `db.exec('BEGIN IMMEDIATE')`/commit/rollback) and use it
everywhere. Nested calls reuse the transaction via a tx-scoped `Db` argument; nothing reads
settings, permissions or the clock outside the transaction it mutates with.

## 5. Domain rules and where they are enforced (build-spec §6)

Every row is a rule, the module that owns it, and the test that must fail if it regresses. Test
files are owned by the tester per build-spec §11; names are the required minimum.

| # | Rule | Module / function | Enforced in | Required test expectation |
|---|---|---|---|---|
| 1 | Create: title required; id/status/priority/server fields derived; parent start status; appended last sibling; Inbox unless parent `skip_inbox`; reporter defaults to creator | `domain/projects.createProject`, `domain/permissions` | single `BEGIN IMMEDIATE` transaction; `TITLE_REQUIRED` before insert; priority computed inside lock | `tests/domain/capture.test.ts`: title → project with parent start status, last priority, `inbox=1`; skip_inbox parent → `inbox=0`; reporter defaults to actor; empty title 422 |
| 2 | Effective role walking up; app admin→admin on Root only; app user no implicit project access; app Viewer read-only; child creation needs `user` on parent; project must retain one Admin; Root retains one app Admin | `domain/permissions.getEffectiveRole` / `requireRole` / `assertLastAdmin` | every read path in SQL/CTE or `requireRole`; member changes validate whole subtree before write; user-role change validates Root admin count | `tests/domain/permissions.test.ts`: nearest grant wins; grant on descendant without ancestor access; app viewer cannot write anywhere; last project admin removal rejected naming project; last app admin demotion rejected |
| 3 | Reduction/removal cascades to descendants overriding existing grants; increases never propagate; validate whole subtree and reject naming losers | `domain/permissions.setMemberRole`, `validateSubtreeAdmins` | transaction: compute subtree, simulate, reject with `LAST_ADMIN_REQUIRED` + `fields.projects`; then rewrite grants | `tests/domain/cascade.test.ts`: parent user→viewer rewrites descendant admin row; increasing parent leaves descendant row; losing last admin rejected and DB unchanged (rollback) |
| 4 | Move: explicit mapping for every old status in use (even equal names); reject cycles; reject destination without permission; descendants keep statuses; add-on data preserved | `domain/projects.moveProject`, `domain/workflow` | transaction validates mapping keys = distinct statuses of moved roots, destination role, `destination ∉ subtree`; only moved roots get new status; `addon_data` untouched | `tests/domain/move.test.ts`: missing mapping key rejected; same-name status still requires mapping; cycle rejected; destination forbidden rejected; add-on JSON unchanged after move |
| 5 | Workflow edits: removing/replacing in-use status requires explicit remapping; trashed children defer mapping to restore | `domain/workflow.replaceWorkflow`, `domain/trash.restoreAction` | transaction counts children in workflow by status; rejects with mapping requirement; restore accepts mapping for now-invalid statuses | `tests/domain/workflow.test.ts`: delete in-use status without mapping rejected; with mapping children updated; trashed child skipped; restore without mapping rejected, with mapping succeeds |
| 6 | Inbox: release clears flag, keeps status; any status change clears it; flag not status; add-on required gate before exit | `domain/inbox.releaseFromInbox`, `domain/projects.updateProject` | both commands share one helper `exitInbox(tx, project, nextStatus?)`; add-on validation runs inside the transaction before commit | `tests/domain/inbox.test.ts`: release keeps status, clears inbox; status change clears inbox; gate blocks release with `ADDON_VALIDATION_FAILED`; skip_inbox project unaffected by Required add-on |
| 7 | Kanban: cross-column = status only; within-column rewrite sibling priority; priority shared across statuses | `domain/projects.reorderProject` / `updateProject` | reorder only touches `priority` of siblings; status update never touches priority | `tests/domain/priority.test.ts`: cross-column leaves priority vector unchanged; within-column creates contiguous order; all-status sibling order preserved |
| 8 | Archive: parent hides subtree; descendants' flags untouched; `show_archived` per user app-wide | `domain/projects.setArchived`, read queries | no subtree writes; visibility joins on `users.show_archived` and effective ancestor archive state | `tests/domain/archive.test.ts`: archive parent leaves child flag; hidden by default; child visible after unarchive according to own flag; toggle shows subtree |
| 9 | Trash: batch action id + own deadline; already-trashed keeps deadline; restore only same action; read-only; purge only scheduled | `domain/trash.*` | `trashProjects` one transaction sets `trash_action_id`/`purge_deadline` per row; `assertWritable` on every mutating domain function; only `purgeExpired` deletes | `tests/domain/trash.test.ts`: action id shared by newly trashed; existing trash keeps action and deadline; restore same-action only; trashed edit rejected; restore re-trasha gets new deadline |
| 10 | Audit: own field changes, creation, archive, trash; parent logs child create + child trash only; no purging event | `domain/audit.logEvent` called by each command | writes bundled in same transaction; no event for purge; append-only trigger/table policy | `tests/domain/audit.test.ts`: title change logs old+new in own log; create logs in own and parent log; child edit not in parent; child trash logged in parent; purge leaves no purge event |
| 11 | Search: FTS titles (+future add-on text), permission filtered, prefixes, archived per visibility, trash excluded | `domain/search.search`, `reindexProject` | FTS query joined to `projects` + access CTE; `title:*` prefix tokens; `trashed_at IS NULL`; archived filter | `tests/domain/search.test.ts`: prefix match; inaccessible title absent; trashed absent; archived only when toggled; reindex after title edit |
| 12 | Every read path permission filtered server-side; never leak titles or counts | all read helpers in `domain/*`, `domain/permissions.accessibleProjectIds` | each list/count query joins the access CTE; inaccessible single item returns 404 | `tests/domain/privacy.test.ts`: list/inbox/search/dashboard/activity never include inaccessible titles; 404 not 403; counts match visible set only |

Cross-cutting expectations that are not a single §6 rule but are release-blocking:

- The transaction is rolled back on any thrown `DomainError`; no partial audit/FTS/priority write.
- `GET` handlers never mutate.
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
- Logout deletes the row and clears the cookie. Password change deletes all sessions for that user;
  user role/disable changes are expected to delete sessions (owners: settings domain).
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

### 6.2 Authorization algorithm

```
effectiveRole(user, project):
  if app_role == 'viewer':                       # read-only everywhere, never elevated
      role = explicitWalk(user, project)         # nearest explicit grant up the tree
      return role ? 'viewer' : role              # clamp any grant down to viewer
  role = explicitWalk(user, project)
  if role: return role
  if project == ROOT and app_role == 'admin': return 'admin'   # Root only, never inherited
  return null

explicitWalk(user, project):
  p = project
  while p is not null:
      if row exists project_roles(p, user): return row.role
      p = parent(p)
  return null
```

Consequences that the implementation and tests must preserve:

- App Admin is **not** a superuser. With no grant, the app-role fallback applies only when the
  queried project *is* Root; it does not walk down to Root's descendants. A private project
  therefore stays private from an app Admin.
- App User has no implicit project access. The product sentence "all other accounts receive Root's
  User project role" is implemented by writing an explicit Root `project_roles` row when an account
  is created or its application role changes (admin accounts rely on the implicit Root mapping;
  user/viewer accounts get Root `user`/`viewer`). Root's member list is therefore a normal member
  list for non-admins.
- Creating a child requires effective role ≥ `user` on the parent; the creator is additionally
  written as project Admin of the new child (explicit row) so "at least one project Admin" holds at
  creation.
- "A project must retain one project Admin" is checked against **effective** roles (inherited grants
  count), simulating the proposed change over the affected subtree before writing anything.
- Viewer writes: every mutating domain command starts with `requireRole(..., 'user')`, and app Viewer
  is clamped to `viewer`, so Viewers can only change their own profile/password/appearance/dashboard
  (those commands check `actorId === userId`, not project roles).

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

### 6.3 Query filtering (no leak by construction)

No read helper fetches rows and filters in TypeScript. Access is a SQL fragment that is joined into
every list/count:

```sql
WITH RECURSIVE access(project_id) AS (
  SELECT id FROM projects WHERE id = :rootId
  UNION
  SELECT p.id FROM projects p JOIN access a ON p.parent_id = a.project_id
)
-- actual predicate: project is readable when it is in the subtree of any project where
-- effective_role(viewer, project) resolves to a role, or has its own explicit grant.
```

In practice `accessibleProjectIds(db, viewerId)` is materialised as a temporary view/CTE used by
`listChildren`, `listInbox`, `search`, `listActivity`, `dashboard` and trash. Trashed projects are
excluded from ordinary reads and only listed through `listTrash` (which still applies the access
CTE). Archived visibility is `users.show_archived` applied to the whole visible set.

Counting rules: a widget or collection's total is computed from the same filtered query as its rows
(`SELECT COUNT(*)` over the filtered set), never from `projects` and then filtered in JS.

## 7. Route handlers and UI boundary

`src/app/api/**` implements build-spec §7 exactly. Handler shape:

```ts
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async ({ db, user }) => {
    const body = await parseJson<CreateProjectBody>(req, createProjectSchema);
    const project = createProject(db, { actorId: user.id, ...body });
    return json({ project });
  });
}
```

`handle` = same-origin check for non-GET → auth → parse → run → map errors. No handler imports
`fs`, `child_process`, or SQL directly.

Server components read through domain functions; client components mutate by `fetch` and then
`router.refresh()` (or `revalidatePath` equivalent) so RSC data is re-rendered. The project page and
view components receive serialisable view models (`ProjectDetail`, `children`, `statuses`,
`permissions`, `activityPage`, `lastUsedView`) computed server-side.

The add-on UI surface is contract-only in MVP: `src/server/addons/` ships `types.ts`, `registry.ts`
and `index.ts` with an **empty registry**, no add-ons registered, no endpoints and no UI slot
renderers. Add-on rules in this document are therefore verified by construction and by registry /
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
- `listActivity` is permission-filtered and cursor-paginated newest-first. Purged projects have no
  log; events in a surviving parent log that reference the purged child remain and render from the
  snapshot.

### 8.2 Purge

`purgeExpired(db, now)` selects projects with `trashed_at IS NOT NULL AND purge_deadline <= now`,
then for each subtree root: delete its `project_search` rows (no FK), run registered add-on
`onProjectPurge` hooks for namespaced tables, then delete the `projects` row. Foreign keys do the
rest, in one transaction: `audit_events` (own history), `statuses` where the project owns a workflow,
`project_roles`, `favorites`, `trash_actions` references, and descendants through
`projects.parent_id ON DELETE CASCADE`. A child whose deadline has not passed is purged anyway when
its ancestor is purged: otherwise it is orphaned/unreachable. Each purge runs in its own
transaction; a failure leaves the batch retryable on the next sweep. Nothing writes an audit event
for purge, and the parent's own audit events referencing the purged child survive (they belong to the
parent log).

### 8.3 Scheduler

- `instrumentation.ts` (`register()`) runs once per process start, in order: run migrations → sync
  add-on registry rows → purge sweep → set an interval (default hourly, env override for tests) →
  start serving. It must not run during `next build`.
- `scripts/purge.ts` exposes the same `purgeExpired` for operators/cron; it opens the DB, runs one
  sweep, prints counts, exits. `npm run` alias documented in README.
- The scheduler is a plain `setInterval` guarded by a re-entrancy flag. It is intentionally not a
  job queue; one instance, one process, lost intervals are recovered by the next sweep because
  purge is idempotent and deadline-based.
- Startup also runs `PRAGMA integrity_check`? No — too slow for boot; a separate `npm run db:check`
  is deferred.

## 9. Deployment, volumes, backups, migrations, upgrades

### 9.1 Image and Compose

- Multi-stage Dockerfile: `builder` installs dev deps (needs `python3`/`make`/`g++` for
  better-sqlite3 if no prebuilt binary), runs `npm run build`; runtime stage copies the Next.js
  standalone output plus `node_modules` required for `better-sqlite3`, runs as non-root `node`.
- `docker-compose.yml`: one service `kapo`, `build: .`, `ports: "3000:3000"`, env
  `NODE_ENV=production`, `DATABASE_PATH=/app/data/kapo.db`, `UPLOAD_DIR=/app/data/uploads`,
  optional `SESSION_SECRET` (not required; tokens are random, the env is reserved for future
  signed artifacts), volume `kapo-data:/app/data`, `restart: unless-stopped`, healthcheck curling
  `/healthz`. `.dockerignore` excludes `data/`, `node_modules`, `.next`, tests, docs.
- No outbound network dependency at runtime; no external SaaS. PWA manifest and service worker are
  served from `public/`; installation is documented for iOS/Android in README, and the service
  worker must never cache API responses or authenticated HTML.

### 9.2 Data volume

| Path | Contents | Notes |
|---|---|---|
| `/app/data/kapo.db` | SQLite database | WAL mode produces `-wal`/`-shm` next to it |
| `/app/data/uploads/` | avatar files | random names, extension from verified magic bytes |
| `/app/data/backups/` (after backup feature) | SQLite backups | planned, see 9.3 |

Backup procedure for MVP (manual, documented in README): stop the container (or run
`sqlite3 kapo.db ".backup /backup/kapo-YYYYMMDD.db"`), copy the volume, restart. A hot copy of a WAL
database without `.backup` can miss committed pages. Rolling backup management is deferred
(product.md §11); the architecture keeps it possible by keeping all state in the data volume.

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
| `PORT` | `3000` | Next.js port |

HTTPS is terminated by the operator's reverse proxy (Caddy/nginx/Traefik). The app sets `Secure`
cookies only when `NODE_ENV=production` and it sees an HTTPS signal, so plain-HTTP localhost
development still works. The scheduler interval is a code constant/env added by the maintenance
owner; it does not exist yet.

## 10. Testing strategy

| Level | Tool / location | What it proves | What it must not do |
|---|---|---|---|
| Domain unit/integration | `tests/domain/*.test.ts`, vitest node env, temp SQLite file per suite (`tests/helpers/db.ts`) | every §6 rule, transactions/rollback, audit + FTS + trash semantics | touch the dev database; mock `better-sqlite3` |
| API integration | `tests/api/*.test.ts`, call the exported route handlers with a `Request` and a session cookie | auth/CSRF, error shape, status codes, permission filtering at the boundary | start a real server for every test |
| E2E | `tests/e2e/*.spec.ts`, Playwright chromium if installable | first install, login, capture → Inbox → release, Kanban status vs priority, viewer read-only, dashboard edit persistence, trash/restore | depend on network assets or a pre-seeded dev DB |
| Static | `npm run typecheck` | TypeScript strict (`noUncheckedIndexedAccess`), no `any` leaks, domain layer has no React/Next imports; enforced by review + import graph inspection (there is no ESLint script in `package.json`) | — |

Each rule in §5 maps to at least one named test expectation. A test suite is "done" for a rule only
when it fails on a deliberate regression (e.g. removing the permission join) — the tester verifies
at least one such mutation manually.

**Intentionally not tested / not covered by automation:**

- Visual fidelity against Penpot (designer review, sampled).
- Screen-reader and full keyboard traversal; only the documented a11y checklist is verified.
- Load, throughput, and multi-process concurrency (unsupported architecture).
- HTTPS termination, proxy configuration, container orchestration beyond a single Compose service.
- Backup/restore automation (deferred feature).
- Email, password recovery delivery (not a feature), OAuth/SSO (not a feature).
- Browser matrix beyond Chromium; Safari/iOS PWA install is manual.
- Add-on behaviours: no add-on ships, so only the contract compiles; `tests/addons/contract.test.ts`
  (deferred until an add-on exists) covers hooks/isolation.

## 11. Risks, open questions, deferred work

Severity = impact if it goes wrong in the MVP. Code-level findings are tracked in
[architecture-review.md](architecture-review.md); this section is design-level.

| # | Risk / question | Severity | Position / mitigation |
|---|---|---|---|
| R1 | Add-on registry is contract-only; the generic plumbing (settings tab, field slots, add-on write endpoint, addon-data validation on transitions) must exist for "ship without touching core" to be true | Blocker for the add-on story, not for MVP flows | Contracts are in `add-ons.md`; the registry exists and is empty; core must preserve `addon_data`/`settings.addons` JSON and build the Inbox-exit hook point (`hooks.beforeLeaveInbox`). |
| R2 | Single SQLite writer + in-process scheduler: no horizontal scaling, long transactions block the event loop | Major (accepted MVP constraint) | Keep transactions short; no network I/O inside a transaction; document unsupported multi-replica deployment. |
| R3 | CSRF relies on Origin/Host match plus SameSite, not a per-form token; a request with neither `Origin` nor `Sec-Fetch-Site` passes | Major residual | §6.4 is the implemented rule; no CORS headers; never weaken the header check. |
| R4 | Login brute force is throttled in memory only (10 failures / 15 min per username+IP), resets on restart, and trusts `X-Forwarded-For` | Minor (mitigated) | Fine for one household/one process; deploy behind a proxy that overwrites `X-Forwarded-For`; documented as defence-in-depth, not a guarantee. |
| R5 | Priority/status writes under concurrent tabs: last write wins, no optimistic version check | Major (data correctness) | All writes `BEGIN IMMEDIATE` and recompute from current state; reorder is idempotent by target position. No `updated_at` precondition in MVP; accepted risk. |
| R6 | Purge must remove audit, FTS, add-on tables and uploads without leaving orphans | Major | `project_search` rows have no FK and need explicit deletion; add-on tables must declare `ON DELETE CASCADE`; avatar files of deleted users need a cleanup decision. Tested on a subtree. |
| R7 | Audit append-only is enforced by an UPDATE trigger only; DELETE is possible through the project cascade (intended for purge) and must not be reachable elsewhere | Major | No domain delete API; review every raw `DELETE FROM audit_events`; purge relies on cascade, not on manual audit deletes. |
| R8 | Avatar upload: content-type spoofing, path traversal, SVG/HTML XSS via served files | Major | Accept png/jpeg/webp magic bytes only, ≤2 MB, random filename, serve with `Content-Disposition`/`nosniff`, never as `text/html`. |
| R9 | App Admin/Viewer semantics (Root-only implicit admin, explicit Root role rows for non-admins) are inferred from the spec; ambiguity could cause privacy bugs | Major | Algorithm in §6.2 is normative; tests must cover "private from app admin" and "viewer gets no write" explicitly. Product owner should confirm. |
| R10 | Move can strand a project without an effective Admin (its Admin access may have come from the old parent) | Major open question | Recommended: validate effective admin after simulated move and reject with `LAST_ADMIN_REQUIRED`, naming projects. Confirm with product owner; tests encode whichever wins. |
| R11 | Audit coverage beyond "create, field change, archive, trash": move, restore, unarchive, membership change, workflow change | Minor open question | Default: log them in the affected project's log (and old/new parent for move) as field events; no parent duplication except child create/trash. |
| R12 | Search snippets for future add-on text fields and visibility of disabled add-on values | Minor (no add-ons ship) | Add-on values are indexed only while effectively available; availability change triggers reindex; disabled values are never searchable. Contract in `add-ons.md`. |
| R13 | Trashed project restore requires explicit mapping when its status left the parent workflow; UI must surface it | Minor (edge case) | `restoreAction` accepts mapping and raises `STATUS_MAPPING_REQUIRED`; test covers it. |
| R14 | No manual purge UI; a stalled scheduler means trash grows indefinitely | Minor | Startup sweep plus hourly interval recover automatically; README documents `scripts/purge.ts`. |
| R15 | `show_archived` is stored per user and applies app-wide; toggling from a project menu affects dashboard/search/views | Minor UX | Single user preference read in every visibility query; toggle writes `users.show_archived`, no per-view override. |
| R16 | Dashboard preference JSON is parsed against a hard-coded two-widget whitelist (`parseDashboard` / `DASHBOARD_WIDGETS`); unknown ids (future add-on widgets, reinstated Completed last week) are dropped when the preference is round-tripped | Major for forward compatibility | Relax the parser to preserve unknown ids/order and filter for rendering instead of parsing; required before the deferred widget returns. Tracked in the review log. |
| R17 | Session sliding renewal compares `created_at` and writes on most requests after day one | Minor (write amplification) | Change the condition to remaining lifetime (e.g. renew when < 1 day remains) or accept; correctness is fine. |
| R18 | `MAX(seq)+1` display-id allocation reuses ids after purging the newest project | Minor (audit references) | Prefer a persistent counter allocated in the same transaction; otherwise document and test monotonicity expectations. |
| R19 | Priority uniqueness includes trashed siblings; a reorder that ignores trashed rows can collide | Major (data correctness) | Reorder must account for trashed siblings or the unique constraint must become partial; test trash + reorder. Tracked in the review log. |

Deferred (explicitly out of scope, do not build): Assignee and its dashboard widget, descriptions,
tags/custom fields, additional collection views (Portfolio), rolling backup management, freeform
dashboard layout / query builder / shared dashboards / engagement metrics, native apps, kiosk mode,
offline operation, and the built-in **Completed last week** widget (removed from this iteration;
reintroduction without schema change is documented in `add-ons.md` §13). Scope creep in any of
these must be rejected at review.
