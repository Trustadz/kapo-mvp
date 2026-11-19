# Kapo architecture review log

**Living document.** Rounds are appended; findings keep stable ids. Review method: read the files
as they exist at the time of the round, run `npm run typecheck`/`npm test` where available, and
compare against [build-spec.md](build-spec.md) (binding), [architecture.md](architecture.md) and
[add-ons.md](add-ons.md). Findings are about the code, not about the docs.

| Round | When | Scope | Result |
|---|---|---|---|
| R1 | 2026-11-19 | Foundation layer as written: config, `src/server/db`, `src/server/auth`, `src/server/addons`, `src/server/http.ts`, `src/lib/*`, tokens/styles, UI primitives | See findings below. Domain, routes, pages, tests and deployment did not exist yet — listed as unverified. |

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

## 2. Findings

Severity: **blocker** = breaks a stated rule or makes a core flow unsafe; **major** = must fix
before release or before the dependent feature ships; **minor** = correct but fragile/inefficient.

| id | Sev | File | Finding | Recommendation / owner |
|---|---|---|---|---|
| AR-001 | major | `src/server/db/shell-queries.ts:20` (`getFavoriteProjects`) | Favorites are filtered by `trashed_at` only; no permission filter. Because favorites are not deleted when access is lost, the sidebar can keep showing the title of a project the user may no longer read. The file's own comment acknowledges the pending permission engine. | Builder-projects must route favorites through the access set (`accessibleProjectIds`) before the shell ships; add a privacy test. Add-on/architecture docs already state "favorites never grant access". |
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

## 5. Not verified yet (pending — will be re-reviewed)

| Area | Files expected | Why it matters |
|---|---|---|
| Domain services (`projects`, `workflow`, `permissions`, `trash`, `audit`, `search`, `inbox`, `users`, `settings`, `dashboard`) | `src/server/domain/**` | Every §6 rule lives here; nothing to review at R1 |
| Route handlers / API contract | `src/app/api/**` | Auth/CSRF/error shape/permission filtering at boundary |
| Pages and views (project page, Inbox, search/trash, dashboard, profile/settings/users) | `src/app/**`, `src/components/**` | UI rules, no business logic in components, Viewer read-only rendering |
| Migrations beyond 001, seed/reset scripts | `src/server/db/migrations/*`, `scripts/**` | Seed must match build-spec §10; reset safety |
| Deployment | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, README, `/healthz`, PWA manifest/SW | AR-004/AR-005 depend on this |
| Scheduler/purge | `instrumentation.ts`, `scripts/purge.ts`, `domain/trash.ts` | Purge semantics; AR-007 |
| Tests | `tests/**` | Evidence for every §6 rule; currently absent |
| Add-on end-to-end | none (by design) | Registry contract only; no add-on flow expected in MVP |
| Avatar upload | `/api/me/avatar` + storage helper | Magic-byte validation, path traversal, 2 MB limit |
| Search UI | `/search`, Trash tab | Permission filtering + trash exclusion at the boundary |

## 6. Update log

- **R1 (2026-11-19):** foundation layer partial review. 19 findings (0 blockers, 8 major, 11 minor),
  contract review of `src/server/addons/*`, doc corrections applied. Foundation was still writing
  the app shell when this round closed; no domain, API, tests or deployment existed. R2 will review
  the completed foundation plus the projects/settings domains as they land, and will re-check every
  finding above plus the "not verified" list.
