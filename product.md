# Kapo
## Product & Architecture Specification

**Status:** Working specification · **Version:** 0.1 · **Date:** 17 November 2026

### 1. Purpose and principles

Kapo is a self-hosted household task and project management platform for shared responsibilities and private personal work. Its central principle is **“Everything is a project”**: every item is a project that can contain further projects, with unlimited practical nesting under one system Root project. It borrows workflow clarity from tools such as Jira and Azure DevOps while maintaining a calm, approachable household experience.

The product prioritizes frictionless capture, understandable permissions, flexible organization, and a small operational footprint over enterprise scale or maximum performance. An installation will typically serve approximately ten people; this is a design guideline, not a hard user limit.

### 2. Experience and navigation

- **Home:** A configurable personal dashboard is the default landing page. Users can change their landing page in profile settings, including choosing Root or another project they can access.
- **Root:** A special system project, reachable in navigation, sits above all other projects. It has no parent or status and cannot be moved, archived, or trashed. Application Admins administer Root; all other accounts receive Root's User project role, subject to any application-wide Viewer restriction.
- **Devices:** One responsive web interface supports desktop, phone, tablet, and large tablet. Android and iOS installation via PWA is in scope. Native apps and kiosk mode remain future possibilities; offline operation is not promised.
- **Capture before search:** An always-visible quick-add text field makes new project creation the primary global action. Global capture targets Root; within a project, each view has a direct way to create children. Search is accessible but not the default input.
- **Favorites:** Users can favorite accessible projects from their project pages. The sidebar lists the logged-in user's Favorites; favorites do not grant access and disappear from navigation when access is lost. The account block stays at the bottom of the desktop sidebar and opens the same account menu offered by the avatar in the mobile header. This menu contains Profile, Appearance, Sign out, and, for application Admins, Settings and Users. Desktop navigation supports expanded and collapsed sidebar layouts; icon-only navigation retains accessible labels and tooltips.
- **Visual design:** Use the supplied logo silhouette and its green as the light-theme brand accent, with `#F5F3EC` as the canvas background, neutral input surfaces, restrained colors, generous spacing, readable typography, and minimal visual noise. Form labels align beside their controls on desktop; control widths reflect their expected content rather than automatically filling the page. Reusable controls include text, number, dropdown, radio, and checkbox inputs. Use Material Symbols consistently for icons that help users scan actions and information; retain its Apache 2.0 license when distributing the font. Light and dark appearance modes use the same layouts and semantic design tokens, with readable contrast and a lighter logo color in dark mode. Complex project management capabilities should not feel corporate or administratively heavy. The experience helps people complete their work and leave freely; do not use engagement pressure, artificial urgency, or retention dark patterns.

### 3. Project domain model

Each project has these required core properties: **ID, Title, Reporter, ParentID, Status, Priority, Archived, and Trashed**, except that Root has no ParentID or Status. A permanent ID identifies the project; ParentID establishes its position in an acyclic tree. Reporter defaults to the creating user. The system also maintains supporting metadata such as creator, timestamps, Inbox membership, permissions, workflow settings, layout settings, add-on data, and an audit log.

There is no artificial hierarchy-depth limit. A project's children are full projects with the same capabilities as their parent, including their own workflows, settings, permissions, and child templates. Root is the sole exception as a protected system project.

**Workflow ownership.** Every project other than Root has a status selected from the workflow defined by its *parent*. Each parent may define any number of ordered statuses, but must designate exactly one start status and one finish status. A newly configured workflow defaults to **To do** and **Done**. Status order determines Kanban column order; individual views may hide selected statuses without changing the workflow itself.

**Sibling priority.** Priority is a calculated relative ordering among projects with the same ParentID, across all statuses. It is not an ordinary editable numeric field. Moving a card between Kanban columns changes only status, preserving its priority. Reordering cards within a column changes their position in the shared sibling ordering.

**Project page layouts.** Every project page has a main content area and a right-hand properties sidebar. A parent defines a layout template for its children, specifying which core or add-on fields appear in either region. The child collection spans the full page width below the main content and properties sidebar by default. Project settings can place it above both regions. A compact view selector shares the child collection toolbar; the default view is configured in project settings. Layout and view configuration is rudimentary for MVP: field visibility/order, main/sidebar placement, inheritance, child placement, enabled views, default view and hidden statuses. There is no freeform layout builder. Root and ordinary projects share the same page structure; optional fields are configurable on both, while Root still has no parent or status. A compact project settings button exposes permitted project actions such as Move and Archive, and navigation to a separate project settings page. Project configuration does not open in an overlay. Each add-on has its own settings area. Children inherit that template by default, may override their own layout, and may define a separate template for their children. Add-ons provide their own field renderers and compact representations; neither project pages nor views impose arbitrary limits on how many properties users expose.

### 4. Project lifecycle and workflows

**Quick creation → Inbox → refinement.** Creating a project requires only a title. It immediately receives its ParentID and the parent's start status, and normally enters a separate **Inbox** refinement queue. Inbox is a flag/concept, not a status. Each parent may configure its children to skip Inbox. When Inbox is skipped, all add-on fields are optional even if globally configured as Required; Title remains mandatory. Inbox uses Card view by default.

**Leaving Inbox.** When a Required add-on (for example Assignee) is configured, its fields must validate before the exit; otherwise there is nothing to complete. Each Inbox card shows its parent context, an action labeled with the parent’s start status, and a separate Open action. The release action removes Inbox membership while retaining the start status. Changing to a different status removes Inbox membership in the same operation. A released project stays visible and marked Pulled until the user leaves Inbox. Future required add-on fields can add inline validation before either transition.

**Reparenting.** Users can move a project between parents, including by dragging it in Tree view, with an explicit confirmation modal. The user must explicitly map the moved project's status from its old parent's workflow to a status in the destination parent's workflow—even when status names match. If multiple projects are moved together, every old status in use by those projects must be mapped; all moved projects with the same old status receive the selected new status. Descendants that are not themselves reparented retain their own statuses because their immediate parents have not changed. Reparenting must not produce loops or bypass destination permissions. Add-on values no longer enabled by the new parent are preserved but hidden rather than deleted.

**Editing workflows.** Removing or replacing an in-use status requires explicit remapping for affected children; identical status names do not imply automatic equivalence. Changes must respect read-only trashed projects, with any necessary legacy mapping deferred until restoration rather than silently altering trashed records. If a trashed project's saved status is no longer valid in its parent's workflow, the person restoring it must explicitly choose a valid status before restoration can proceed.

**Archive and restore.** Archiving a parent hides its entire subtree by default without modifying each descendant's individual Archived flag. **Show archived** is a per-user, application-wide visibility setting exposed as a toggle in the project overflow menu rather than profile settings; archived projects use subdued surfaces and muted styling plus an explicit Archived label when it is enabled. Keep text readable; do not rely on opacity alone. Unarchiving a parent reveals descendants according to their own archived states and the active visibility setting.

**Trash and purge.** Trashing a project moves it and its descendants out of normal views and into a dedicated Trash page. Trashed projects are read-only and may be restored. Each project receives its own 30-day purge deadline when it enters Trash. A project already in Trash keeps its existing deadline when an ancestor is trashed later. Restoring a project undoes that trash action: only descendants first trashed by the same action are restored, while descendants already in Trash remain there. If a restored project is trashed again, it receives a new 30-day deadline. Permanent purge removes the project's content and its own history, and is not separately logged.

**Audit history.** Every live project keeps an append-only, immutable history of its own changes, including actor and timestamp. Project pages, including Root, expose an Activity history view with newest changes first. Each event identifies the actor, action, affected field or project, and exact timestamp; field changes show both the previous and new values. Activity always appears at the bottom of the project page, beneath the children when present. When there are no children, hide collection views and their selector while retaining an Add child project action; Activity remains present. History has no edit or delete controls. Parent logs also record child creation and child trashing (logical deletion); they do not duplicate routine edits made inside children. Trashing is auditable; permanent purge is not. History remains access-controlled and is available only while the relevant project exists.

### 5. Collection views

All accessible projects can use any enabled collection view. A project's settings specify a default view, while the last-used view is remembered **per user, per project**. If a view becomes unavailable, Kapo falls back to an enabled default. Views can be registered, enabled, disabled, and extended independently of the core project model; at least one collection view must remain available.

| View | Initial behavior |
|:--|:--|
| **Kanban** | Default view. On narrow screens, horizontally scrollable columns reveal part of the next column to indicate more content. Shows immediate children as cards in columns ordered by the parent's workflow. Cards can expose configured add-on properties. Across-column dragging changes status only; within-column dragging changes sibling priority. Individual statuses can be hidden by view settings. |
| **Card** | Vertical project cards matching the Inbox presentation, with parent context, configurable compact fields, inline inputs and Open. Readiness and release actions appear for Inbox projects. |
| **Tree** | Expandable, multiselect table displaying recursively nested descendants. Configurable columns include core and add-on fields. Dragging onto a new parent initiates confirmation and explicit status remapping. Available for Inbox and project collections. |
| **List** | Simple checklist of immediate children. Only the parent's finish status counts as complete; other statuses display an empty checkmark. Checking an item selects the finish status; unchecking selects the start status, subject to normal Inbox rules. Additional properties may be shown if configured. |

Each view supplies configurable property slots and an ordering of displayed fields. Project-level view settings control what appears and where; Kapo must not impose an arbitrary property-count limit, even when a resulting card or row becomes very tall. Future views, including a portfolio/drilldown hybrid, are outside the initial scope.

### 6. Users, roles, and privacy

Accounts have **username, email, password, profile picture**, an application role, and project-level role assignments. Profiles allow users to change their passwords. A first-install Create account screen creates the first application Admin; subsequent account creation is available to application Admins through user management. Email is stored but does not imply email delivery or verification. There is no fixed account limit. At least one application Admin and one project Admin per project are mandatory at all times. Sign-in may alternatively use PocketID/OIDC: an existing account is matched by email, a first-time SSO user becomes a Viewer, and an operator may disable password sign-in. When the account has no picture, PocketID's profile picture is imported.

| Level | Role | Effective access |
|:--|:--|:--|
| Application | **Admin** | Manages application configuration and users; administers Root; **cannot** bypass another project's access controls. |
| Application | **User** | Uses projects according to assigned project permissions; no application administration. |
| Application | **Viewer** | Read-only application-wide, even where a project role would otherwise permit editing. |
| Project | **Admin** | Manages project content, workflow, layout, membership, and settings. |
| Project | **User** | Reads, edits, and creates children within authorized projects. |
| Project | **Viewer** | Read-only access to authorized projects. |

**Inheritance and restriction.** New projects initially inherit the parent's permissions; the creator is additionally made Admin. Project permissions can be overridden, including removing all other users to make a project private. Application settings support default account roles, but these never grant automatic visibility to private projects. When a user's permission on a parent is **reduced or removed**, the restriction cascades through descendants, even over existing grants, after an acknowledgement modal. Increases do **not** automatically propagate. Explicit descendant permissions may subsequently be reassigned. Before applying a permission change, validate the entire affected subtree. If any project would lose its last Admin, reject the whole operation and identify the affected projects so another Admin can be established first.

A user may hold direct permission to a descendant without permission to its parent. A direct authorized link can open that descendant, and permission-filtered search may find it, but navigation through inaccessible ancestors will not expose it. Every query, dashboard widget, add-on, view, and API operation must enforce server-side authorization without leaking inaccessible project titles, counts, or contents.

### 7. Add-ons and extensibility

Kapo should be a **modular monolith**, not a collection of independently hosted microservices. Stable extension contracts allow future add-ons and views to be introduced or removed without entangling them with the core lifecycle and permission model. Add-ons own their data schemas, project settings, validation rules, and presentations, while the core owns identity, hierarchy, workflows, access control, auditing, and lifecycle transitions.

Application Admins configure each add-on in one of four global modes:

| Mode | Availability and validation |
|:--|:--|
| **Required** | Present on every project; must be completed before a normal Inbox project exits refinement. Projects configured to skip Inbox are exempt. |
| **Always on** | Present on every project, but its fields are optional. |
| **Available** | Projects may explicitly enable it, with project- and child-inheritance settings. |
| **Unavailable** | Cannot be enabled or used by projects. |

Add-ons may define one or many fields and their own settings. Project settings may override allowed behavior and define how settings flow to children. Add-ons can contribute project-page components, sidebar properties, compact collection-view renderers, searchable text fields, and dashboard widgets or filtered data sources. Data should survive an add-on becoming hidden, unavailable, or inapplicable to a particular parent; disabling functionality should not silently delete its stored values.

**Reference add-on: Assignee (shipped).** Assignee is the worked example that validates the extension contracts; its definition lives in `src/server/addons/assignee/`. Every project may have **zero or one assignee, never multiple**. Assignee is optional by default; application and project settings can change its availability and validation requirements. The Assignee add-on supplies its field, validation/inheritance hooks as applicable, editable project-page UI, optional card/table/list rendering, and an **Assigned to me** dashboard widget or filtered view. Its purpose is to validate the extension contracts, not establish special-case logic in the core.

Descriptions, labels/tags, custom fields (boolean, numeric, short text), global tag-sharing controls, and other additional add-ons are architectural examples only—not initial features.

### 8. Dashboard and search

**Dashboard.** The default homepage is user-customizable, with movable/configurable widgets in the spirit of a Home Assistant dashboard. The initial widget set includes recent changes, an Inbox preview with total count, and a simple completed-last-week summary. The main navigation opens a global Inbox containing all Inbox projects visible to the user and showing each project's parent context; a project-specific Inbox is not part of the initial scope. Future dashboard integrations may expose add-on fields and filtered collections. MVP customization is limited to one instance of each core widget, show/hide, ordering with Move up/down, Save/Cancel and restore defaults; responsive layout determines columns. No freeform resizing, query builder, shared dashboard or engagement scoring is included. See dashboard.md for the independently reviewed MVP rationale. Widget content and counts honor the logged-in user's permissions.

**Search.** A separate, intentionally secondary search page provides straightforward full-text search over project titles and all available text-input properties, including text exposed by add-ons. Each result uses the project title as its heading and shows a contextual snippet indicating where the match occurred. Search spans all authorized projects (including independently accessible descendants) without disclosing inaccessible content. Archived and trashed items follow their relevant visibility rules; Trash is not mixed into ordinary results.

### 9. Architectural boundaries

The specification does not prescribe a programming language, framework, or database engine. The implementation should nevertheless maintain clear internal responsibilities:

- **Responsive client / PWA:** Navigation, capture, project pages, dashboard, collection views, and user interactions; the server remains authoritative for validation and permissions.
- **Core domain services:** Project tree integrity, status workflows and remapping, Inbox transitions, ordering, archive/trash lifecycle, audit recording, and business invariants.
- **Identity and authorization:** Authentication, application roles, project permissions, downward restriction propagation, and authorization-aware querying.
- **Extension registry:** Add-on and view registration, typed field definitions, settings/inheritance, validation hooks, UI placement contracts, search exposure, and dashboard contributions.
- **Persistence and search:** Durable structured storage, append-only audit data while projects exist, text search, schema evolution, and migration support.
- **Background maintenance:** Local scheduled cleanup for 30-day trash retention, with room for later rolling backups.

Important invariants—including exactly one start/finish status per workflow, no parent cycles, at least one Admin per project, no unauthorized reads, and explicit status remapping—are enforced on the server rather than only through interface checks. Extension hooks must not bypass these invariants.

### 10. Deployment and non-functional constraints

Kapo must start through a simple **Docker Compose** deployment. Required application services, assets, and runtime dependencies are included in its Docker image(s); persistent state lives in explicitly mounted local volumes. No external SaaS is required for normal use. Deployment should minimize operational burden, number of containers, resource usage, and configuration steps. Updates require controlled data migrations and preserve user data and add-on values.

Security defaults include salted password hashing, authenticated sessions, server-side authorization, safe file handling for profile pictures, and a documented route to HTTPS (typically via a reverse proxy). Optional PocketID/OIDC SSO uses authorization-code + PKCE and issues the same database-backed sessions. PWA installation on iOS/Android must be considered in deployment guidance. Responsiveness, data integrity, privacy, accessibility, and predictable behavior matter more than high-throughput optimization. The architecture should be compatible with future rolling backup management but need not implement it initially.

### 11. Initial scope and deferred work

**Initial deliverable:** Docker Compose deployment; responsive UI and installable PWA; user profiles and roles; personal Favorites; Root and project hierarchy; capture/Inbox; configurable statuses and explicit remapping; sibling priority; archive/trash/30-day purge; append-only history while data exists; Kanban, Card, Tree, and List; inherited layouts and view property slots; modular add-on registry; customizable dashboard; and permission-aware text search.

**Future, not required initially:** More add-ons (descriptions, tags, custom fields), additional collection views such as Portfolio, rolling backup management, native mobile apps, kiosk mode, and more advanced dashboard widgets. These are extension points to preserve, not features to build prematurely.

### 12. Key acceptance scenarios

1. **Capture:** A member types “Renovate basement” into global quick-add. A Root child is immediately created with its start status and Inbox label; deeper children can be added without hierarchy restrictions.
2. **Refine:** A member opens a captured project or moves it out of Inbox to its parent’s start status. Any Required add-on (for example Assignee) validates before the exit; when none is required there is nothing to complete. Changing from the start status also removes Inbox membership, without another confirmation. A pulled project remains visible with a Pulled indicator until the user leaves Inbox.
3. **Organize:** Moving a card between Kanban columns changes status but not sibling priority. Reordering within a column changes the shared sibling order.
4. **Move:** Moving a project to a different parent always prompts for confirmation and explicit destination-status mapping. Inapplicable future add-on data is retained but hidden.
5. **Privacy:** A project can be private from application Admins. Reducing a member's role on a parent restricts descendants after acknowledgement, without spreading subsequent permission increases.
6. **Remove:** Trashing a parent hides its subtree, leaves items read-only in Trash, and records the logical deletion in its parent's log. Each newly trashed project receives its own 30-day purge deadline; descendants already in Trash keep theirs. Purge creates no permanent-deletion audit event.

7. **Activity:** A member opens a project's Activity view and sees who created it and who changed its title or status, with timestamps and previous/new values. Creating or trashing a child appears in its parent's history; routine edits within that child do not. Root exposes the same history view without a project-status event.
