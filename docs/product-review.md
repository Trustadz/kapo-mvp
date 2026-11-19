# Kapo MVP — product owner acceptance review

**Reviewer:** product owner · **Date:** 19 November 2026 · **Scope:** MVP acceptance against
`product.md`, with the locked decisions in `docs/build-spec.md` §1 and §6 as the binding contract
(`docs/build-spec.md` wins where it records a decision).

**Verdict: DONE.**

**Sign-off round complete (19 Nov 2026, frozen tree): no blockers, no open majors, add-on guide
signed off.** The acceptance round's two implementation gaps (P1 workflow same-name replacement
500; P2 per-view property slots) and the documentation gap (P3 add-on guide) are fixed and
re-verified; the minor issues m1–m3, m5–m9 are fixed and m4 is accepted. Evidence: 167/167
acceptance checks, 26/26 sign-off checks, 12/12 add-on contract checks, the former P1 repro now
returns 200, and the design-review majors F01–F07 were re-checked on the frozen build. Details in
§7; the acceptance-round findings below are kept for traceability with their closing status.

The MVP is product-ready: every acceptance scenario in `product.md` §12 behaves as specified, the
product philosophy holds (calm, no engagement pressure, frictionless capture, understandable
permissions, small footprint) and the deferred scope is genuinely absent rather than teased.

| Gate | Result |
| --- | --- |
| `product.md` §12 scenarios (capture, refine, organize, move, privacy, remove, activity) | PASS (167 acceptance checks re-run on the frozen tree) |
| Status/priority semantics, move remapping, permissions, trash/restore/purge, audit scope, search, dashboard, viewer read-only | PASS |
| Product philosophy and tone | PASS — no engagement pressure, urgency, scores, streaks or dark patterns found |
| Cut scope respected (Assignee, Completed-last-week, query builder, free positioning, descriptions/tags/custom fields) | PASS — absent from schema, UI, defaults and API |
| Known deviations (Tree multiselect, Inbox readiness labels, Members copy) | Tree multiselect and Members copy **resolved and re-verified**; Inbox readiness accepted as an MVP limitation (m4) |
| Sign-off round (P1/P2/P3 + minors + design majors re-check) | **PASS** — 26/26 sign-off checks; P1 repro now 200; P2 implemented and rendered in all four views; P3 corrections verified; F01–F07 re-checked |
| Automated suite | `npm test`: 22 files / 284 tests pass (green at review time) |
| Add-on developer guide (`docs/add-ons.md`) | **SIGNED OFF** — all seven factual corrections applied and verified; extension promises align with `product.md` §7 and invent no scope. No remaining condition |
| Build under review | Frozen tree; isolated production build of the frozen source for destructive verification, and the deployed `:3400` production build (BUILD_ID 15:23) probed for the final features (per-view property slots, Members privacy copy, bulk move, in-shell error boundary). Deployed build matches the frozen tree |

---

## 1. How acceptance was exercised

- **Deployed app:** `http://127.0.0.1:3400` (production build, seeded data, BUILD_ID 15:23 on the
  frozen tree; health 200). Final-feature probes on the deployed build: per-view Layout controls,
  Members privacy copy, bulk-move API branch and the compiled in-shell error state.
- **Independent acceptance harness:** a second production server on `:3402` built from the frozen
  source with an isolated `./data/review.db`, so destructive scenarios (privacy, cascade, trash,
  purge, workflow edits, induced error states) never touched the demo database. The 167-check
  harness, the P1 repro and the 26-check sign-off suite were re-run against this frozen build.
- **Accounts:** `tristan` (Admin), `maya` (User), `jules` (User), `alex` (Viewer); password
  `kapo1234`.
- **Evidence:** 167 API/DB acceptance checks (all passing on the frozen tree), 26 sign-off checks
  (P1/P2/F06/minor copy), 12 add-on contract checks, 5 new-account/permission checks, UI flows
  driven with Playwright, and 60 screenshots under `docs/screenshots/product/` (sign-off round:
  70–84).
- **Not in this review:** visual fidelity/dark-mode/responsive polish (designer's
  `docs/design-review-app.md`) and the automated e2e suite (tester). Docker image build/run was not
  executed; the Compose file, Dockerfile, manifest and README were inspected.

### Acceptance scenarios (`product.md` §12)

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Capture: global quick-add creates a Root child with parent start status + Inbox label; arbitrary nesting | **PASS** | Capture as Maya returns 201, start status `To do`, `inbox=1`, reporter=Maya, appended last; 3-level capture passes; title required (422) |
| 2 | Refine: release keeps start status and removes Inbox; status change also exits Inbox with no extra confirmation; released item stays visible and Pulled until leaving Inbox | **PASS** | Release clears `inbox`, status unchanged, `project.inbox_released` audited; status change clears `inbox` with only a status event; Pulled badge retained ([08](screenshots/product/08-inbox-tristan.png), [50](screenshots/product/50-inbox-pulled.png)) |
| 3 | Organize: cross-column Kanban drag changes status only; within-column reorder changes shared sibling order | **PASS** | Cross-column PATCH keeps priority and leaves other sibling priorities byte-identical; reorder produces contiguous 0-based shared order; Kanban UI routes drops to the same endpoints ([03](screenshots/product/03-project-kanban-tristan.png)) |
| 4 | Move: always confirmation + explicit status mapping; bulk move maps every old status in use; descendants keep statuses; add-on data preserved; cycles/destination permission rejected | **PASS** | Missing mapping → `mapping_required` even when names match; mapped move keeps descendant statuses and `addon_data`; cycle and unauthorized destination rejected; Tree bulk move of two projects with two distinct statuses finished through the UI ([51](screenshots/product/51-move-dialog.png), [63](screenshots/product/63-tree-multiselect-toolbar.png), [64](screenshots/product/64-bulk-move-dialog.png), [65](screenshots/product/65-after-bulk-move.png)) |
| 5 | Privacy: private from application Admins; parent reduction cascades over descendant grants after acknowledgement; increases do not propagate; whole-subtree last-Admin validation | **PASS** | App Admin gets 404 on a private project (read, mutate, trash, search, Inbox); reduction without ack → `acknowledgement_required`, with ack rewrites descendant admin rows; re-granting parent leaves descendant at inherited `user`, not `admin`; last-Admin rejection names projects (including a Root-level cascade that would strand two private projects); new accounts receive the Root User/Viewer grant and can open Root |
| 6 | Remove: subtree hidden; read-only in Trash; each newly trashed project own 30-day deadline; already-trashed keeps its deadline; restore only same action; purge creates no audit event | **PASS** | Parent trash hides subtree; same-action rows share action/deadline; separately trashed grandchild keeps its own; read-only 409; restore returns only same-action rows; re-trash gets a new deadline; search/FTS excludes trash; purge removes project + own history + FTS row with no purge event; Edit appears in immediate parent log only ([53](screenshots/product/53-trash-tab.png), [54](screenshots/product/54-trashed-project-readonly.png)) |
| 7 | Activity: actor, action, exact timestamp, previous/new values; parent logs only child create/trash; Root shows the same history with no status event; newest first | **PASS** | Creation/rename/status events carry old/new values and timestamps; child rename does not appear in parent log; child create/trash do; Root history contains no `project.status_changed`; paging works; DB rejects UPDATE on `audit_events` |

### Additional behaviour checked

| Area | Result | Evidence |
| --- | --- | --- |
| Search | PASS | Prefix match, title-as-heading + match context, inactive/inaccessible titles never returned, malformed input handled, archived follows per-user Show archived, Trash separate |
| Dashboard | PASS | Default Inbox + Recent changes (no Completed last week); custom order/visibility persist per user; hiding all shows empty state + Edit action ([55](screenshots/product/55-dashboard-empty.png)); widget error is local with Retry and other widget keeps rendering ([60](screenshots/product/60-widget-error-retry.png)); unknown/absent widget rejected; Inbox total equals permission-filtered Inbox; Recent never exposes inaccessible titles |
| Viewer read-only | PASS | 403 on capture/edit/release/trash/move/members/settings/workflow; Viewer can edit own profile/appearance/dashboard and keep favorites; Viewer read-only even when a User project role is granted; cannot read Settings/Users; Inbox cards show no release action |
| Root invariants | PASS | Root has no parent/status; cannot be archived, trashed, moved or given a status; application Admin administers Root but cannot bypass other projects' access |
| New accounts | PASS | Admin-created User gets explicit Root `user` grant; Viewer gets `viewer`; can open Root and capture (users domain owns this, matching `product.md` §2) |
| Favorites | PASS | Personal, appear in sidebar, disappear without access, cannot grant access to inaccessible projects |
| Landing page | PASS | Can be set to Home, Root or an accessible project; resolves correctly |
| Workflow editing | PASS except one defect | Explicit remap required for live children; exactly one Start/Finish enforced; trashed children defer mapping and restore requires a chosen status — see issue **P1** for same-name replacement |
| Layout inheritance | PASS (project page) | Main/sidebar field order + child-template inheritance works; child can override; child placement above/below; empty template rejected — see issue **P2** for per-view property slots |
| Application settings | PASS | Admin only; views can be disabled (at least one must remain); default account role; fixed 30-day retention; 403 for non-Admins |
| Deployment footprint | PASS (inspection) | One Compose service, one volume, non-root user, healthcheck, automatic purge at start + every 6 h, PWA manifest/offline page, no external SaaS, README documents HTTPS via reverse proxy |

---

## 2. Issues found in the acceptance round — all closed in the sign-off round

> **Status:** P1 and P2 are **resolved** and verified (§7); P3 is **resolved** and the add-on guide
> is signed off; m1–m3 and m5–m9 are **fixed**; m4 is **accepted**. No blockers remain. The original
> findings are retained for traceability.


### P1 — MAJOR (RESOLVED): replacing an in-use workflow status with a new status of the same name returned HTTP 500

**Product rule violated:** `product.md` §4 *Editing workflows*: “Removing or replacing an in-use
status requires explicit remapping for affected children; identical status names do not imply
automatic equivalence.” The operation is valid, and different names succeed; the identical-name
case crashes the server transaction.

**Reproduce (API, current build):**
1. Sign in as `tristan`; create project `P` under Root and child `C` under `P`; move `C` to `P`’s
   `Done` status.
2. `PUT /api/projects/<P>/workflow` with
   `{"statuses":[{"id":"<to-do-id>","name":"To do","isStart":true},{"name":"Done","isFinish":true}],"mapping":{"<old-done-id>":"<to-do-id>"}}`
   (i.e. delete the in-use `Done` row, add a new `Done`, and map the child explicitly).
3. **Actual:** `500 {"error":{"code":"internal","message":"Something went wrong. Try again."}}`,
   server log `SQLITE_CONSTRAINT_UNIQUE statuses.parent_id, statuses.name`.
   **Expected:** 200, child remapped to `To do`, workflow kept.
4. Control: the same request with a different new name (`Finished`) succeeds and remaps the child.

**Reproduce (UI):** Project settings → Workflow → delete an in-use status → Add status with the
same name → set Start/Finish → choose the mapping → Save workflow → generic error notice.

**Cause (for the builder):** `src/server/domain/workflow.ts` inserts/preserves all new/updated
statuses before it renames removed statuses to their retired labels, so the new row collides with
the old row on `UNIQUE(parent_id, name)`. Retire removed rows (or apply a two-phase temporary name)
before inserting replacements.

**Impact:** workflow editing is an MVP deliverable (`product.md` §11) and an admin-reachable path;
no data loss, and a rename-first workaround existed, which is why this was major rather than a
blocker.

**Closed in sign-off round:** `workflow.ts` now renames removed rows to their retired labels *before*
keeping/inserting final rows (two-phase names). The exact repro returns 200, the child is remapped,
and the audit event carries `{fromId,toId}`. Verified in §7.

### P2 — MAJOR (RESOLVED): per-view “property slots” from the MVP scope were not implemented

**Product rule violated:** `product.md` §5: “Each view supplies configurable property slots and an
ordering of displayed fields. Project-level view settings control what appears and where…” and
§5 Tree: “Configurable columns include core and add-on fields”; `product.md` §11 lists “inherited
layouts and view property slots” in the initial deliverable.

**Actual:** the Layout tab and `PUT /api/projects/:id/settings` configure only the **project page**
(`main`/`sidebar` field lists, `layout_template`, child position, enabled/default views, hidden
statuses). The four collection views render a fixed field set — Kanban: title + Inbox/Archived;
Card: title, status, Open; Tree: select, title, status; List: title, status, Open — with no project
or view setting to choose/order fields ([13](screenshots/product/13-settings-layout-tristan.png),
[05](screenshots/product/05-project-list-tristan.png), [06](screenshots/product/06-project-card-tristan.png)).
`src/app/api/projects/[id]/settings/route.ts` (`SETTING_KEYS`) has no per-view field key.

**Reproduce:** Project settings → Layout: there is no per-view property configuration; the only
field lists are “Main area” and “Properties sidebar”. Send a `view_fields` style key to the settings
API: it is ignored/rejected rather than stored.

**Closed in sign-off round:** option (a) was implemented minimally — `settings.view_fields` per
view (ordered core keys `status,parent,reporter,priority,created,id`), validation/rejection of
unknown or malformed entries, merge-preserving updates, a “View properties” block in the Layout tab
for all four views, and rendering in Kanban/Card/Tree/List. The UI states that only core fields are
configurable and add-on field slots stay deferred with the add-on registry. Verified in §7
([74](screenshots/product/74-layout-view-properties.png), [75–78](screenshots/product/78-view-fields-list.png)).

### P3 — MAJOR (RESOLVED): `docs/add-ons.md` contained stale/inaccurate claims about core behaviour

The guide’s **contract** and scope discipline are sound (see §5), but it is not yet accurate enough
to hand to an add-on developer. Required corrections (architect owns the file; no app-code change
needed):

1. **§4.2 “MVP status” (and the code snippet):** it says “no core code calls `beforeLeaveInbox` or
   `validate` today”. This is no longer true: `src/server/domain/addon-hooks.ts`
   (`assertInboxExitAllowed`) is called from Inbox release, project status change, reorder, single
   move and bulk move, and workflow remap. It invokes **both** `beforeLeaveInbox` and `validate`,
   and reads mode from the `addons` table with **default `'optional'`** because the registry↔table
   sync (§3.4) is still FORWARD — so a `required` add-on will **not** block until that sync exists.
   Rewrite the paragraph to describe this real state and correct the snippet’s “FORWARD until the
   projects domain lands” wording.
2. **§4.2 pipeline:** the guide says `validate` runs on every value save and `beforeLeaveInbox` on
   exit only; the implementation currently runs `validate` on Inbox exit too. Either document the
   actual order or have core stop calling `validate` at exit.
3. **§9 dashboard editor / §13 preference table:** remove the “Current-MVP gap: `parseDashboard`
   drops unknown ids”. `src/lib/types.ts#parseDashboard` now preserves unknown ids and order, and
   the write path accepts them; the editor/renderer filters to known ids. Replace with the real
   behaviour and keep the forward-compat rule.
4. **§9 last bullet and §13 “Registration” row:** “Core dashboard widgets (Inbox, Recent changes)
   use the same registry shape internally; reintroducing [Completed last week] is one core
   definition plus a default-order entry” is not true today. `src/server/domain/dashboard.ts`
   hard-codes `inbox`/`recent`, `DASHBOARD_WIDGETS` is a fixed tuple, `AddonDashboardWidget` has no
   consumer, and `/api/dashboard?widget=` rejects any non-registered id. State that the add-on
   dashboard-widget surface (and the Completed-last-week return) needs a small generic core bridge
   (payload builder + editor/renderer entry + default order) — no schema migration, but not
   registration-only.
5. **§13 counting dependency:** the note that the MVP logs only status **names** is stale. Status
   audit events now store names plus `detail` JSON `{fromId,toId}` (AR-033 resolved), so the stated
   prerequisite for reliable counting is satisfied. Keep the counting-semantics rules.
6. **§8:** `searchBodyFromAddonValues` exists in `src/server/db/search.ts` but has **no caller yet**
   — all current indexing paths pass an empty body. Mark the indexing/reindex wiring FORWARD rather
   than “rebuild path already implemented”.
7. **Small contract-accuracy items:** §3 table for `user` fields says only “must not define static
   options”; the registry also rejects `optionsSource` (as §4 already says). §7’s “Tree/List are
   read-only in MVP” is misleading for the core views (Tree status and List checkbox are editable
   by writers); clarify it applies to add-on compact renderers/slots, which do not exist yet.

**Closed in sign-off round:** the architect applied all seven corrections (wired gate and both hooks,
mode-sync limitation, `parseDashboard` preservation, non-registry-backed core widgets + generic bridge
needed, status-id audit detail satisfied, search body unwired, user-field/Compact-renderer wording);
`architecture.md` was largely synced as well. Re-read and verified against code (§7). The add-on
guide is **signed off** — see §5 and §7.

### Minor issues (fix if cheap; none blocks acceptance)

**Sign-off status:** m1, m2, m3, m5, m6, m7, m8 and m9 are **fixed and re-checked**; m4 remains
**accepted** as an MVP limitation. (m9’s project Card view now shows “Release to …” for Inbox items.)

| ID | Issue | Rule / recommendation | Evidence |
| --- | --- | --- | --- |
| m1 | **FIXED** — Inbox release button reads “Move to To do” (status name interpolated into a sentence) | `product.md` §4 says the action is labelled with the parent’s start status; readable copy matters. Use “Release to To do” (quoted status) or “Release”, with the status as subtext. Same for card menus “Move to <status>”. | [08](screenshots/product/08-inbox-tristan.png) |
| m2 | **FIXED** — Application settings note said “Required properties are checked when projects leave Inbox.” | Misleading in this iteration: there are no add-on fields or add-on modes (`product.md` §4 “no add-on fields to complete”; registry empty). Remove the note until Required add-ons ship, or label it as a future add-on rule. | [16](screenshots/product/16-app-settings-tristan.png) |
| m3 | **FIXED** — Application Viewer was shown the global capture field/mobile Add button, which always failed | `product.md` §2/§6: Viewer is read-only; offering a dead-end primary action hurts “frictionless” feel. Disable with a one-line reason (“Viewers can browse only”) or hide it for Viewers. | [61](screenshots/product/61-viewer-capture-attempt.png) |
| m4 | Inbox readiness labels are uniform: dashboard Inbox preview always says “Ready to do”, Inbox page shows no readiness label at all | Accepted for this iteration: `product.md` §4 states there are no add-on fields to complete and build-spec §12 ships no add-ons, so readiness cannot vary. Revisit when Required add-ons land (dashboard.md D1’s ready/missing distinction). | [01](screenshots/product/01-home-tristan.png) |
| m5 | **FIXED** — Search title match rendered “Match in Title: <full title>”, duplicating the heading | `product.md` §8 asks for a contextual snippet showing where the match occurred; acceptable, but “Title match” or a bounded excerpt reads better. | [09](screenshots/product/09-search-tristan.png) |
| m6 | **FIXED** — Activity priority copy showed numeric positions | `product.md` §3 defines priority as a calculated relative ordering, not an editable numeric field; the wording is fine for audit but can read like a scored field. Consider “Moved earlier/later”. | [07](screenshots/product/07-project-activity-tristan.png) |
| m7 | **FIXED** — Members hint read “Changing a parent also restricts descendants…” | Reads as if editing the parent project; intended meaning is “Reducing or removing a role here also restricts descendants…”. Current build’s per-row copy is now clear (“Explicit grant · User”, “Inherit parent permissions”). | [11](screenshots/product/11-settings-members-tristan.png) |
| m8 | **FIXED** — action label now reads “Add child project” | Keep one label; Penpot/design review decides exact wording. | [03](screenshots/product/03-project-kanban-tristan.png) |
| m9 | **FIXED** — Card view in a project collection now shows “Release to <status>” for Inbox items | `product.md` §5 Card: “Readiness and release actions appear for Inbox projects.” Clarify whether the global Inbox’s Card presentation satisfies this or wire the same release action into project Card view. | [06](screenshots/product/06-project-card-tristan.png) |

### Known deviations — acceptance judgement

| Deviation | Judgement |
| --- | --- |
| Tree view had no multiselect checkboxes (spec calls it a multiselect table; §4 describes moving several projects) | **RESOLVED.** Current build has a select column/select-all, a selection toolbar (Bulk move / Bulk trash / Clear), and a bulk-move dialog that requires mapping for every distinct old status. Verified end-to-end by moving two children with two different old statuses; Viewer sees no checkbox column (read-only). Backend `moveProjects`/`trashProjects` batch paths already existed. No acceptance issue ([63](screenshots/product/63-tree-multiselect-toolbar.png), [64](screenshots/product/64-bulk-move-dialog.png), [65](screenshots/product/65-after-bulk-move.png)). |
| Inbox readiness labels are uniform | **ACCEPTED (minor, m4).** No add-on fields exist in this iteration, so all captures are trivially ready; a uniform label is honest. Revisit when Required add-ons ship. |
| Project settings “Members” copy said “Custom access (User)” while the mode selected was “Inherited from parent” | **RESOLVED.** Current build reads “Explicit grant · User / Viewer / Admin”, “Inherit parent permissions”, “Custom access — Only the selected members below can open this project, even application Admins”, and shows inherited roles separately. Re-verified on the rebuilt `:3400`. No acceptance issue. |

---

## 3. Product philosophy assessment

**Verdict: PASS.** The app reads like a household tool, not an enterprise tracker.

- **Calm tone, no engagement pressure.** Copy is short and human (“Review captured projects and
  move them into work.”, “Break this work down into smaller projects.”, “Your Inbox is empty.”).
  There are no scores, streaks, badges for activity, leaderboards, progress rings, unread counters,
  notification prompts, “you’re on a roll” nudges or artificial urgency. Dashboard is a quiet Inbox
  preview + Recent changes; history is descriptive, not gamified. `manifest.webmanifest` lists the
  harmless PWA category “productivity”; it is not a metric surface.
- **No dark patterns.** No retention pressure, no confirm-shaming, no pre-checked marketing, no
  hidden destructive defaults. Destructive/transition flows (trash, archive, move, permission
  reduction) require explicit confirmation; the cascade acknowledgement names what will be
  restricted before writing; “Show archived” is a personal visibility toggle, not a nag.
- **Frictionless capture.** One always-visible field, Enter creates and clears the field while
  keeping focus, with a status line (“Added … to Inbox”). No required fields beyond the title; no
  modal on desktop; mobile uses a single Add sheet. Verified as Admin and User; deeper capture
  works without hierarchy friction.
- **Understandable permissions.** Two access modes with plain-language descriptions
  (Inherit/Custom), per-account explicit grants, a “Make private” action, cascade warning, and
  last-Admin rejection that names the projects at risk. Application Admin is clearly separated from
  project access and cannot bypass a private project. A Viewer sees no editing controls on projects;
  the remaining dead-end is the global capture field (m3).
- **Small footprint.** Single Next.js process, one SQLite file + uploads on one volume, one Compose
  service, automatic startup/6-hourly trash purge, PWA installability, no external SaaS. README
  documents backup (volume), HTTPS reverse proxy, and the no-multi-replica constraint. Matches the
  “small operational footprint” principle.
- **No corporate/Jira drift.** Neutral workflow names (To do / In progress / Done, editable),
  no epics/sprints/story points/assignees/backlogs/query builders/reports. “Activity”, “Members”,
  “Favorites”, “Trash” are household-scale concepts. No “coming soon” placeholders or disabled
  teaser controls found in the UI; the only forward-looking copy that slips through is the
  add-on “Required properties” note (m2), which should be removed or reworded.

---

## 4. MVP scope compliance

### Initial deliverable (`product.md` §11)

| Item | Status |
| --- | --- |
| Docker Compose deployment, responsive UI, installable PWA | Present (inspection; not executed here) |
| User profiles and roles; project roles; Root; hierarchy; favorites | Present and exercised |
| Capture/Inbox (flag, release, Pulled, skip-Inbox per parent) | Present and exercised |
| Configurable statuses with explicit remapping; sibling priority | Present; one defect P1 in same-name replacement |
| Archive visibility; trash/30-day purge/restore | Present and exercised (automatic purge verified) |
| Append-only history while data exists; parent logs child create/trash only | Present and exercised |
| Kanban, Card, Tree, List | Present, including Tree multiselect/bulk move and per-view property slots for core fields (P2 resolved; add-on field slots deferred) |
| Inherited layouts | Present for project page fields/child placement; per-view property slots now present for core fields (`settings.view_fields`) |
| Modular add-on registry (contracts only, empty) | Present; docs need corrections (P3) |
| Customisable dashboard (inbox preview + recent changes, show/hide/order/Save/Cancel/restore defaults) | Present and exercised; Completed-last-week correctly absent |
| Permission-aware text search + separate Trash | Present and exercised |

### Deferred/cut scope — confirmed absent

| Deferred item | Evidence it is not implemented |
| --- | --- |
| Assignee (field, validation, UI, widget) | No `assignee` in application code/UI; `addons` table empty; guide marks Assignee deferred and uses it only as a contract example |
| “Completed last week” widget | Not in `DASHBOARD_WIDGETS`, defaults, editor or `/api/dashboard`; `/api/dashboard?widget=completed_last_week` → 404 `widget_not_found`; documented as deferred in build-spec §1 and add-ons.md §13 |
| Dashboard query builder / free positioning / resizing / shared dashboards | Editor exposes only visibility + Move up/down + Save/Cancel + Restore defaults; no grid, drag or filter UI |
| Descriptions, tags/labels, custom fields | Not in `projects` schema (only reserved `addon_data` JSON), not in UI; no extra columns |
| Additional views (Portfolio), native apps, kiosk, offline editing, rolling backups | Not present; README explicitly says offline editing is not supported |
| Manual purge UI | Absent by design (automatic only) |

Cut-scope sweep: source/UI/manifest grep for assignee/completed-last-week/sprint/epic/streak/
leaderboard/query builder/“coming soon” returned only a deliberate comment (“Completed last week is
deliberately not registered”) and PWA `categories` metadata — no user-facing drift.

---

## 5. Add-on developer guide sign-off

**Status: SIGNED OFF (final).** The guide’s product framing is correct and disciplined. All seven
P3 corrections were applied by the architect and re-verified against the frozen code (§7); no
invented scope was found. The condition from the acceptance round is lifted.

| Product §7 promise | Guide treatment | Product verdict |
| --- | --- | --- |
| Four global modes (Required / Always on / Available / Unavailable) | Mode table maps product labels to `AddonMode` values; storage in `addons` table; Required gates Inbox exit, skip-Inbox exemption; Available inheritance/enable rules | **Aligned.** One product-level gap is honestly flagged: project-level “required” is not yet representable in the storage contract (§2.3) — acceptable FORWARD item; must be added centrally, not hacked into add-on settings |
| Project settings and inheritance | `projects.settings.addons[id] = { enabled, inheritFromParent, settings }`; merge/preserve unknown keys; data never inherited, configuration is; disabling hides, never deletes | **Aligned** as a storage contract; the resolution helper is correctly labelled FORWARD and the mode-sync limitation is documented |
| Field renderers | One `compactRenderer` key + `AddonCompactProps` contract (no fetch, null-safe, one line, tokens, fallback); page main/sidebar slots and settings panel contracts documented FORWARD with a generic core change | **Aligned**; the one-key limitation and per-view renderer gap are disclosed with a central-change recommendation, not per-add-on hacks |
| Search exposure | `searchFields` (text/longtext only), indexed only while available, reindex triggers, permission filtering, no snippets from hidden values; `searchBodyFromAddonValues` builder exists but has no caller | **Aligned**; the guide now states the current unwired state accurately and lists the generic wiring the first add-on needs |
| Dashboard widgets | `AddonDashboardWidget`/`AddonWidgetItem`, read-only `AddonWidgetContext` with `visibleProjectIds`, one instance, preference preservation, local error+Retry, no new top-level route, item-only rendering | **Aligned.** The guide now correctly states core widgets are not registry-backed, lists the small generic core bridge required (payload dispatch + editor/renderer entry + default order), and keeps the read-only-context/privacy invariants |
| Data survives disabling | Retention matrix (unavailable / project-disabled / ancestor stops inheriting / unregistered / moved / trashed / purged) and no-delete rules; purge is the only deletion | **Aligned.** Clearly marked as contract not yet enforced by code because no add-on endpoints/UI ship this iteration; acceptable per build-spec §12 |
| Failure isolation / invariants | Add-ons cannot approve operations, change roles/status/parent/priority, suppress audit, widen visibility, or write outside their namespace; throwing hooks isolated; core invariants win | **Aligned** with product §7/§9 |
| No scope invention | Assignee is explicitly deferred and used only as the contract exercise; Completed last week documented as deferred with a schema-free reintroduction path; the missing “Assigned to me” filtered-collection link is flagged to the product owner rather than invented | **Aligned.** Product-owner decision recorded here: no filtered-collection route is added for MVP; linking item rows only is correct |

**Add-on guide conditions:** none remaining — P3 corrections 1–7 were applied and verified (§7).
The guide is signed off for product alignment. §12.6’s “flagged for the product owner” is hereby
answered: do not build a filtered-collection route in this iteration; keep item links only; add the
route only when the Assignee add-on itself is scoped. The guide’s honest FORWARD gaps
(project-level `required`, resolution helper, per-view renderer keys, search/widget wiring) are
acceptable contract-first items for this iteration, not scope inventions.

### Cross-document accuracy note (architect) — residual minor item

The R5 sync fixed most of `docs/architecture.md` (wired gate in rule 6, R16/R20/R21 resolved,
dashboard/audit/search wording). Three stale spots remained at the frozen tree and should be
corrected in a final sync pass: §6.2 still says `users.createUser`/`updateUser` do not write the Root
grant (they now do — verified in the new-account check), and R22 (“GET reads mutate via
`ensureWorkflow`”) and R23 (“accounts created through `/users` get no Root row”) remain in the risk
table despite being fixed. These are documentation-only discrepancies; `architecture-review.md` is a
point-in-time review log and may stay historical if clearly labelled. They do **not** block product
acceptance or the add-on guide sign-off, which is source-of-truth checked against code.

---

## 6. Residual risks and verification notes

- **Build/tree currency.** The tree is frozen. The deployed `:3400` production build (BUILD_ID 15:23)
  was probed for the final features and matches the frozen tree; destructive verification ran
  against an isolated production build of the same source with a separate database. The acceptance
  harness lives in `data/review/*.mjs` plus `check-addons.ts` (review workspace, not shipped).
- **E2E/automated suite.** `npm test` was green at final review (284 tests); the Playwright e2e
  suite (tester’s task) was not used as acceptance evidence here.
- **Visual/design review** is the designer’s deliverable; this review re-checked the design-review
  majors (F01–F07) that affect acceptance and confirmed them on the frozen build, but full visual
  fidelity/dark-mode/responsive sign-off remains `docs/design-review-app.md`.
- **No open blockers or majors.** Remaining non-blocking notes: m4 accepted; the new
  `view_fields` option list includes `priority`, rendered as “Priority: N” (derived/read-only — fine,
  but “Position” may read better and it should stay out of any future scoring surface); the
  `architecture.md` residual stale lines noted in §5 are documentation-only; Docker image build/run
  was inspected, not executed.
- **Verdict: DONE.** No open condition on the product or the add-on guide.

---

## 7. Sign-off round (final)

**Round:** 19 November 2026, on the **frozen tree** (last source change 15:20; docs 15:21) and the
deployed production build (`.next` BUILD_ID 15:23, `:3400`, health 200). Destructive verification used
an isolated production build of the frozen source with a separate database. **Result: DONE — no
blockers, no open majors, add-on guide signed off.**

### 7.1 P1 — workflow same-name replacement (FIXED)

- The exact acceptance-round repro now returns **200** with `remappedChildren: 1`; the child moves to
  the mapped `To do`, the new same-name `Done` status exists alongside it, and the child’s status
  audit row carries `detail {"fromId": <old Done>, "toId": <To do>}`.
- Fix: removed rows are renamed to their retired labels *before* kept/inserted rows are written
  (two-phase names in `workflow.ts`), so `UNIQUE(parent_id, name)` is never transiently violated.
- The same request with a different new name still works (control), and the full 167-check harness
  passes, including all other workflow/trash/restore cases.

### 7.2 P2 — per-view property slots (IMPLEMENTED, minimal §5/§11 scope)

- `settings.view_fields` holds an ordered core-property list per view
  (`kanban/card/tree/list`), allowed keys `status, parent, reporter, priority, created, id`.
- Verified API behaviour: set for all four views → 200 and exact round-trip; partial update merges
  and preserves other views; unknown key (`title`) → 422 with a field error; non-array list → 422;
  non-object payload → 422; duplicate keys de-duplicated; persisted inside project settings JSON;
  Viewer → 403 ([screenshot 74](screenshots/product/74-layout-view-properties.png)).
- Layout tab renders a “View properties” block for all four views with add/reorder/remove and the
  explicit note that only core fields are configurable in this iteration and add-on field slots are
  deferred with the add-on registry — exactly the minimal product scope.
- Rendering verified in all four views: Kanban “Status: …”, Card “Parent: … · Created: …”,
  Tree “Status: …”, List “Priority: …” ([75](screenshots/product/75-view-fields-kanban.png),
  [76](screenshots/product/76-view-fields-card.png), [77](screenshots/product/77-view-fields-tree.png),
  [78](screenshots/product/78-view-fields-list.png)).
- Still deferred and correctly stated as such: add-on field slots/compact renderers. No scope creep.

### 7.3 P3 — add-on developer guide (CORRECTIONS VERIFIED, CONDITION LIFTED)

Re-read `docs/add-ons.md` against the frozen code; all seven required corrections are present and
accurate:

1. §4.2 now describes the real Inbox-exit gate: `assertInboxExitAllowed` runs **both**
   `beforeLeaveInbox` and `validate` on release/status-change/reorder/move/bulk-move/workflow-remap,
   aggregates issues, and resolves mode from the `addons` table defaulting to `'optional'` until the
   registry↔table sync (§3.4) exists. The “FORWARD until the projects domain lands” wording is gone.
2. The exit pipeline semantics (both hooks, order, non-mode-filtered) are stated explicitly.
3. §9/§13 dashboard preference: “Current-MVP gap” replaced with the implemented behaviour
   (`parseDashboard` preserves unknown ids/order; write path keeps them; editor filters known ids;
   “unavailable widget” row remains with the future bridge).
4. §9/§13 core-widgets: the guide now states core widgets are hard-coded, `DASHBOARD_WIDGETS` is a
   fixed tuple, `AddonDashboardWidget` has no consumer, and the Completed-last-week return needs a
   small generic core bridge (payload dispatch + editor/renderer entry + default order), not
   registration alone.
5. §13 counting dependency marked **satisfied** — status audit events carry names plus
   `detail {fromId,toId}`.
6. §8 records that `searchBodyFromAddonValues` exists but has **no caller**; the add-on indexing/reindex
   wiring is FORWARD and listed step-by-step.
7. `user`-field wording now says neither `options` nor `optionsSource`; the Compact-renderer section no
   longer wrongly calls the core Tree/List read-only and labels per-view keys as a future central
   contract change.

Also verified: the registry/contract section matches the running code (12/12 contract checks — valid
definition registers; duplicate identifier/field keys, invalid identifiers, select without
options, `user` with options/optionsSource and unknown `searchField` are rejected;
`clearAddonsForTests` empties the registry). Scope discipline holds: Assignee is explicitly deferred
and used only as the contract exercise; Completed last week is documented as deferred with a
schema-free-but-core-code reintroduction path; the missing filtered collection is flagged rather than
invented. **The add-on developer guide is signed off.**

`docs/architecture.md` was largely synced in the same pass (wired gate, R16/R20/R21 closed). Three
stale lines remain and are **documentation-only** (not product-blocking): §6.2 and R23 still say new
accounts do not get the Root grant (they do — verified) and R22 still lists GET-path workflow seeding
(removed). Recommend a final sync; `architecture-review.md` may remain a historical log.

### 7.4 Minor issues (all closed except accepted m4)

- **m1** Inbox action now reads “Release to To do” (global Inbox and project Card view); no
  “Move to To do” remains ([81](screenshots/product/81-inbox-release-wording.png)).
- **m2** Application settings note now reads “No add-on fields are required in this release;
  captures can be released straight from Inbox.”
- **m3** Viewer shell replaces the global capture field with a quiet “Viewers can browse only.” hint
  and hides the mobile Add action ([82](screenshots/product/82-viewer-browse-only.png)).
- **m5** Search title matches render “Title match” rather than duplicating the title.
- **m6** Priority audit copy reads “Moved earlier/later among its siblings” instead of raw positions.
- **m7** Members hint now reads “Reducing or removing a role here also restricts descendants…”.
- **m8** Child creation action is “Add child project” (button and dialog).
- **m9** Project Card view shows “Release to <status>” for Inbox items ([76](screenshots/product/76-view-fields-card.png)).
- **m4** Inbox readiness labels remain uniform — accepted (no Required add-on fields exist in this
  release).

### 7.5 Design-review majors re-checked (F01–F07)

The design review reported 7 majors (`docs/design-review-app.md`); the acceptance-relevant ones were
re-checked on the frozen build:

| Finding | Re-check result |
| --- | --- |
| F01 raw lowercase account names | **PASS** — display names are title-cased across sidebar, account menu, Profile, Reporter, Activity, Members and Users; account menu shows “Tristan · Application Admin” ([70](screenshots/product/70-account-menu-display-name.png)) |
| F02 Kanban columns missing the designed panel | **PASS** — column background computes to `--color-surface-alt` (`rgb(247, 246, 242)`), rounded panel with inset cards ([71](screenshots/product/71-kanban-panel-treatment.png)) |
| F03 Members copy contradicts access mode / missing private state | **PASS** — “Inherit parent permissions” + explicit-grant rows, “Private — only selected members” state, “Add member” flow, “Save permissions”; “Make private” hidden on already-private projects ([72](screenshots/product/72-members-inherited.png), [73](screenshots/product/73-members-private.png)) |
| F04 mobile Search/Trash input collapses | **PASS** — mobile input height measures **42px** at 390×844 ([83](screenshots/product/83-mobile-search-input.png)) |
| F05 no in-shell error state | **PASS** — induced error (induced by breaking FTS on the isolated DB only, then restored) renders inside the app shell: sidebar/header/theme intact, “Search is unavailable”, “Your query is preserved…”, Retry and Go to Home ([80](screenshots/product/80-in-shell-error-state.png)) |
| F06 Trash ignores action grouping/actor/deadline | **PASS** — cards group by trash action with “Trashed by <name> · <date>”, “Purge deadline”, expandable “Also trashed by this action: N projects” with per-item deadlines, and a “Trashed separately” badge for separate actions; restore preview lists “Projects that will return (N)” ([79](screenshots/product/79-trash-grouped.png)) |
| F07 low-contrast placeholders | **PASS** — placeholder computes to `--color-muted` (`rgb(101, 120, 107)`), not `soft` |

### 7.6 Final harness and deployed-build verification

- 167/167 acceptance checks re-run on the frozen build: 34 core + 55 privacy/trash/activity +
  63 search/dashboard/viewer/workflow/purge + 10 Root/viewer + 5 new-account.
- 26/26 sign-off checks (P1 repro, view_fields matrix, trash grouping payload/restore, minor copy).
- 12/12 add-on registry contract checks; `npm test` 284/284 pass.
- Deployed `:3400` (BUILD_ID 15:23) probed for final features: Layout “View properties” block,
  “Inherit parent permissions”/“Explicit grant · …” members copy, bulk-move API branch, and the
  compiled in-shell error boundary. Matches the frozen tree.
- Screenshots from this round: `docs/screenshots/product/70-…`–`84-…`.

**Final verdict: DONE.** No open blocker and no open major. The only remaining non-blocking notes are
m4 (accepted), the optional “Priority → Position” view-label wording, and the documentation-only
`architecture.md` residual lines above.
