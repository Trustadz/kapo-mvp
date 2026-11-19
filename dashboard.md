# Kapo MVP dashboard

Independent MVP value review completed · 17 November 2026

## Purpose

Help a household member find useful work, refine captured ideas, and see relevant changes without turning Home into another project-management task. Show only authorized projects and counts. No streaks, rankings, urgency tricks, productivity scores, or engagement prompts.

## Candidates to review

| ID | Idea | User value | Proposed MVP boundary |
|:--|:--|:--|:--|
| D1 | Inbox preview | Find captures that need refinement and distinguish ready items from missing required fields. | Three recent items, parent context, readiness and Open inbox. No embedded bulk-refinement editor. |
| D2 | Assigned to me | Find open projects assigned to the current user. | Five items with parent and status, ordered by existing sibling priority within parent groups. Open the project or the full filtered collection. No new global priority score. Hide when Assignee is unavailable. |
| D3 | Recent changes | Understand relevant shared-household changes. | Five authorized events with actor, project and timestamp. Open project Activity. No comments, reactions, notifications inbox or unread counters. |
| D4 | Completed last week | Provide the simple summary required by product.md. | A quiet count for the previous calendar week, honoring permissions. No graphs, goals, comparison or score. |
| D5 | Favorites widget | Reach familiar projects. | Possibly redundant with the sidebar. Candidate for rejection; mobile account/navigation could instead expose Favorites directly. |
| D6 | Add/remove/reorder widgets | Let each person keep Home useful. | Edit dashboard opens one fixed-width configuration panel with visibility checkboxes and Move up/down buttons. Dragging is optional and never the only method. Save/Cancel, restore defaults. Four registered widget types only. |
| D7 | Widget sizes, columns and free positioning | Flexible visual customization. | Candidate for rejection: responsive fixed layout is adequate; no grid editor or resize handles for MVP. |
| D8 | Widget query builder | Arbitrary filters and project scopes. | Candidate for rejection: use predefined sources for MVP. Preserve the extension contract, not a generic dashboard query language. |
| D9 | Shared dashboards / templates | Coordinate household priorities. | Candidate for rejection: personal Home plus shared projects already covers initial needs. |
| D10 | Trends, charts, streaks, leaderboards | Potential motivation. | Reject: limited household decision value, extra implementation cost, and possible pressure to remain engaged. |

## Independent value review

The separate review agent evaluated the candidates against `product.md`, the user's household/MVP goal, and the cost of creating another configuration system. The original review kept four predefined widget types and one simple personal editing flow. The current scope below defers the Assignee widget.

| ID | Decision | Reason and final boundary |
|:--|:--|:--|
| D1 | Keep | Inbox refinement is a core job and a preview makes the next action visible. Show at most three items, the authorized total, parent context and readiness. Open the existing Inbox for refinement; do not duplicate its inline editor or bulk actions on Home. |
| D2 | Keep, simplify | This is the most direct answer to “what is mine?” and proves the Assignee extension has value. Show at most five open assigned projects, parent context and status, with an Inbox indicator where relevant. Group by parent and use existing sibling order inside each group; use parent-title order for the groups rather than inventing a global priority. Link to the full Assigned to me collection. No per-widget filters or sorting controls. Hide this widget when Assignee is globally Unavailable. |
| D3 | Keep, simplify | Shared work needs context about what changed. Show five recent authorized events with actor, project and timestamp, linked to the relevant project's Activity. Do not add an unread system, reactions, notification delivery, live feed controls or a second Activity editor. |
| D4 | Keep, simplify | This is explicitly part of the initial widget set. Keep it as a small, quiet completed-last-week count. It should not occupy a large chart/card or become a productivity score. Do not add comparisons, goals or a drill-down reporting screen for MVP. The precise completion-count semantics still need to be defined before implementation. |
| D5 | Reject | A Favorites widget duplicates navigation and creates another place to maintain the same shortcuts. Mobile access to Favorites should be solved in navigation rather than used as a reason to add a dashboard widget. |
| D6 | Keep, simplify | Personal relevance matters, and the user explicitly requested dashboard customization. One ordered list of the four widget types is enough: show/hide checkboxes, Move up/down, Save and Cancel. At most one instance of each type. Use a responsive editing screen/state, not a drag grid or desktop-only fixed-width panel. Restore defaults may reset this small list; no presets/template picker. Dragging is unnecessary for MVP because buttons support desktop, touch and keyboard. |
| D7 | Reject | Free positioning, columns and resize handles solve presentation preferences rather than a household task. Use a fixed responsive layout and the saved widget reading order. |
| D8 | Reject | A generic query builder creates a new product surface, validation rules and configuration burden. Four predefined data sources cover the initial needs. Preserve add-on integration contracts without exposing a dashboard query language. |
| D9 | Reject | Shared projects already coordinate the household. Shared dashboards, permissions and templates add another collaboration model without a clear unmet MVP job. |
| D10 | Reject | These introduce pressure, interpretation and implementation work without helping someone capture, refine or finish a household project. No trends, leaderboards, streaks or engagement rewards. |

## Final MVP recommendation

Assignee is deferred by the product owner. D2 is retained above as review history and excluded from this iteration, including the dashboard editor.

The design may now proceed with **Inbox preview, Recent changes and a compact Completed last week summary**, plus the simple show/hide/reorder editing state. Rejected candidates must not appear as implemented MVP options, disabled teasers or “coming soon” placeholders.

Do not duplicate Inbox and assignment totals as separate metric tiles; keep those counts in the useful collection previews. The completed summary is the only standalone number. Global capture remains outside dashboard customization.

## Default and behavior

Use the widgets in this default order: Inbox, Recent changes, Completed last week. Responsive layout determines columns; saved order becomes the mobile reading order. Capture remains a global action rather than another configurable widget.

Customization only changes the current user's Home. Widgets link to existing project, Inbox, Activity and filtered collection screens. Empty states are brief and actionable; no fake examples in an empty installation. A widget error has a local Retry action and does not disable the rest of Home. Access loss removes inaccessible content and counts.

Users may hide all widgets. In that case Home shows a simple empty state and an Edit dashboard action; do not require an otherwise unwanted widget. Available widgets that the user hides remain selectable in editing. A globally unavailable add-on widget is shown as unavailable in the editor with a brief explanation, without exposing old stored project values; it is absent from the normal dashboard. Preserve the user's preference so availability changes do not silently rewrite their layout.

The application-wide archived visibility preference applies to dashboard collections as elsewhere. Trashed projects never appear in ordinary dashboard previews.

## Decisions still required for implementation

- **Completed last week:** specify whether the count represents distinct projects entering their parent's finish status, and what reopening/recompletion means. “Previous calendar week” is a reasonable display boundary, but do not silently turn this small summary into event analytics. The design can show the existing label/count while this calculation is settled.
- **Personal preferences for Viewers:** `product.md` describes application Viewer as read-only application-wide. Clarify that role's ability to change its own dashboard/preferences alongside profile/password behavior; do not infer extra project editing rights from customization.

These questions do not justify adding configuration controls to the MVP dashboard.

## Review gate outcome

Passed for design with the constraints above. D1, D3, D4 and the simplified D6 define the current dashboard. D2 remains deferred. D5 and D7–D10 are rejected from MVP. This is an independent value review, not a claim that the underlying widget queries or authorization have been implemented or verified.
