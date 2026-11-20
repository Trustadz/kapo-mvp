# Kapo build log

Running log of decisions, agents and verification for the MVP build. Newest entries at the bottom.

## Decisions locked before coding

See `docs/build-spec.md` §1. Summary: full MVP phased; Next.js 16 + TS + SQLite single container;
Penpot wins over `product.md` when they conflict; project page = page 01 composition + page 07
toolbar; "Completed last week" widget cut entirely; Viewers may edit their own profile/password/
appearance/dashboard; tablets inferred responsively; purge automatic only; empty first run with
optional mock seed.

## Phases

| Phase | Owner | Status |
|---|---|---|
| Foundation (scaffold, schema, auth, shell, tokens, seed, Docker) | builder-foundation | complete, verified `78f8cad` |
| Projects, Inbox, views, search, trash | builder-projects | in progress |
| Settings, accounts, profile, dashboard | builder-settings | in progress |
| Automated tests | tester | in progress |
| Architecture docs + add-on guide | architect | docs drafted, review pending |
| Design review | designer | queued |
| Product acceptance | product-owner | queued |

## Verification log

- 2026-11-19: `npm run typecheck` pass; `npm run db:reset` seeds 4 users / 13 projects / 12
  statuses / 15 audit events; add-on registry contracts present; baseline committed.
- Dark tokens fetched from Penpot and matched against `src/styles/tokens.css` exactly.

## Parallel-work safeguards

- Each agent gets its own `DATABASE_PATH`, `NEXT_DIST_DIR` and port (projects 3201, settings 3202,
  tests 3301) so dev servers and builds never share state.
- Disjoint write scopes per `docs/build-spec.md` §11. Cross-scope needs are routed through lead.
- `UNIQUE(parent_id, priority)` and `UNIQUE(parent_id, position)` are immediate; reorders must be
  two-phase (offset then rewrite).

## Architect review round (R4)

- 52 findings recorded in `docs/architecture-review.md`; 1 blocker, 8 major.
- Blocker AR-020 (no purge path in Docker) assigned to builder-foundation as a new
  `src/server/domain/purge.ts` + `src/instrumentation.ts` + script wrapper.
- Projects: read paths made read-only (AR-032/052), workflow remap clears Inbox (AR-036),
  activity title privacy (AR-029/048), status ids in audit (AR-033), domain types moved to
  `src/lib/projects.ts` (AR-028), move destination + last-admin fixes (AR-035/039), shared
  `src/server/api-route.ts` published.
- Settings: adopting the shared route helper; Root grant, dashboard parent sanitisation and
  unknown-widget preservation are the remaining task-3 items.
- Decision AR-045: trash/restore/archive/move require project Admin; app Admin does not bypass.
- Environment note: `/tmp` is ephemeral per bash call; Chromium lives in `data/pw-browsers`.

## Privacy model correction (tester finding)

Pure walk-up inheritance made private projects impossible (a Root User grant leaked into
`Personal`). Locked per-project `settings.access`:
- `inherit` (default): explicit grant, else parent's effective role.
- `custom`: explicit grants only; no walk-up, so private works even against application Admins.
- Root is `custom` (explicit grants + implicit app-Admin Admin); private = custom with only chosen
  users; reduction cascade still overrides custom descendant grants; increases never propagate.

`Personal` is seeded private to admin. Spec §5/§6 updated; builder-projects is implementing the
effective-role logic and the Members "Inherited / Custom / Private" controls.

Also fixed the registry xfail: `user` fields now reject both `options` and `optionsSource`; the
test is a normal pass (22/22 in that file).

## Review round 2

- Tester: 284 tests passing, 0 xfail; Playwright 11/11. Access-mode matrix (17 tests) codifies
  inherit/custom, Root rules, private seed project, cascade and last-admin.
- Designer: `docs/design-review-app.md`, 25 findings (7 major, 18 minor, 0 blockers). Fix batch:
  Kanban column panels, Members copy/private state, mobile Search input height, in-shell error
  state, Trash action grouping, placeholder/contrast, person-name formatting, dialog chrome.
- Product owner: still running.
- Two defects found by the tester fixed en route: dashboard reorder lost per-widget visibility, and
  a hidden custom child's title leaked through a readable parent's Activity snapshot.
- Tree view gained multiselect (select-all + per-row), bulk move with per-status mapping and bulk
  trash in one action; server-enforced Admin requirement.

## Review round 3 — product sign-off

- Product owner: **DONE**, no blockers or open majors. 167/167 acceptance checks, 26/26 sign-off,
  12/12 registry, philosophy PASS. Known deviations resolved: Tree multiselect + bulk actions,
  workflow same-name remap, per-view property slots. Inbox readiness uniform → accepted MVP
  limitation (no Required add-on fields exist).
- Add-on guide condition lifted after the 7 factual corrections and the architecture.md sync.
- Remaining fixes landed: workflow status replacement 500 (two-phase rename), `settings.view_fields`
  for Kanban/Card/Tree/List with Layout-tab UI, Kanban surfaceAlt panels, Members privacy states and
  copy, 42px mobile search input, in-shell error state with Retry, Trash action grouping with
  actor/deadline/restore preview, viewer shell without capture/Add, display names, placeholder and
  muted/warning contrast, dialog chrome, sidebar rhythm, "Add child project", Release wording.
- Known accepted limitation: add-on field slots in view properties and the add-on widget bridge
  remain FORWARD (no add-on ships); documented in add-ons.md.

## Final verification (frozen tree)

- `npx tsc --noEmit --incremental false` → clean.
- `npm test` → 24 files / **298 tests passed**, 0 xfail, 0 skip.
- Playwright e2e → **11/11** (first install, login, capture→Inbox→release, status change, viewer
  read-only, dashboard reorder persistence, trash→restore).
- `npm run build` (clean `.next`) → success.
- Docker: `docker compose build` → image builds; container run with an empty volume → `/healthz`
  200, `/setup` 200 and first-install API reachable, SQLite created in the mounted volume,
  cleanup succeeded.
- Final manual probes: Kanban column `rgb(247,246,242)` radius 12, placeholder `#65786B`,
  subtitle `#5B6D61`, mobile search input 42×358, Viewer capture input count 0 with the
  "Viewers can browse only." hint and no mobile Add, 0 console errors.

## Handover

Run `npm ci && npm run db:reset && npm run build && npm start`. Seeded accounts use password
`kapo1234` (admin Admin, maya/jules Users, alex Viewer). The add-on developer guide is
`docs/add-ons.md`; architecture and review history are in `docs/`.
