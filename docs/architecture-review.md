# Kapo architecture review log

**Living document.** Rounds are appended; findings keep stable ids. Review method: read the files
as they exist at the time of the round, run `npm run typecheck`/`npm test` where available, and
compare against [build-spec.md](build-spec.md) (binding), [architecture.md](architecture.md) and
[add-ons.md](add-ons.md). Findings are about the code, not about the docs.

| Round | When | Scope | Result |
|---|---|---|---|
| R1 | 2026-11-19 | Foundation layer as written: config, `src/server/db`, `src/server/auth`, `src/server/addons`, `src/server/http.ts`, `src/lib/*`, tokens/styles, UI primitives | See findings below. Domain, routes, pages, tests and deployment did not exist yet — listed as unverified. |
| R2 | 2026-11-19 | Foundation layer completed: app shell, `/setup` `/login` (+APIs), healthz, seed/reset, Dockerfile/compose, README, PWA, `lib/api-client`; `npm run typecheck` passes; projects/settings/tester domains just starting | Findings AR-020…AR-027; `npm run build`/scheduler pending; no domain review yet. |
| R3 | 2026-11-19 | Domain + API layer as it stands: `permissions`, `projects`, `workflow`, `trash`, `audit`, `search`, `inbox`, `users`, `settings`; project/inbox/search/me/users/settings/healthz routes; tests (unit/integration/domain); avatar storage. UI pages (project/inbox/search/home/profile/settings) and dashboard domain/API still being written. `npm test`: 169 pass / 3 fail (WIP test file). | Findings AR-028…AR-049; AR-021 confirmed; several rule-level defects found (move/inbox, workflow-on-read, audit ids). |
| R4 | 2026-11-19 | All MVP pages landed (Home dashboard, `/p/[id]`, project settings, Inbox, Search/Trash, Profile, App settings, Users); dashboard domain/API; four collection views incl. Kanban drag; `npm test` 19 files / 245 pass / 1 expected-fail; `npm run typecheck` clean. | Findings AR-050…AR-052; several R3 findings fixed by builders (AR-034, part of AR-035), others open (AR-029/032/036/044). |
| R5 | 2026-11-19 | Follow-up verification after the product-owner review (P3): re-read every add-on/dashboard/search/audit claim in `docs/add-ons.md` against the final code and corrected the guide; checked the post-R4 fixes (`src/server/domain/addon-hooks.ts`, purge scheduler, dashboard prefs, audit `{fromId,toId}`, dashboard parent sanitisation). | `docs/add-ons.md` has 12 factual corrections; AR-002/AR-020/AR-033/AR-044/AR-050 verified resolved; new minor findings AR-053…AR-056. |

Status language: **verified** = read in code and matches the contract; **pending** = not written or
not inspectable yet; **finding** = deviation, risk or incomplete contract.

---

## 1. Verified good (foundation, R1)

- `001_init.sql` implements build-spec §5's tables and columns: `users`, `sessions`, `projects`,
  `statuses`, `project_roles`, `favorites`, `audit_events`, `trash_actions`, `settings`, `addons`,
  `project_search` (FTS5) with the documented columns, indexes and Root uniqueness triggers
  (`src/server/db/migrations/001_init.sql`).
- Domain-shaped constraints are in SQL, not just code: one start / one finish status (partial unique
  indexes), sibling priority unique per parent, single Root, title non-empty, role/status/mode
  `CHECK`s.
- `db/connection.ts` sets WAL, `foreign_keys=ON`, `busy_timeout`, `synchronous=NORMAL` per connection.
- Migration runner is forward-only, per-file transactional, records `schema_migrations`, and runs
  before a connection is handed out (`src/server/db/migrate.ts`, `connection.ts`).
- FTS maintenance primitives exist and are designed to run in the write transaction:
  `indexProject` / `removeProjectFromSearch` / `searchBodyFromAddonValues` (`src/server/db/search.ts`).
- Passwords: scrypt with per-password salt, parameters stored with the hash, `timingSafeEqual`
  (`src/server/auth/password.ts`). Session tokens are 32 random bytes, only SHA-256 hashes stored
  (`src/server/auth/session.ts`). Cookie `kapo_session` is `httpOnly`, `SameSite=Lax`, 30 days
  (`src/server/auth/cookies.ts`).
- Login throttle exists (`src/server/auth/rate-limit.ts`), in-memory, 10 failures/15 min keyed by
  username+IP.
- CSRF helper exists and is intended for every mutating route (`src/server/http.ts`).
- Add-on contract ships as typed, framework-free code with strict registration validation and an
  empty registry (`src/server/addons/types.ts`, `registry.ts`, `index.ts`) — see §4.
- No `any` in the reviewed foundation exports; `tsconfig` has `strict` + `noUncheckedIndexedAccess`.
- R2 additions verified: `npm run typecheck` passes on the completed foundation; `/api/setup` is
  race-safe (empty-users check repeated inside the transaction) and creates Root + settings +
  session atomically; `/api/auth/login` throttles, equalises timing for unknown users, creates a
  DB session and clears attempts; `/api/auth/logout` deletes the session; `/healthz` is
  unauthenticated and leaks nothing; Dockerfile is multi-stage, non-root, standalone, migrations
  copied to `/app/migrations`, healthcheck wired; Compose uses one service + named volume; README
  documents commands, accounts, env, proxy/PWA expectations; PWA service worker never caches
  `/api/*` or authenticated HTML; `src/lib/api-client.ts` matches the `{ error: { code, message,
  fields? } }` shape.

## 2. Findings

Severity: **blocker** = breaks a stated rule or makes a core flow unsafe; **major** = must fix
before release or before the dependent feature ships; **minor** = correct but fragile/inefficient.

| id | Sev | File | Finding | Recommendation / owner |
|---|---|---|---|---|
| AR-001 | major | `src/server/db/shell-queries.ts:20` (`getFavoriteProjects`) | Favorites were filtered by `trashed_at` only; no permission filter. Because favorites are not deleted when access is lost, the sidebar could keep showing the title of a project the user may no longer read. | **Fixed at R4:** the query now loads `AccessContext` and filters through `isActiveProject`. Keep a privacy regression test. |
| AR-002 | major | `src/lib/types.ts:88,116` (`DASHBOARD_WIDGETS`, `parseDashboard`) | `parseDashboard` hard-codes `['inbox','recent']` and **drops unknown widget ids** and order. `dashboard.md` requires preserving preferences for currently-unavailable widgets, and `add-ons.md` §13 depends on it for reinstating Completed last week. A preference round-trip through the profile/dashboard editor will delete the entry. | Relax parsing: keep unknown ids/order in the preference list, filter at render time; keep a core known-widget set for rendering/editor. Owner: builder-settings (dashboard) + foundation (type). |
| AR-003 | major | `src/server/http.ts:50-63` (`isSameOrigin`) | A mutating request with neither `Origin` nor `Sec-Fetch-Site` is accepted (`return true`). This is convenient for CLI calls but is not the "Origin/Host match" check promised by build-spec §7; SameSite=Lax is the only remaining layer. | Accept the residual only if documented (it is, architecture.md §6.4). Do not weaken further. Optionally require `Origin` or `Sec-Fetch-Site` when a session cookie is present. Owner: foundation. |
| AR-004 | major | `src/server/http.ts:50-63` + deployment (not yet built) | Same-origin compares `Origin.host` with `Host` only. Behind a reverse proxy that rewrites `Host` to the internal host (common default), every mutation is rejected; behind one that does not forward the header at all it is accepted. There is no `X-Forwarded-Host` fallback. | Document that the proxy MUST preserve `Host` (or add `X-Forwarded-Host` handling before release) in README/compose guidance. Add an integration test with a proxied Host/Origin pair. Owner: foundation/Docker. |
| AR-005 | major | `src/server/auth/cookies.ts:27-32` (`requestIsHttps`) | `Secure` is decided from `X-Forwarded-Proto`, which any direct client can send, and is not set at all if a proxy fails to set it. First case is a self-DoS (Secure cookie not returned over HTTP); second silently sends a session cookie over HTTP behind an HTTPS deployment. `KAPO_FORCE_SECURE_COOKIES` is the mitigation but is unset by default. | Set `KAPO_FORCE_SECURE_COOKIES=1` in the production compose example; document proxy headers. Consider deriving from `Origin`/`Host` for browser requests as a secondary signal. Owner: foundation/Docker. |
| AR-006 | major | `001_init.sql:59` (`UNIQUE (parent_id, priority)`) | Priority uniqueness includes trashed siblings (no partial index), so a reorder that rewrites `0..n-1` over visible children can collide with a trashed sibling's priority, and append must use max over all siblings. The foundation comment notes two-phase reorder but not the trashed case. | Builder-projects: reorder must compute slots including trashed rows (or the schema becomes a partial unique index in a migration). Add a trash+reorder test. |
| AR-007 | major | `001_init.sql:43,59,85` (`projects.status_id ON DELETE RESTRICT`, `statuses.parent_id ON DELETE CASCADE`) | Purging a project deletes its workflow rows (statuses cascade) while descendant projects reference those statuses with RESTRICT. Cascade ordering in SQLite may hit the RESTRICT before descendants are deleted, aborting the purge. This is a design-time risk that only a purge test settles. | Builder-projects: purge deepest-first (delete descendants' projects, then owner statuses, then root) or clear status references first; test purging a parent whose workflow is used by its children. |
| AR-008 | major | `src/server/addons/types.ts` + `docs/add-ons.md` | Contract gaps for the documented add-on story: no project-level `required` source (product.md §7), no per-view compact renderer map, no project-page/settings slot types, no settings-control type, no migrations/compatibility. The MVP intentionally ships types only; the docs mark these FORWARD. | Keep as a known MVP limitation; when the first add-on lands, extend `types.ts` centrally (not per add-on). The product-level "project may change validation requirements" cannot be expressed today — flagged for the product owner. Owner: lead/foundation. |
| AR-009 | major | `src/server/db/bootstrap.ts:134` | `MAX(seq)+1` display-id allocation: purging the highest project makes the next project reuse a `KAP-<seq>` display id that audit rows/users may still reference. | Prefer a persistent counter allocated in the creating transaction; otherwise document id-reuse semantics. Owner: builder-projects (all create paths) or foundation. |
| AR-010 | minor | `src/server/auth/session.ts:78` | Sliding renewal tests `created_at` (age > 24h), so every authenticated request after day one issues an `UPDATE sessions`. The comment says "keeping writes rare"; the opposite is true. | Compare remaining lifetime instead (e.g. renew when `< 1 day` remains); session semantics stay the same. Owner: foundation. |
| AR-011 | minor | `src/server/auth/rate-limit.ts` + `src/server/http.ts:clientIp` | Throttle trusts the first `X-Forwarded-For` value and resets on restart; it is bypassable when the app is exposed directly (attacker rotates the header) and guessable when keyed only by IP behind a proxy. | Fine for a single-household, proxy-fronted deployment; state it in README. Do not present it as brute-force proof. Owner: foundation/docs. |
| AR-012 | minor | `src/server/db/migrate.ts:40` | Migration filenames are ordered with `localeCompare`, not a numeric/version parse; zero-padded 3-digit prefixes work, but a 4th digit or non-padded name orders incorrectly. | Use explicit numeric prefix parsing or enforce `^\d{3}_` naming. Owner: foundation. |
| AR-013 | minor | `src/server/db/migrations/001_init.sql:120` (`audit_events.project_id ... ON DELETE CASCADE`) | Append-only is protected for UPDATE only. DELETE is reachable through the project cascade (intended for purge) and there is no other guard; any future raw `DELETE FROM audit_events` code would compile and run. | Keep cascade as the only delete path; add a review rule (and optionally a `BEFORE DELETE` trigger that allows deletes only when the project row is gone). Owner: reviewer/domain. |
| AR-014 | minor | `src/server/addons/registry.ts:10` | Identifier regex `/^[a-z][a-z0-9-]*$/` accepts a trailing hyphen (`foo-`); `dashboardWidgets[].id` namespacing/uniqueness, `version` semver and field-key charset are not validated. | Tighten before add-ons ship (trailing `[a-z0-9]`, widget id prefix `identifier.`, semver check). Owner: foundation. |
| AR-015 | minor | `src/server/addons/registry.ts:59-65` | `searchFields` keys are checked for existence only; a boolean/number/user/date field may be declared searchable, contradicting `add-ons.md` (§8 says only text/longtext). | Registry or indexer must reject non-text search fields. Owner: foundation or the FTS integration owner. |
| AR-016 | minor | `src/lib/types.ts:88` / `001_init.sql:15` | Dashboard default and whitelist are defined twice (SQL string in migration, `DEFAULT_DASHBOARD` in `lib/types.ts`); they can drift. Completed last week is correctly absent from both. | Single source for defaults (bootstrap writes from lib constant) or add a test asserting equality. Owner: foundation. |
| AR-017 | minor | `src/server/auth/current-user.ts:75+` | `getSessionUser` is not request-cached; a page with a shell + page body can resolve the cookie/session twice. | Wrap in `React.cache()` (server-only helper) if it shows up in request tracing. Owner: foundation. |
| AR-018 | minor | `src/server/http.ts:readStringField` | Non-string body values become `''`, so `{}` and `{ "title": 42 }` look "present but empty" to handlers; PATCH semantics (`undefined` vs empty) depend on handlers not treating `''` as "clear". | Handlers must inspect the raw body for presence; document in API conventions. Owner: builder-projects/settings. |
| AR-019 | minor | `001_init.sql:69-81` | The single-root UPDATE trigger compares against `(SELECT id ... )`; with zero Root rows the comparison is NULL and a new Root could be inserted via UPDATE (Root is never deleted in MVP, so not reachable today). | Low priority; a normal INSERT trigger already blocks a second Root. Owner: foundation. |
| AR-020 | **blocker** | `scripts/purge.ts`; missing `src/instrumentation.ts` | Build-spec §6.9 requires purge only through scheduled cleanup: `scripts/purge.ts` **and** an app startup sweep. The repository has only the script; there is no `instrumentation.ts`/startup sweep, and the Docker runner image does not copy `scripts/` or `package.json` scripts, so `npm run db:purge` cannot run in the production container either. In a Docker deployment trash is never purged, violating the 30-day rule. Separately the script is a second purge implementation: it does not run add-on purge hooks, does not delete descendant `project_search` rows (orphan FTS rows when a parent is purged), and may hit the `status_id ON DELETE RESTRICT` ordering risk before the domain purge exists. | Owner: builder-projects (domain `trash.purgeExpired`) + foundation/lead for the runtime entry point. Add `instrumentation.ts` startup sweep + interval calling the domain `purgeExpired`; make `scripts/purge.ts` a thin wrapper over the same function; delete descendant search rows for the whole subtree; add a purge test on a parent with children. |
| AR-021 | major (verify) | `src/server/seed.ts:390-405`; `/api/setup` | The seed grants Root `project_roles` explicitly to non-admin users, but `/api/setup` creates only the first admin and no Root rows. If the permission engine implements "app user → none" literally and only app Admin maps to Root, users created later via `/users` would see no projects and the Root member list would not show them. There must be one owner for "new account gets Root `user`/`viewer` role" (users domain on create/role change) and tests for it. | Builder-settings: create the Root `project_roles` row on user creation and update it on app-role change, with a last-admin guard; builder-projects: expose the Root member list including the implicit Admin. Add tests. |
| AR-022 | minor | `src/app/layout.tsx:69-78` | The root layout catches every error from `getSessionUser` and silently renders anonymous. A database outage therefore shows a signed-out shell instead of an error; only `/healthz` reveals it. | Narrow the catch to build-time/unavailable-cookie conditions, or render a DB-unavailable state; keep `/healthz` as the probe. Owner: foundation. |
| AR-023 | minor | `scripts/purge.ts:8-13` + README | README documents `npm run db:purge` as an operator command, but the production image (Next standalone + public + migrations only) has no scripts or npm, so the command is developer-only. | Document that production purge is the startup sweep/interval, or add a small `node` purge entry to the image. Owner: foundation/lead. |
| AR-024 | minor | `Dockerfile` (builder stage) | `npm run build` runs in the builder with `DATABASE_PATH` unset and no data directory; that works only because every page/layout is `force-dynamic` and the root layout swallows DB errors. Adding any statically rendered authenticated page would make the Docker build open/read `./data/kapo.db` unexpectedly. | Keep `force-dynamic` on auth-dependent routes (already declared) and/or set a throwaway DB path in the builder stage; document the rule. Owner: foundation/builders. |
| AR-025 | minor | `public/sw.js:53` | Navigations are network-first and fall back to `offline.html`, but the offline page is also returned for **authenticated** routes that fail while online (e.g. 500), not only for offline. There is no check of `navigator.onLine` or response status. | Acceptable for MVP; make the fallback conditional or show a retry action. Owner: foundation. |
| AR-026 | minor | `src/app/(app)/layout.tsx:14` | `getShellData(user.id)` calls `getFavoriteProjects`, which is documented AR-001. The shell resolves the session in the root layout (`getSessionUser`) and again in the app layout (`requireUser`), so two cookie/DB reads per page. | Share the resolved user via a request-scoped cache or pass it through; see AR-017. Owner: foundation. |
| AR-027 | minor | `src/server/seed.ts:86-100` (`clearDatabase`) | `clearDatabase` deletes every domain table by name; adding a new table to `001_init.sql` (or an add-on table) requires remembering to clear it here, otherwise `npm run db:seed` leaves rows behind. | Derive the table list from `sqlite_master` minus `schema_migrations`/`project_search`, or add a test that seeded reset leaves only expected rows. Owner: foundation/tester. |
| AR-028 | major | `src/server/domain/projects.ts:12-26`, `trash.ts:6-11`, `inbox.ts:2`, `search.ts:2` | Domain modules import **runtime values** (`DEFAULT_LAYOUT_TEMPLATE`, `PROJECT_FIELD_KEYS`, view-model types) from `src/components/projects/types.ts`. It is a `.ts` module with no React import today, so it compiles and tests pass, but the dependency direction is inverted (domain → UI tree) and a future React/CSS import in that file would drag UI deps into domain/vitest. | Move serialisable project view models + layout constants to `src/lib/projects.ts` (or `src/server/domain/types.ts`) and have both domain and components import from there. Owner: builder-projects. |
| AR-029 | major | `src/server/domain/audit.ts:103` (`listActivity`) | The activity reader takes no viewer. The API route checks access to the **log owner** only. The query joins `target_id` to `projects` and returns the live target title, so a reader who can see the parent log can read the title of a child project they cannot see (or whose title changed) through `project.child_created` / `project.child_trashed` rows. | Pass the viewer/`AccessContext` (or pre-resolved readable target ids) and either hide targets the viewer cannot read or render the snapshot `detail`/`new_value` instead of the live join. Add a privacy test. Owner: builder-projects. |
| AR-030 | minor | `src/server/domain/*` transactions | Commands use `db.transaction(() => …)` (deferred locking). Node is single-threaded and the callbacks are synchronous, so request interleaving is not possible; the residual risk is contention with a separate `scripts/purge.ts` process. | Fine for MVP; a `withTransaction(immediate)` helper in `src/server/db` is recommended before any background job runs in a second process. Owner: builder-projects/foundation. |
| AR-031 | minor | `src/server/domain/permissions.ts:610` (`listProjectMembers`) | The member list returns explicit grants only. An application Admin's implicit Root admin has no row, so the Members UI (when built) can show Root without its administering Admin. | Either synthesise the implicit Root admin in the settings read model or add an explanatory "Application Admins administer Root" row. Owner: builder-settings/builder-projects. |
| AR-032 | major | `src/server/domain/workflow.ts:139-146` (`ensureWorkflow`) and callers `projects.ts:436,986`, `inbox.ts:45`, `/api/projects/:id/workflow` GET | `ensureWorkflow` inserts the default To do/Done workflow when a project has none, and it is called from GET/page paths. Viewing a childless project (even as an application Viewer) mutates the database, violating the architecture rule "GET handlers never mutate" and making read routes fail in read-only deployments. | Seed the default workflow when the project is created (or when its first child is added) and make read paths read-only; if lazy seeding must stay, confine it to mutating commands. Owner: builder-projects. |
| AR-033 | major (forward) | `src/server/domain/projects.ts:740-751`, `workflow.ts:461-465` and `src/lib/audit.ts` | Status-change audit rows store status **names** in `old_value`/`new_value`, not ids; the workflow domain writes `action = 'workflow.updated'`, which is not in `AUDIT_ACTIONS`. The deferred Completed-last-week widget (add-ons.md §13) needs reliable status-id transitions; the Activity UI must also tolerate the unknown action. | Add old/new status ids (or finish flag) to the event `detail` and add `workflow.updated` to the vocabulary/tests. Forward-only; no schema change. Owner: builder-projects. |
| AR-034 | major (verify at UI) | `src/server/domain/projects.ts:811-927` (`reorderProject`) | The reorder command always rewrites sibling priority, even when only `statusId` changes. Build-spec §6.7 says a cross-column move changes **status only** and preserves priority. If the Kanban cross-column handler calls this route (rather than `PATCH /api/projects/:id`), rule 7 is violated. The within-column path correctly includes trashed siblings in the two-phase rewrite. | Verify the Kanban drag wiring; make cross-column call the status update, and/or make `reorderProject` with a status change and no `beforeId` skip the priority rewrite. Remove the no-op update at line 893. Owner: builder-projects. |
| AR-035 | major | `src/server/domain/projects.ts:1100-1129` (`moveProject`) | Moving a project changes its `status_id` directly but does not clear `inbox` and does not run the Inbox-exit validation gate. Build-spec §6.6 says any status change clears Inbox; a moved Inbox project therefore keeps `inbox = 1` under a new status. Also no last-admin check after the move (AR from R1/R10). | Clear the flag when the move changes status (and gate it once add-ons are wired); validate that the moved project still has an effective Admin and reject naming it otherwise. Owner: builder-projects. |
| AR-036 | major | `src/server/domain/workflow.ts:389-412` | When a workflow edit remaps live children out of a removed status, it updates `status_id` + audit + FTS but does **not** clear `inbox` on those children, so remapped Inbox projects stay in the Inbox under the new status (rule 6 again, admin-initiated path). | Set `inbox = 0` for remapped children that were in Inbox, or explicitly document why a workflow remap is exempt (it is still a status change). Owner: builder-projects. |
| AR-037 | minor | `src/server/domain/permissions.ts:591-599` (`memberCascadeImpact`) | Exported helper is dead code that always returns an empty map (`projectGrants` computed then voided). | Remove it or implement the per-member cascade count; `listProjectMembers` already computes `descendantGrants`. Owner: builder-projects. |
| AR-038 | minor | `src/server/domain/trash.ts:132` | `trashProjects` accepts a client-supplied `actionId` and uses `INSERT OR IGNORE`; reusing an existing id groups unrelated operations under one restore scope. The build-spec route allows `actionId` for batching, so the contract needs a rule. | Either generate the action id server-side and return it (client repeats it for genuine batches of the same operation) or validate that a supplied id belongs to the actor/current batch. Owner: builder-projects. |
| AR-039 | minor | `src/server/domain/projects.ts:947-1009` (`getMoveInfo`) | The destination list includes the project's **current parent**, but `moveProject` rejects that destination with "already under that parent". | Exclude the current parent from destinations (or treat it as a no-op). Owner: builder-projects. |
| AR-040 | minor | `src/server/domain/inbox.ts:57-82` (`releaseInboxProject`) | Release changes `inbox` but writes no audit event; settings/workflow changes use ad-hoc audit actions. Product says history covers a project's changes; release is a visible lifecycle change. | Record a `project.inbox_released` (or field `inbox`) event and add it to the vocabulary; consider auditing workflow/settings edits as field events. Owner: builder-projects. |
| AR-041 | minor | `src/server/api-session.ts`, `src/server/api-errors.ts`, `src/app/api/projects/_shared.ts` | Two parallel guard/error stacks exist: projects routes use `requireApiUser`/`handleDomainError` (DomainError only); settings/users routes use `apiSession`/`domainErrorResponse` (AccountError/SettingsError only). `apiSession` resolves the session twice (`getSessionUser` + `resolveSession`). A route that needs both a project error and a settings error has no single mapping. | Consolidate into one route helper module that handles 401, same-origin, `DomainError`/`AccountError`/`SettingsError`, and resolve the session once via request scope. Owner: builders, coordinated by lead. |
| AR-042 | minor | `src/app/api/projects/[id]/route.ts` GET, `/api/inbox` GET, `/api/search` GET, `/api/projects/[id]/workflow` GET | Read handlers have no `try/catch`; a non-`DomainError` throw (e.g. a DB error) becomes Next.js's generic 500 rather than the build-spec error envelope. The `/api/projects/:id` GET also calls the mutating `ensureWorkflow` (AR-032). | Wrap all handlers with the shared error mapper; make reads read-only. Owner: builders. |
| AR-043 | minor | `src/server/domain/search.ts:83-147` (`searchProjects`) | FTS rows are fetched with `limit * 4` then permission-filtered in JS, so a user with access to only a few projects can get fewer results than the limit; the query itself is not permission-filtered (server process only, so no client leak). | Move the permission predicate into the SQL (join `project_roles`/access set) or raise/iterate the fetch until the filtered limit is met. Owner: builder-projects. |
| AR-044 | minor | `src/server/domain/users.ts:211-253` (`normalizeDashboardPreference`) | Same forward-compatibility issue as AR-002: the dashboard write path rejects unknown widget ids and rewrites the list to the two known widgets. Any future widget (add-on, Completed last week) cannot be saved/preserved. | Keep unknown ids in the stored preference, validate only known widget instances, filter for render. Owner: builder-settings. |
| AR-045 | major (open) | `src/server/domain/trash.ts:105`, restore `:291` | Trash and restore require project **Admin**. Product.md does not define who may trash; project Users "read, edit and create children". If a household member is expected to remove a project, this is a product-permission mismatch. | Product owner decision needed; if Users may trash, change capability check. Owner: product owner + builder-projects. |
| AR-046 | minor | `src/server/domain/trash.ts:177-185` (`restoreSetFor`) | Restore selects target + descendants with the same action; it does not verify that no ancestor of a restored descendant stays trashed (the parent-trash check only covers the target). The action-grouping invariant makes this safe today, but a future move/re-trash interaction could break it. | Add an invariant test: restore a target whose sibling was trashed separately; assert the sibling stays trashed and its parent is restored. Owner: tester/builder-projects. |
| AR-047 | minor | `src/server/domain/audit.ts:169-179` (`assertProjectExists`) | Throws a plain `Error`, not a domain error, so a route using it would 500 rather than 404. It is unused at R3. | Remove or convert to `DomainError`. Owner: builder-projects. |
| AR-048 | minor | `src/server/domain/audit.ts:156-159` | `target` resolution includes `child_created` even without a join title, but `child_trashed` falls back to null; a purged/changed target title shows "a child project" or disappears. | Snapshot the child title in `detail` at write time and render from it (also fixes AR-029). Owner: builder-projects. |
| AR-049 | minor | `tests/domain/projects.test.ts` (R3) | The test suite is WIP and currently red: duplicate workflow fixture violates the start/finish unique indexes, a cycle assertion expects a message that a different validation produces first, and `ProjectCard`/fixture fields used by the test do not exist. `npm run typecheck` also fails on this file. Not evidence of a product rule failing, but the suite is not a gate yet. | Tester to finish and green the suite; builders to keep public view models stable (or update fixtures deliberately). Owner: tester. |
| AR-050 | major | `src/server/domain/dashboard.ts:43-82` (`getInboxWidget`) | The Home Inbox preview joins and returns `parent.title` without checking that the viewer can read the parent. `listInbox` (domain) correctly nulls the parent title in this case, but the dashboard payload does not, so a user with a direct grant on a child whose parent is inaccessible (or private) sees the inaccessible parent's title on Home. Violates rule 12's "never leak titles". | Reuse the Inbox domain's parent-sanitisation (or compute from `AccessContext`) in `getInboxWidget`; add a dashboard privacy test. Owner: builder-settings. |
| AR-051 | minor | `src/server/domain/dashboard.ts:196-206` (`getDashboardWidgets`) / `src/components/dashboard/Dashboard.tsx` | Dashboard order/visibility comes from `users.dashboard`, which `parseDashboard`/`normalizeDashboardPreference` already reduce to the two known ids (AR-002/AR-044). The editor cannot show an unavailable/unknown widget, and a future widget id in a saved preference is lost on the next save. Consistent with the MVP's two widgets, but it is the concrete blocker for the deferred Completed-last-week return. | Relax parsing to preserve unknown ids and filter for rendering; the editor renders known widgets plus an "unavailable" row for preserved ids. Owner: builder-settings. |
| AR-052 | major (confirm at R4) | `src/app/p/[id]/page.tsx:15` → `projects.getProjectPageData:437` | The project page (a server component read) still calls `ensureWorkflow` for non-trashed projects, so rendering a page can insert default statuses. Confirms AR-032 on the shipped page path. | Move default-workflow seeding to project create (or first child create) and make the page read-only. Owner: builder-projects. |
| AR-053 | minor | `src/server/domain/projects.ts:982,985` | `reorderProject` calls `assertInboxExitAllowed` twice in a row for the same status change (duplicate/dead call). Harmless while the registry is empty; with a Required add-on it would run hooks twice (and could double-report if hooks are impure). | Delete the duplicate; add a regression test that hooks are invoked once per exit. Owner: builder-projects. |
| AR-054 | major (design) | `src/server/domain/addon-hooks.ts:45-58` | The hook runner evaluates every registered add-on regardless of mode, passes the DB-resolved `mode` (default `'optional'` because the registry→`addons` table sync is FORWARD) and does not resolve per-project enablement/inheritance. A `Required` add-on whose hook checks `mode === 'required'` therefore never blocks until sync/Admin configuration exists. | Implement the registry→table sync + Admin mode surface (and project enablement) before the first add-on ships; documented in `docs/add-ons.md` §4.2. Owner: lead/first add-on owner. |
| AR-055 | minor | `src/server/db/search.ts:searchBodyFromAddonValues` | The helper has no caller; all `indexProject` calls pass `body: ''`, so add-on text is not searchable and availability changes do not reindex. FORWARD (documented), not a defect while no add-on ships. | The first add-on's generic indexing bridge must call it inside the project/value transaction and reindex on availability/mode change. Owner: first add-on owner. |
| AR-056 | minor | `src/server/domain/dashboard.ts:183-206`; `src/lib/types.ts:DASHBOARD_WIDGETS` | Core widgets are hard-coded (`getInboxWidget`/`getRecentWidget`), the id tuple is fixed, and `AddonDashboardWidget` has no consumer. The add-on widget surface and the deferred Completed-last-week widget need a small generic core bridge (payload dispatch + editor/renderer entry + default order), not registration alone. | Build the bridge when the first widget ships; no schema change. `docs/add-ons.md` §9/§13 corrected at R5. Owner: builder-settings/lead. |

### R5 status of earlier findings (verified against the final code)

| Finding | Status at R5 |
|---|---|
| AR-002 / AR-044 / AR-051 dashboard preference forward-compat | **Resolved:** `parseDashboard` preserves unknown ids/order, `normalizeDashboardPreference` shape-validates and keeps them, and the Home editor keeps unknown entries in their slots (only Restore defaults drops them). Remaining (AR-051 tail): the editor still does not render an "unavailable widget" row; that belongs to the future widget bridge (AR-056). |
| AR-020 purge blocker | **Resolved:** `src/server/domain/purge.ts#purgeExpired` (subtree expansion, leaf-first delete, FTS rows, no purge audit), `src/instrumentation.ts` + `instrumentation-node.ts` (startup + 6-hourly sweep, build-phase/edge guarded), and `scripts/purge.ts` is a thin wrapper. Add-on purge hook remains FORWARD (JSON dies with the project row; add-on tables must cascade). |
| AR-033 audit status ids | **Resolved:** status events now store `detail` JSON `{fromId,toId}` in update/reorder/move/bulk-move/workflow-remap paths; `project.inbox_released` and `workflow.updated` are in `AUDIT_ACTIONS`. The deferred Completed-last-week count can use ids now. |
| AR-050 dashboard leaks unreadable parent title | **Resolved:** `getInboxWidget` checks `canReadProject(parent)` and nulls parent title/status. |
| AR-053 duplicate Inbox-exit gate call in `reorderProject` | **Fix in progress (builder-projects):** duplicate `assertInboxExitAllowed` at `projects.ts:982,985` is being removed; docs describe the single-call intent. |
| AR-035 move clears Inbox + last-admin | **Resolved:** move/bulk-move clear `inbox` and call `assertMoveKeepsAdmin`; the add-on gate is also called for Inbox moves (AR-054 remains for mode sync). |
| AR-029 activity target-title leak | Still open (`listActivity` has no viewer); not reached by the PO review but still a privacy edge. |
| AR-032/AR-052 workflow-on-read | Still open (`ensureWorkflow` remains on read paths). |
| AR-021 new-account Root grant | Still open. |
| AR-028 domain → components types | Still open. |
| AR-036 workflow-remap Inbox flag | Still open. |
| AR-041 duplicate route helper stacks | Still open. |
| AR-045 trash/restore Admin-only | Open product question. |

### R5 doc-claim verification (product-review P3 corrections)

All seven P3 corrections were applied to `docs/add-ons.md` after re-reading the code:

| P3 item | Verified implementation | Doc change |
|---|---|---|
| 1 Hooks wired | `src/server/domain/addon-hooks.ts` `assertInboxExitAllowed` called from release/status-change/reorder/move/bulk-move/workflow-remap; both hooks run; mode from `addons` with `?? 'optional'`; registry sync FORWARD | §1 status, §2/§2.1 current-state notes, §4.1/§4.2 rewritten, §11 rewritten |
| 2 `validate` also runs on exit | `addon-hooks.ts` runs `beforeLeaveInbox` then `validate` | §4.1 actual order, §4.2 and §12.2 warnings |
| 3 `parseDashboard` preserves unknown ids | `lib/types.ts`, `users.normalizeDashboardPreference`, `Dashboard.tsx` known-only render/preserve-slot | §9 preference bullet, §13 preference row |
| 4 Core widgets not registry-backed | `domain/dashboard.ts` hard-codes, fixed tuple, no `AddonDashboardWidget` consumer | §9 last bullet, §13 registration row/reintroduction checklist |
| 5 Status audit `{fromId,toId}` | Present in all status-changing paths; `AUDIT_ACTIONS` extended | §13 counting row and dependency paragraph |
| 6 Add-on search body unwired | `searchBodyFromAddonValues` no caller; all `indexProject` bodies `''` | §8 rewritten as FORWARD with integration steps |
| 7 `user` field / Tree-List wording | `registry.ts` rejects both `options` and `optionsSource`; core Tree/List editable by writers; single `compactRenderer` key with no consumer | §3 table, §4 note/table, §7 rewritten, §12.3 corrected |

### R4 status of earlier findings (verified against code, not just reports)

| Finding | Status at R4 |
|---|---|
| AR-001 favorites permission filter | **Resolved between R1 and R4:** `db/shell-queries.ts` now loads `AccessContext` and filters favorites through `isActiveProject` (favorites disappear when access is lost, no title leak). Minor leftover: an unused `canReadProject` import. |
| AR-002 / AR-044 dashboard preference preservation | Still open (hard-coded two-widget whitelist on read and write). |
| AR-020 purge blocker | Still open: no `instrumentation.ts`, no domain `purgeExpired`; `scripts/purge.ts` unchanged. |
| AR-021 Root grant for new accounts | Still open: `users.createUser`/`updateUser` do not write Root `project_roles`; the seed does it by hand. |
| AR-028 domain → components type import | Still open (`projects.ts` imports runtime values from `components/projects/types.ts`). |
| AR-029 activity target-title leak | Still open in `listActivity`; note the dashboard recent widget does sanitise its target title (good example to copy). |
| AR-032 workflow-on-read | Still open (see AR-052). |
| AR-033 audit status ids / `workflow.updated` vocabulary | Still open. |
| AR-034 cross-column reorder | **Resolved/verified:** `CollectionViews` sends cross-column moves to `PATCH /api/projects/:id { statusId }` (`changeStatus`) and within-column reorders only with the current status; the domain side still has the permissive reorder API, so keep the test that cross-column leaves priority unchanged. |
| AR-035 move clears Inbox | **Partially fixed:** `moveProject` now writes `inbox = 0` with the new parent/status (`projects.ts:1106`). Add-on gate and last-admin check after a move remain open (R20/AR-035). |
| AR-036 workflow remap clears Inbox | Still open (`workflow.ts` remap updates status only). |
| AR-039 current parent offered as destination | Still open. |
| AR-041 duplicate route helper stacks | Still open; UI pages call domain directly for reads (fine), but two API guard stacks remain. |
| AR-045 trash/restore permission | Still open product question (Admin-only today). |
| AR-049 WIP test suite | **Resolved:** `npm test` is green at R4 (19 files / 245 passing / 1 expected-fail) and `npm run typecheck` is clean. The suite still needs rule-level coverage for trash/audit/search/inbox/workflow to be complete (see §5). |

### R4 verified-good additions (UI layer)

- Pages are thin server components: auth guard → domain read → serialisable props → client component;
  no SQL/business rules in components; mutations go through `src/components/*/api.ts` helpers.
- Project page composes the page-01 structure (breadcrumb, favorite, settings/actions, Properties
  sidebar, details, child collection, Activity last); Viewer/read-only rendering is driven by
  `project.canEdit`/`canAdmin` and drag handles are disabled for viewers.
- Kanban wires cross-column drag to the status PATCH (priority preserved) and within-column drop to
  the reorder endpoint (verified above); Card/List/Tree render the same project cards with the List
  finish/start semantics.
- Inbox is Card presentation with parent context, release labelled with the parent's start status,
  Open, and local Pulled badges that persist until navigation; the domain now returns `canRelease`.
- Dashboard: widgets fetch their own payloads, malformed payload → local Retry, saved order and
  visibility honoured, no Completed-last-week widget, no fake engagement/summary tiles.
- Search page renders server-computed permission-filtered results and a separate Trash tab; Trash
  page restores through the API with mapping/acknowledgement dialogs.
- Settings/Profile/Users pages use the settings/users domain routes; the add-on tab/registry UI is
  correctly absent (contract-only MVP).

### R3 verified-good additions

- Permission engine: nearest-grant inheritance, Root fallback (admin only, never inherited), direct
  descendant grants without ancestor access, viewer clamp, reduction cascade (overrides higher
  descendant grants, does not raise lower ones), last-admin simulation naming affected projects,
  root-admin guard — all covered by meaningful `tests/domain/permissions.test.ts` cases including a
  real SQLite fixture.
- Project create: title validation, parent start status, append-last priority (includes trashed
  siblings), Inbox vs `skip_inbox`, creator Admin + copied parent grants, project + parent audit
  events, FTS insert, all in one transaction.
- Move: explicit status mapping required (no name matching), cycle rejection, destination permission
  check, descendants keep statuses, add-on JSON untouched; explicit mapping errors carry field hints.
- Trash: one action per operation, newly trashed descendants share it, already-trashed descendants
  keep action+deadline, per-project deadlines, read-only checks in every mutating project command,
  same-action restore, deferred status mapping with retired statuses, FTS removal/re-index, parent
  audit events, permission-filtered trash listing.
- Workflow: exactly one start and one finish, ordered positions, in-use removal requires mapping,
  trashed children defer mapping, retired status rows kept until unreferenced, two-phase position
  rewrite, children remapped with audit + FTS.
- Search: FTS5 prefix tokens, escaped query, trash excluded, archived follows `show_archived`,
  inaccessible rows filtered before serialisation, direct-access flag without leaking the ancestor.
- API: consistent same-origin → auth → parse → domain → error-envelope pattern on the project,
  inbox, search and auth routes; 401/403/404/409/422 statuses; no handler contains rule logic.
- Avatar: magic-byte PNG/JPEG/WebP detection, 2 MB cap, declared-MIME mismatch rejected, generated
  safe filename, traversal-proof resolver, private authenticated serving with `nosniff` +
  `content-type`, old file removed on replace.
- Seed: explicit permissions for the shared/private fixtures, creator admins, favorites, activity
  history, correct Inbox items and no Completed-last-week widget in the default dashboard.
- Tests: 13 files / 169 passing assertions at R3 across schema, FTS, auth, HTTP helpers, registry,
  rate limit, setup/login integration and permissions domain.

## 3. Add-on contract review (R1)

The registry ships **empty**, so add-on behaviour is verified by construction and by
registry/contract tests — **not** by an end-to-end add-on flow. There is no add-on data path, no
settings surface, no renderer and no widget loader in the MVP; that is the locked scope (build-spec
§1/§12), not a defect.

Verified as specified: `AddonMode` (`required|always|optional|unavailable`), `AddonFieldType`
(`boolean|number|text|longtext|date|select|user`), `AddonFieldDefinition` (static `options` or
`optionsSource: 'users'` for select; `user` must not carry static options), `AddonDefinition`
(identifier regex, name, version, fields, `searchFields`, `compactRenderer`, `dashboardWidgets`,
hooks `validate` / `beforeLeaveInbox`), `AddonWidgetContext` (`viewerId`, permission-filtered
`visibleProjectIds`, read-only `query`), and registry validation for identifier/name/version
duplicates, field keys, select options, user-field options, search-field existence.

**Invariant to preserve — `AddonWidgetContext` is read-only.** `query(sql, params)` is a read-only
helper; `visibleProjectIds` is the core-computed permission set, which a loader may narrow but
never expand. Future implementations must not replace this with a raw writable `Db`, a transaction
object, or a permission helper, and must not allow a loader to query outside its own namespaced
data joined to `visibleProjectIds`. Reviewers must reject any weakening.

Contract gaps that are documented as FORWARD in `docs/add-ons.md` and should be closed centrally
before the first add-on (not per add-on): project-level required flag, per-view compact renderer
map, project-page/settings slot types + props, add-on settings control definitions, migration and
compatibility fields, `onModeChange`/`onProjectPurge`/`onInstall` hooks, `addons` table sync
defaults. None of these should be faked inside an add-on's `settings` JSON.

## 4. Docs ↔ code mismatches found in R1 (fixed in docs, listed for traceability)

| Doc claim (before R1 fix) | Code | Status |
|---|---|---|
| Password hashing `N=32768` | `N=16384` (`password.ts`) | architecture.md corrected |
| Session renews when `< 20 days` remain | Renews when `created_at` older than 24h | architecture.md corrected; behaviour flagged AR-010 |
| CSRF rejects missing/mismatched Origin | Missing Origin + missing `Sec-Fetch-Site` passes | architecture.md §6.4 corrected; AR-003 |
| `withTransaction` exported by `db/connection.ts` | No transaction helper in the DB layer yet | architecture.md corrected; domain contract requires one |
| `schema_migrations(version, applied_at)` + `PRAGMA user_version` | `schema_migrations(id, name, applied_at)`, no `user_version` | architecture.md corrected |
| Priority partial unique index excluding trashed | Full `UNIQUE(parent_id, priority)` including trashed | architecture.md corrected; AR-006 |
| Audit DELETE blocked by trigger | UPDATE trigger only; DELETE via project cascade | architecture.md corrected; AR-013 |
| Add-on `AddonMode` `always_on`/`available`, `AddonValue`, per-view compact map | Actual names: `always`/`optional`, `AddonFieldValue`, single `compactRenderer` | add-ons.md rewritten against the code |
| Environment `TRUST_PROXY`, `PURGE_INTERVAL_MS` | Not implemented; `KAPO_MIGRATIONS_DIR`, `KAPO_FORCE_SECURE_COOKIES` exist | architecture.md corrected |

### R3 docs ↔ code mismatches (fixed in docs, listed for traceability)

| Doc claim (before R3 fix) | Code | Status |
|---|---|---|
| Query filtering is a SQL recursive CTE/access set; no JS filtering | `loadAccessContext` loads the tree and filters in the domain process | architecture.md §6.3 rewritten |
| Every domain command uses a `withTransaction(BEGIN IMMEDIATE)` helper | No helper; commands use `db.transaction` (deferred) | architecture.md §4 corrected; AR-030 |
| Release/status change share `exitInbox` and run the add-on gate | Two separate code paths; no add-on hook is called anywhere | architecture.md rule 6 row + add-ons §4.2 corrected; AR-020/R20 |
| App Users get a Root `project_roles` row on account creation | `users.createUser`/`updateUser` never write it; only the seed does | architecture.md §6.2 corrected, risk R23; AR-021 confirmed |
| Completed-last-week can be derived from status-id transitions in audit | Status events store names only; `workflow.updated` not in vocabulary | architecture.md §8.1 + add-ons §13 corrected; AR-033 |
| Scheduler exists (`instrumentation.ts` + startup sweep) | Neither exists; production image has no purge path | architecture.md §8.3 corrected; AR-020 |
| Dashboard preferences preserve unknown widget ids | `parseDashboard` and `normalizeDashboardPreference` reject/drop unknown ids | AR-002/AR-044 |
| GET handlers never mutate | `ensureWorkflow` inserts on read paths | AR-032 / architecture risk R22 |

## 5. Not verified yet (pending — will be re-reviewed)

R4 reviewed the shipped UI pages/components. Remaining unverified/blocked items:

| Area | Why it matters |
|---|---|
| Purge scheduler runtime | Code is verified at R5 (`domain/purge.ts`, `instrumentation.ts`/`instrumentation-node.ts` startup + 6-hourly, `scripts/purge.ts` wrapper) but the container was not executed here; the designer/product-owner pass covers the "automatic purge" acceptance step. |
| Production build + container | `npm run build`, Docker image, compose smoke test were not run by the architect; AR-004/AR-005 depend on real proxy/build behaviour. |
| E2E flows | The Playwright first-install spec and server harness exist; critical flows (capture→Inbox→release, Kanban status vs priority, dashboard persistence, trash restore, viewer read-only) were not executed for this review. Domain/API tests cover much of the logic but not the browser wiring. |
| Manual seeded walkthrough | Seed data was surfaced through integration tests; the full seeded UI walkthrough (design acceptance) is the designer/product-owner pass. |
| A11y and responsive | Keyboard/focus, dark theme, 390px mobile, 1440px desktop require the designer review; code shows semantic landmarks/labels but this is not proven. |
| Add-on end-to-end | By design there is no add-on flow: MVP ships an empty registry. Add-on rules are verified by **construction and registry/contract tests**, not by an add-on. The read-only `AddonWidgetContext` invariant remains a future-implementation promise (see §3). |
| Remaining rule-level tests | R4 suite is green, but trash deadlines/restore grouping, parent-log-only audit duplication, workflow remap, inbox release and search permission filtering need explicit domain tests (the tester was still adding files when this round closed). |
| Dashboard unavailable-widget behaviour | Cannot be exercised without an add-on; the editor only has the two core widgets. Preference preservation is fixed (AR-002/AR-044 resolved); the "unavailable widget" editor row remains with the future widget bridge (AR-051 tail / AR-056). |

## 6. Update log
## 6. Update log
## 6. Update log

- **R1 (2026-11-19):** foundation layer partial review. 19 findings (0 blockers, 8 major, 11 minor),
  contract review of `src/server/addons/*`, doc corrections applied. Foundation was still writing
  the app shell when this round closed; no domain, API, tests or deployment existed.
- **R2 (2026-11-19):** foundation completed and reviewed as a whole (shell, auth pages/APIs,
  healthz, seed, Docker/compose, README, PWA; `npm run typecheck` clean). Added AR-020…AR-027: one
  blocker (no startup purge sweep and no production purge path — build-spec §6.9), five major, seven
  minor. Domain builders had just started; their code was not reviewable yet. R3 will review the
  completed domain/API/UI/test layer, run the app/build, and re-check AR-001/AR-002/AR-006/AR-007/
  AR-020/AR-021 against the implementations.
- **R3 (2026-11-19):** domain + route layer reviewed while the UI was still being written. Added
  AR-028…AR-049 (2 blockers' worth of pending work is captured by AR-020; new majors: layering
  inversion AR-028, activity target-title leak AR-029, workflow-on-read mutation AR-032, audit
  status-ids gap AR-033, reorder/cross-column risk AR-034, move-doesn't-clear-inbox AR-035,
  workflow-remap-doesn't-clear-inbox AR-036, open trash permission question AR-045). AR-021 was
  confirmed as a real defect (new accounts get no Root grant). The test suite was red (3 failures,
  WIP) and typecheck failed on the WIP test file; this is recorded as AR-049. UI, dashboard, purge
  scheduler, build and e2e remain unverified (§5). R4 should review the UI/collection/dashboard
  layer, re-run `npm test`/`npm run typecheck`/`npm run build`, and verify AR-002/AR-021/AR-032/
  AR-034/AR-035/AR-036/AR-044 against the finished code.
- **R4 (2026-11-19):** UI layer (all pages, project page, four views incl. Kanban drag, Inbox, Search/Trash, dashboard, profile/settings/users) reviewed against the running code; `npm test` green (19 files / 245 passing / 1 expected-fail) and `npm run typecheck` clean. AR-034 verified resolved and AR-035 partially fixed; added AR-050 (dashboard leaks unreadable parent title), AR-051 (dashboard preference forward-compat), AR-052 (project page still mutates via lazy workflow). Remaining gaps: purge/AR-020 (blocker), AR-002/AR-021/AR-028/AR-029/AR-032/AR-033/AR-036/AR-039/AR-041/AR-044/AR-045 open, production build + e2e + a11y not run by the architect. R5 should be run after the builders' final fixes: `npm run db:reset && npm run build && npm run start` smoke, `npm test`, `npm run test:e2e`, then re-check every open finding.

- **R5 (2026-11-19):** post-P3 doc verification. Confirmed wired add-on hooks, preserved dashboard preferences, purge scheduler, status-id audit detail and dashboard parent sanitation; corrected `docs/add-ons.md` in 12 places. Marked AR-002/AR-020/AR-033/AR-044/AR-050 resolved and added AR-053 (duplicate Inbox gate call), AR-054 (hook mode sync/enablement FORWARD), AR-055 (add-on search body unwired), AR-056 (dashboard widget bridge needed). **`docs/architecture.md` is now stale on AR-020/AR-033/AR-002 wording and needs a sync pass before the next hand-off.** Remaining open majors: AR-021, AR-028, AR-029, AR-032/AR-052, AR-036, AR-041, AR-045; production build/e2e/a11y still not run by the architect.
