# Kapo design coverage review

The November 17 review below reflects the earlier design. The current iteration defers Assignee across all screens and dashboard customization. See [design-handoff.md](design-handoff.md) for current scope and frame references.

Reviewed 17 November 2026 against [product.md](product.md), the decisions in this conversation, and Penpot **Kapo → New Design**. This records interface coverage; it does not establish that server behavior has been implemented or verified.

## Design coverage

| Area | Designed examples and location |
|:--|:--|
| Project structure and Activity | Root and project pages share the same structure. Activity follows children on desktop/mobile in both appearances, including collapsed desktop navigation. Separate Activity-only screens were removed. No-children examples retain Add child project and Activity without an empty collection or selector. |
| Collection views | Page 07 shows Kanban, Card, recursive Tree and checklist List using the same fixture. Tree includes a nested descendant and selection controls; List checks only the finish status. The compact selector shares the child toolbar. Mobile Kanban reveals the next column. |
| Inbox | Existing presentation is retained as Card view. Readiness, missing required fields, inline editing, Open and release are distinct. Pulled projects remain visible in place. Empty and custom-start-status Ready examples demonstrate that the destination is not hard-coded to To do. |
| Permissions | Page 08 includes membership roles, inherited/custom access and a private project. Page 09 includes descendant-restriction acknowledgement, effective-last-Admin rejection naming affected projects, inaccessible assignee and unavailable-project feedback. Page 07 includes desktop/mobile Viewer examples. |
| Workflows and moves | Ordered child-status editor with independent start/finish controls; explicit in-use status mapping; move destination and old-to-new mapping; cycle rejection and validation feedback. Unchanged descendants retain their statuses. |
| Trash and restoration | Page 10 includes Trash, empty Trash and a read-only trashed project. Per-project deadlines, same-action descendants and separately trashed descendants are distinguished. Page 09 includes restore-time status mapping and trash confirmation. No purge-history event is introduced. |
| Archive | Show archived is in project overflow and remains a global per-user preference. Archived examples use subdued surfaces, dashed borders and an explicit Archived label with readable text. Profile no longer contains the control. |
| Search | Page 10 includes results, direct-access context without an inaccessible ancestor, empty query, no results, retry and archived results. Initial snippets match Title; deferred custom fields are not depicted as available. Trash remains separate. |
| Property and layout editing | Labeled text/password, number and dropdown controls plus checkbox/radio options. Basic settings cover visibility, ordering, main/sidebar placement, child placement/template inheritance, enabled/default views and compact Assignee presentation. No freeform builder. |
| Assignee | Separate project and application areas distinguish project options from application-wide Required, Always on, Available and Unavailable policies. Unavailable presentation explains retained, hidden values. Assignment is optional by default. |
| Dashboard | Page 12 includes default, editor, changed editor, saved customization, all-hidden, widget-error and unavailable-Assignee examples, plus Assigned to me. Desktop/mobile and dark examples use the four reviewed widget types. Original Home examples were updated. |
| Accounts | Page 11 includes first-install Create account, sign-in and Admin add/edit-user forms. Existing profile/password pages remain. First install creates an Admin; later creation belongs to user management. Last-application-Admin feedback is included. No email recovery delivery is promised. |
| Capture and feedback | Root versus child title-only capture, empty Inbox, save/retry, connection failure, permission loss and read-only feedback. Installation guidance describes the browser/PWA route without promising offline editing. |

## Dashboard review

[dashboard.md](dashboard.md) was drafted before dashboard design and reviewed by a separate agent. The accepted MVP is Inbox preview, Assigned to me, Recent changes and a quiet completed-last-week count. Customization supports one of each type, visibility, ordering, Save/Cancel and restore defaults. Favorites duplication, free positioning/resizing, query builders, shared dashboards, charts and engagement scoring were rejected.

The saved example moves Assigned to me first and hides Recent changes. Unavailable Assignee preserves the preference without exposing stored project values.

## Consistency and reusable assets

- Canonical expanded/collapsed desktop navigation, mobile navigation, account menu/identity, logo variants and actor avatars remain reusable components. Settings and Users live in the bottom account menu for application Admins.
- New fields, controls, action buttons, notices, project cards, dashboard widgets, overflow menus and capture panels use library assets. Activity rows and actor avatars are shared assets. Page composition uses flex layout.
- New interfaces use semantic light/dark color tokens, neutral input surfaces and content-appropriate widths. Labels share their row. Dark input borders have a separate token. Explicit dark examples cover collections, workflow/membership, account creation and dashboard content alongside existing dark screens.
- Original project-detail placeholder prose was replaced with core properties rather than introducing Description.
- Main backgrounds follow frame height; screen frames contain drawing at their edges. Mobile Kanban deliberately clips its horizontal collection viewport.

## Verification and practical limits

Rendered samples inspected during this work include workflow forms, account creation, last-Admin feedback, dashboard editing, archived cards and dark mobile Kanban. The review corrected duplicate headings, alignment, actor-color overrides, history fixtures and frame/background sizing. This is sampled visual review, not an exhaustive device or accessibility test.

Representative same-page prototype transitions include collection switching, archive visibility, capture, dashboard editing/saving and acknowledgement states. Feature pages are separate: cross-page destinations do not form a fully connected application prototype. Text entry, dragging, persistence and authorization remain specifications rather than working application behavior. Resizing, keyboard navigation, screen readers and every permission/state combination require implementation verification.

## Decisions to settle before implementation

1. **Completed last week:** define distinct-project counting and reopening/recompletion behavior. The display remains a simple previous-calendar-week summary.
2. **Viewer personal settings:** define which personal dashboard/profile preferences an application Viewer may change under the application-wide read-only rule, without granting project-editing rights.

Server-side subtree validation, effective Admin safety, permission-filtered queries/history, atomic Inbox/status changes, concurrency, immutable history, retention scheduling, extension isolation, deployment and migrations require implementation tests. Screen examples do not prove these invariants.

Descriptions, tags, custom fields, Portfolio, backups, native apps and elaborate dashboard tooling remain outside initial scope.
