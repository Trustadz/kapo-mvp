# Kapo feedback & backlog

The single place for bugs, improvements, feature requests, design feedback and scope decisions.
Everything else in `docs/` records what was built and why; this file records what to do next.

**Snapshot:** app commit `e51564b` · 298 unit/integration tests · 11 Playwright flows · demo on `:3400`
**Triage owner:** lead agent · **Last triaged:** 2026-11-19

---

## 1. How to use

**Fastest path.** Append a row to [§5 Intake](#5-intake) in any wording — no format required. I
normalise it into the register, assign a `K-` id, check it against `product.md`, and propose a
priority.

**Detailed path.** Add a row to [§2 Register](#2-register) with `NEW` as the id, then add a detail
block using the [template](#6-detail-template). Use this for anything with a reproduction.

**Via chat.** Paste notes in a new chat and say “add to the backlog”. Same file, same process.

Rules that keep the register useful:

- Never delete an item — change its status.
- One row per item. Group related symptoms in the detail block, not in five rows.
- Quote a screen, screenshot path, Penpot frame or `product.md` section when you can.
- Changing a locked decision (reintroducing the Completed-last-week widget, changing who may trash)
  is a `decision` item, not a bug. It goes through the product-owner gate.
- Everything is judged against `product.md`, `docs/build-spec.md` and the accepted limitations in
  [§3](#3-deferred--accepted). Out-of-scope items are marked `declined` or `deferred`, never silently dropped.

## 2. Register

Open work only. Sorted by priority, then area. `Size` is a rough S/M/L estimate, not a promise.

| ID | Area | Type | Pri | Status | Size | Title | Source |
|---|---|---|---|---|---|---|---|
| K-001 | design-system | improvement | P2 | triaged | S | Favorites use one generic folder icon; design has per-project icons (`home_repair_service`, `cottage`, `person`) | `docs/design-review-app.md` F16 |
| K-002 | project-settings | improvement | P2 | triaged | S | Members “Add member” shows a disabled account select, a role select and a button when everyone already has a grant; collapse to one note | final UI review |
| K-003 | accessibility | improvement | P2 | triaged | M | Full keyboard + screen-reader + contrast pass; reviews so far were sampled, not exhaustive | `docs/design-review.md` limits |
| K-004 | home | improvement | P3 | triaged | S | Optional: label the `priority` view property as “Position” (PO called it optional) | `docs/product-review.md` sign-off |
| K-005 | trash | feature | P3 | needs-info | M | Manual “Delete permanently now” action; purge is currently automatic-only | `docs/product-review.md`; build-spec §1 |
| K-006 | inbox | improvement | P3 | deferred | M | Distinguish ready vs missing-required captures in the Inbox and widget once an add-on can be Required | `docs/product-review.md` m4 |
| K-007 | addons | feature | P3 | deferred | L | First add-on plumbing bundle: value write endpoint, editor, per-project enablement, registry→`addons` mode sync, purge hooks | `docs/add-ons.md` FORWARD |
| K-008 | addons | feature | P3 | deferred | M | Generic dashboard widget bridge so core and add-on widgets share registration, editor, renderer and default order | `docs/architecture-review.md` AR-056 |
| K-009 | addons | feature | P3 | deferred | M | Index add-on text fields and provide snippets; `searchBodyFromAddonValues` has no caller today | `docs/architecture-review.md` AR-055 |
| K-010 | addons | feature | P3 | deferred | M | Compact renderer registry for Kanban/Card/Tree/List and add-on field slots in per-view properties | `docs/add-ons.md` §7 |
| K-011 | addons | improvement | P3 | deferred | S | Purge cascade for add-on tables and avatar-file cleanup for deleted users | `docs/architecture.md` R6 |
| K-012 | testing | improvement | P3 | planned | M | End-to-end add-on flows once an add-on ships; hooks are contract-tested only today | `docs/architecture.md` §10 |
| K-013 | deployment | improvement | P3 | triaged | S | Short backup/restore note for the SQLite volume (offline copy, restore steps) | product.md §10 |

## 3. Deferred & accepted

Not open work. Keep these here so the same request does not resurface as a “new” idea.

| ID | Item | State | Reason / decision |
|---|---|---|---|
| D-001 | Assignee add-on (field, validation, card/table rendering, “Assigned to me”) | deferred | Deferred by the product owner for this iteration; the guide uses it as the worked example |
| D-002 | “Completed last week” dashboard widget | cut | Counting semantics (distinct projects, reopen/re-complete) still undefined; must return through the widget bridge, not by hard-coding |
| D-003 | Descriptions, labels/tags, custom fields, global tag sharing | out of scope | Explicitly future add-ons in `product.md` §7 |
| D-004 | Portfolio/drilldown view, native apps, kiosk mode, rolling backups | out of scope | `product.md` §11 future work |
| D-005 | Two-widget dashboard, no free positioning, no query builder | accepted | dashboard.md decisions D7–D9 |
| D-006 | Uniform Inbox readiness labels | accepted | No add-on fields exist this iteration, so every capture is trivially ready |
| D-007 | Tablet compositions inferred responsively | accepted | Only 1440 and 390 are designed; breakpoints are an implementation decision |
| D-008 | Automatic-only purge | accepted | Startup + 6-hourly sweep; a manual purge would be new scope (see K-005) |
| D-009 | Add-on field slots in view properties; registry-backed widgets | accepted as forward | No add-on ships; documented FORWARD in `docs/add-ons.md` |

## 4. Add a new item

Append to the intake table below; any wording is fine. Or add a register row with `NEW` and a detail
block.

### 5. Intake

| Date | Area | Screen / route | Note |
|---|---|---|---|
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

### 6. Detail template

```md
#### K-000 — short title

- Type: bug | improvement | feature | design | accessibility | security | performance | docs | decision
- Priority: P0 | P1 | P2 | P3
- Status: new | needs-info | triaged | planned | in-progress | done | declined | deferred
- Area: shell | home | inbox | project | views | project-settings | permissions | workflow | trash |
  search | accounts | dashboard | addons | accessibility | performance | deployment | docs | design-system
- Reported: 2026-11-19 · commit e51564b
- Account / viewport / theme: tristan (Admin) · 1440 · light

**Steps or context**
1. …

**Expected** — what should happen, and where that is specified.

**Actual** — what happens, including the error text or screenshot path.

**Proposal** — the smallest change that would fix or improve it.

**Acceptance** — how we will know it is done.

**References** — `product.md` §…, screenshots, Penpot frame, related ids.
```

## 7. Review coverage checklist

Tick as you go so gaps are visible. Nothing here is a finding by itself.

- [ ] Shell, navigation, capture, account menu, collapsed sidebar
- [ ] Home: default, edit, hidden-all, widget error
- [ ] Root page
- [ ] Project page: header, Details, Properties, Activity
- [ ] Kanban / Card / Tree / List, including Tree selection and bulk actions
- [ ] Inbox, including release and the Pulled state
- [ ] Search: results, empty query, no results, error, archived
- [ ] Trash: grouping, deadlines, read-only project, restore dialog
- [ ] Project settings: General, Workflow, Members, Layout
- [ ] Profile, Application settings, Users
- [ ] Sign-in, first install (`/setup`), password change
- [ ] Dark mode across the main screens
- [ ] Mobile at 390: home, project, inbox, dialogs
- [ ] Fresh install and Docker deployment

## 8. Priority & status definitions

| Priority | Meaning | Response |
|---|---|---|
| P0 | Data loss, security/privacy leak, or a core flow impossible with no workaround | Fix before anything else |
| P1 | Core flow wrong or an MVP acceptance gap; workaround exists | Next batch |
| P2 | Visible polish, friction, or a clear improvement to an existing flow | Batch with related work |
| P3 | Idea, quality-of-life, or forward work that needs a scope decision | Triage, then defer or plan |

| Status | Meaning |
|---|---|
| new | Captured, not looked at |
| needs-info | Cannot reproduce or needs a decision from you |
| triaged | Checked against the spec, priority and area set |
| planned | Accepted for a future batch |
| in-progress | Being worked |
| done | Fixed and verified (add the commit/PR) |
| declined | Out of product scope (reason recorded) |
| deferred | Valid, but intentionally later (see §3) |

## 9. Triage log

| Date | Items | Outcome |
|---|---|---|
|  |  |  |
