# Kapo add-on platform — target model, locked decisions, and work plan

**Status:** Decisions locked 2026-11-22. The platform described here is **not implemented**; this
document is the target contract for future add-on work.
**Audience:** the product owner and the builders implementing add-ons.
**Relationship to other documents:** [add-ons.md](add-ons.md) documents the **currently shipped**
field-only add-on contract. This document describes the **target** platform and the decisions that
govern it. Where the two disagree about future work, this document wins until `add-ons.md` is
rewritten. For the target add-on model, it also supersedes the older target-model wording in
[build-spec.md](build-spec.md) §12; the build spec still wins on core invariants and non-add-on rules.
[architecture.md](architecture.md) and [build-spec.md](build-spec.md) §12 need a sync pass when the
platform lands.

---

## 1. Product frame

Kapo is **Jira for households**: issue tracking with hierarchy, statuses, priorities, discussion,
links, labels, attachments and automation, sized for a household that manages projects together.
Add-ons extend issue tracking. Kapo is not a wiki, inventory system, meal planner or household
operations suite; those are explicitly out of scope.

Add-ons are **first-party modules compiled into Kapo**. They are not runtime-downloaded plugins.
A marketplace is not planned; it would be a separate project if demand ever justified it.

---

## 2. Locked decisions

These decisions are binding for the platform work. Design details below may change; the decisions
may not be reopened without an explicit product decision.

| ID | Decision | Status | Consequence |
|---|---|---|---|
| **D1** | **Description and comments are canonical core records.** Core owns identity, project, author, timestamps, permissions, retention, ordering and fallback. Add-ons provide the editing and rendering experience. | Locked | Content survives add-on removal or replacement. Cross-provider behaviour (permissions, mentions, search, notifications) stays consistent. |
| **D2** | **The rich format is add-on-owned; plaintext is the mandatory fallback.** Core stores the record plus `body`, a versioned `format` id, a `plaintext` projection and optional metadata. Core does not parse or normalise `body`. | Locked | Providers have full formatting freedom. If a provider is removed or a format becomes unsupported, the content remains readable as plaintext. A migration tool is built only if and when needed. |
| **D3** | **Both static developer-defined fields and dynamic user-defined fields are supported.** Static fields live in add-on code. Dynamic fields are created by the custom-fields add-on and stored as data. Both use the same core input types, property slots and per-project required rules. | Locked | The property pipeline must accept a *field source*, not only a static field array. External-sync add-ons can be developer-defined and updated by a scheduled job. |
| **D4** | **Scheduler and job registration are prerequisites for planned issues.** Schedule semantics (calendar vs on-completion), the job actor, missed-run behaviour and the management surface are decided during scheduler work, not here. | Locked prerequisite; details deferred | Planned issues cannot start before the scheduler exists. The add-on owns its management page; core owns the clock and run log. |
| **D5** | **Tag scope and categorisation are deferred to the tags work.** The model must allow an app-level tag vocabulary plus per-project assignments, but global vs per-project vocabulary and category semantics are not locked yet. | Deferred | Tags are not a blocker for the platform spine. Do not invent a tag schema in core before this decision. |
| **D6** | **Add-ons are first-party and compiled in.** A static client registry and build-time server registry; no runtime download, sandbox or marketplace. | Locked | The client registry, bundling, permissions and versioning stay tractable. A marketplace would be a separate, much larger project. |
| **D7** | **Typed capability slots, not a generic add-on panel.** Core owns named project-page regions; add-ons declare what they provide and fill the matching slot. Add-ons do not get an arbitrary box on the project details page. | Locked | The project page stays coherent. A property add-on contributes fields to the existing property areas; a comments add-on fills the comments region; an icon add-on fills the identity slot. |
| **D8** | **Add-on management lives in Settings; per-project add-on configuration lives in project settings.** Neither is the project details page. | Locked | App-level management pages are hosted under Settings → Add-ons. Project-level toggles and required-field settings live in the project's settings tabs. |
| **D9** | **Two axes: scope and mode.** Scope is `system` or `project`. Mode is `Required`, `Enabled` or `Disabled`. Per-project required fields are configured in project settings. | Locked | System add-ons have no per-project toggle. Project add-ons can be enabled/disabled per project and can mark individual fields required per project. Add-on "Required" is availability; field "required" is separate. |
| **D10** | **Linked issues are core.** Admins manage the link types; the project page shows links on both sides. | Locked | Link types, links, permissions, cycle checks and purge cleanup are core work, independent of the add-on platform. |
| **D11** | **Attachments and basic input types are core primitives.** Add-ons build on them. | Locked | One file/image storage service, one set of permissions, one backup/cleanup path. Inline images, galleries and file fields all reuse it. |
| **D12** | **People/access policy is a separate issue.** This document does not define assignment or mention rules. | Locked deferral | Do not bake a people policy into comments, tags or the platform. The separate issue decides it. |

### Note on “canonical content”

Earlier discussion said “canonical content” for descriptions and comments. The locked definition is
**canonical record, not canonical format**. Core owns the durable record and the plaintext fallback;
the active add-on owns the rich representation. This is what makes D1 and D2 compatible: you can swap
the WYSIWYG and Markdown experiences without moving the comment or description record, but you accept
that a new provider may not understand the old rich format and shows plaintext until a migration tool
is written.

---

## 3. Capability model

An add-on declares one or more **capabilities**. A capability maps to a **slot** that core owns.
Core validates the declaration and composes the providers.

| Capability | The add-on provides | Core owns | Multiplicity | Data owner |
|---|---|---|---|---|
| **Property** | Field definitions, editors, compact/detail renderers | Property slots in Details, Properties and view fields; validation; required rules | Many | Add-on data or core field storage |
| **Custom fields** | User-defined field definitions and management UI; a dynamic field source | Basic input types; layout/view integration; per-project required | One dynamic field provider (recommended) | Add-on shared definitions + project values |
| **Description provider** | Body editor, renderer, format handling | Description record, project slot, permissions, plaintext fallback | One active provider | Core record; add-on representation |
| **Comments provider** | Composer, thread renderer, format handling | Comment records, project slot, permissions, ordering, plaintext fallback | One active provider | Core record; add-on representation |
| **Tags** | Tag vocabulary, categories, assignment UI, chips | Property and filter contracts; filter bar | One provider (practical) | Add-on shared vocabulary + project assignments |
| **Project icon provider** | Icon set, picker, icon renderer | Icon slots in sidebar, cards, tree; fallback | One active provider | Add-on shared icon set + project choice |
| **Attachments** | File/image field usage, galleries, inline images | File/image input type and storage service | Many | Core file service; references in add-on values |
| **Filter** | Filter controls, options, predicate | Filter bar integration, counts, empty states | Many | Add-on |
| **Dashboard widget** | Widget component and loader | Dashboard grid, preferences, error isolation | Many | Add-on |
| **Automation** | Scheduled job handler and management page | Scheduler, service actor, run log | Many | Add-on shared data |

### 3.1 Project page regions

Core owns the fixed regions of a project page. Add-ons fill typed regions; they do not add arbitrary
boxes.

- **Identity/header** — title, status, priority, project icon (add-on provider when active).
- **Description** — a core region rendered by the active description provider.
- **Properties** — Details, the Properties sidebar and per-view property slots. Property add-ons
  contribute fields; core decides where properties are allowed to appear.
- **Links** — core, with admin-managed link types.
- **Comments** — a core region rendered by the active comments provider.
- **Activity** — core audit/history.
- **Attachments** — exposed through property fields and inline in description/comments; the storage
  service is core.

### 3.2 Property renderer contexts

A property add-on declares which contexts it supports and supplies a renderer/editor for each:

- compact/card value for Kanban, Card, Tree and List;
- read-only detail/property row;
- editor control;
- optionally a filter or dashboard representation.

Core supplies the slot, permissions and data; the add-on supplies the presentation. The current
single `compactRenderer` string is the seed of this idea, but the target is a real client-side
component registry.

### 3.3 Management surfaces

- **Application settings → Add-ons** — each add-on card can expose a **Manage** page. The add-on
  renders the page; core provides the host, application-Admin gate, layout and error boundary.
- **Project settings → Add-ons** — the add-on can expose a per-project configuration section
  (for example a repeat schedule or custom-field enablement). This is a settings surface, not a
  project-details panel.
- **No project-details add-on panel.** A project page only shows the typed regions in §3.1.

---

## 4. Content envelope for description and comments

This section implements D1 and D2. It is a proposed design that follows from the locked decisions.

### 4.1 The record

Core stores a durable record per description and per comment. A description has one live record per
project; comments have many, ordered by creation time.

| Field | Owner | Purpose |
|---|---|---|
| `id` | Core | Stable identity |
| `project_id` | Core | Project the record belongs to |
| `author_id` | Core | Comment author; description uses the last editor |
| `body` | Provider | The rich content, opaque to core |
| `format` | Provider | Versioned representation id, for example `markdown@1`, `html@1`, `prosemirror@1` |
| `plaintext` | Provider (required on save) | Readable projection used for fallback, search, previews and notifications |
| `metadata` | Provider (optional) | Provider-specific extras; preserved by core |
| `mentions` | Provider (optional, structured) | User ids mentioned in the content, used for notifications and access checks |
| `created_at`, `edited_at`, `deleted_at` | Core | Ordering, editing, retention |
| `attachment_refs` | Provider/Core | References to core attachments used inline or attached |

### 4.2 Responsibilities

**Core:**

- owns the record, author/permissions, project access, ordering, retention and audit;
- stores `body`, `format`, `plaintext`, `metadata`, `mentions` and attachment references unchanged;
- always has a readable fallback: `plaintext`;
- renders the fallback when no active provider supports the stored `format`;
- indexes `plaintext` for search and previews so the index is provider-neutral;
- never renders opaque rich content directly; only the active provider renders it;
- validates that mentioned users can read the project (policy decided in the separate people issue);
- retains records when the provider add-on is disabled or removed;
- warns the Admin before switching away from a provider if stored records use formats the new
  provider does not read.

**Active provider add-on:**

- declares the formats it reads and writes;
- supplies the editor and renderer for those formats;
- sanitises rendered output; core never injects raw provider HTML;
- generates a useful `plaintext` projection and structured `mentions` on every save;
- uses the core file service for inline images and attachments, so references survive a provider
  switch;
- handles any format conversion it claims to support. Core does not convert formats.

### 4.3 Save and switch behaviour

1. The active provider loads the record. If it supports `format`, it edits and renders it; otherwise
   the UI shows read-only plaintext and explains that the current provider cannot edit this format.
2. On save, the provider sends `body`, `format`, `plaintext`, optional `metadata` and `mentions`.
3. Core validates project access, stores the record, and indexes the plaintext.
4. If the active provider is removed or disabled, core continues to show plaintext. Nothing is
   deleted.
5. If the Admin switches providers, the new provider reads each record’s `format`. Records it supports
   are editable; the rest are plaintext-only until a migration tool runs.
6. A migration tool is **not** part of the initial platform work. It is built only when a real switch
   leaves content unreadable and the before/after context is known. The plaintext fallback is what
   makes that safe to defer.

### 4.4 Consequences of the format decision

- Providers may use any rich format, including WYSIWYG HTML or an editor document model.
- Mixed formats can coexist across records. Each record carries its own `format`.
- Search, previews, notifications and the fallback use `plaintext`, not the rich body. Plaintext
  quality therefore matters; providers are responsible for a useful projection.
- Mentions cannot be recovered reliably by parsing opaque content. They must be supplied as structured
  metadata at save time.
- Inline images must use core attachment references. A provider that embeds external image URLs is
  outside the attachment retention and backup guarantees.
- Format-compatibility metadata and the pre-switch warning are required parts of the provider
  contract.

---

## 5. Property sources: static and dynamic

This section implements D3.

### 5.1 Static developer-defined fields

A property add-on declares a fixed field list in code, for example a date field labeled “Warranty
expires” or a text field labeled “Serial number.” Labels, types and keys are developer-defined. Such
an add-on may be manually edited or updated by a scheduled sync job.

**External-sync add-ons** are developer-defined property add-ons that write their values from another
service on a schedule. They need the scheduler, outbound network access, credential/secret storage and
failure isolation. Those are future platform capabilities; the property model must allow them, but
they are not part of the first content-platform slice. Validation hooks stay synchronous and must not
perform network I/O; sync work belongs in a job.

### 5.2 Dynamic user-defined fields

The **custom-fields add-on** lets users define simple fields: title, input type, options, order,
optional grouping. Definitions are data, not code. Values are per project.

The add-on provides a **dynamic field source**. Core asks it for the effective field list for a
project or context, then uses that list for:

- property slots and layout/view selectors;
- validation and rendering;
- per-project required fields;
- filters and search exposure, where supported.

Dynamic fields use generated, stable keys stored with the definition. Their values are namespaced
under the custom-fields add-on, so they cannot collide with developer-defined fields from another
add-on. Users define *simple fields* using core input types; they do not write code or arbitrary
validation.

### 5.3 Composition

Core's property pipeline must compose:

- static field definitions from every property add-on;
- dynamic field definitions from the custom-fields provider;
- core field types and renderers.

Both sources use the same opaque field reference shape (`addon:<identifier>:<fieldKey>`), the same
property slots and the same per-project required rules. Core must not branch on a specific add-on
identifier.

### 5.4 Field rules

- Field keys are permanent. Labels may change.
- A type change requires a migration or a new field; do not silently reinterpret stored values.
- Removing a field from the definition hides it and retains its stored values.
- Deleting a dynamic field definition retains existing values until a documented cleanup; hide rather
  than destroy.
- Requiredness is per project, not baked into the add-on definition.

---

## 6. Scope, modes and required fields

This section implements D9.

### 6.1 Two axes

| Scope | Modes | Per-project behaviour |
|---|---|---|
| **System** — shared data or an app-wide feature | `Required`, `Enabled`, `Disabled` | No per-project toggle. Disabling keeps data. |
| **Project** — a per-project feature or property | `Required`, `Enabled`, `Disabled` globally | Global `Required` forces availability and cannot be disabled per project; global `Enabled` lets projects enable/disable; global `Disabled` hides it. Individual fields can be required per project. |

Add-on **Required** means the add-on is always available and cannot be disabled; it does not mean
every field is required. Field-level requirement is separate. Exclusive providers are normally
`Enabled`, not `Required`; `Required` would prevent switching away from them.

Current modes map as follows: `always` → Enabled (system), `optional` → Enabled (project),
`unavailable` → Disabled, `required` → Required.

### 6.2 Exclusive providers

Description, comments and project icons are **exclusive**: one active provider per capability. The
Admin selects the active provider in application settings. Only one provider per exclusive capability
can be active; other providers may be present but disabled, and activating one prompts the Admin to
deactivate the current provider. Disabling the active provider falls back to plaintext
(description/comments) or the default icon.

The initial platform assumes an **installation-wide** active provider. Per-project providers are
deferred and are not part of the first implementation.

### 6.3 Per-project required fields

Project settings exposes the available property and content fields for that project, with a
“Required before leaving Inbox” toggle per field.

- Stored as field references in project settings, not as add-on identifiers.
- Controlled by a project Admin.
- Applies to the existing Inbox-exit gate alongside global Required modes.
- Copied from the parent at project creation, like other project settings.
- If the field becomes unavailable (add-on disabled, field removed, property not available), the
  setting is preserved but ignored; the settings UI shows a warning rather than blocking the project
  forever.
- Core field keys and add-on field refs are both valid references.
- Requiredness applies to descriptions, properties, tags and dynamic fields where the concept makes
  sense; it does not apply to comments.

---

## 7. What the platform must provide

### 7.1 Work packages

| ID | Work package | Outcome | Depends on |
|---|---|---|---|
| **WP1** | Capability protocol and manifest | Add-ons declare capabilities, formats, static/dynamic field sources, management pages and jobs. Core validates exclusivity, dependencies and compatibility. | This document |
| **WP2** | Client add-on registry and slot host | Add-ons ship client components. Core provides typed props, UI primitives, i18n, error boundaries and slot rendering for properties, description, comments, icons, filters, widgets and management pages. | WP1 |
| **WP3** | Content envelope and core content slots | Description/comment records, permissions, ordering, retention, plaintext fallback, search indexing, mention metadata, fallback rendering, provider compatibility warning. | WP1 |
| **WP4** | Scope, modes, active provider and per-project required | System/project scopes, Required/Enabled/Disabled modes, exclusive-provider selection, project-settings required toggles, mode migration from the current four-mode model. | WP1 |
| **WP5** | Add-on server host | Generic `/api/addons/<identifier>/…` dispatcher with core auth, CSRF, project-access checks, error shape and a scoped context. No per-add-on Next.js routes. | WP1, WP6 |
| **WP6** | Add-on data and migrations | Namespaced app-level and project-level storage, migrations after core migrations, version records, failure isolation, backup/purge integration, retention when disabled. | WP1 |
| **WP7** | Management surfaces | Application-settings management page host and project-settings add-on section host. | WP2, WP5, WP6 |
| **WP8** | File/image service and input type | Upload/download, permissions, size/type limits, image handling, backup, purge cleanup and a reusable file/image field. | D11 |
| **WP9** | Filter and dashboard-widget host | Add-on filter contribution in the filter bar across views; dashboard widget rendering, preference preservation and error isolation. | WP2 |
| **WP10** | Scheduler and jobs | Add-on job registration, run log, actor, idempotency, missed-run policy, timezone handling and a management hook. | WP5, WP6 |
| **WP11** | Core links | Admin-managed link types, project links on both sides, permission-aware picker, cycle checks for blocking types, purge cleanup, audit. | Nothing (independent) |
| **WP12** | Reference add-ons | Description (Markdown, then WYSIWYG), comments (Markdown, then WYSIWYG), tags, project icons, planned issues, custom fields. | Their platform prerequisites |
| **WP13** | Conformance, docs and migration | Per-capability contract tests, provider-swap tests, import-boundary checks, i18n checks, guide/architecture sync, migration from the current add-on model. | Continuous |

### 7.2 Recommended sequence

**Stage 0 — protocol (short, serial).**

- WP1, WP3 schema, WP4 design, WP8 interface, WP10 interface, WP13 test skeleton.
- Agree the provider format declaration and plaintext/mapping contract.
- Agree the capability manifest shape before writing UI.

**Stage 1 — content platform (the first vertical slice).**

- WP2, WP3, WP4, with core-owned description and comment records.
- Markdown description provider, then Markdown comments provider.
- Provider selection, plaintext fallback, unsupported-format warning, permissions, search over
  plaintext, mention metadata, provider-swap tests.
- This proves the capability registry, client slot host, content envelope, fallback and exclusive
  provider selection with the smallest useful surface.
- No add-on-owned storage or generic add-on API is needed for this slice; core owns the records.

**Stage 2 — owned-data platform and property add-ons.**

- WP5, WP6, WP7, WP9, WP8.
- Then tags, project icons, custom fields, and the WYSIWYG description/comments providers with inline
  images.
- Tags wait for the D5 decision; custom fields wait for the dynamic-field definition scope.
- This stage proves shared app-level data, project-level records, management pages, file storage,
  filters and widgets.

**Stage 3 — automation.**

- WP10, then planned issues and external-sync add-ons.
- Schedule semantics, actor and missed-run policy are decided here (D4).

**Parallel — core links.**

- WP11 can start immediately and is independent of the add-on platform.

**Continuous — WP13.**

- Contract tests and documentation stay in the same PRs as the platform work.

### 7.3 First vertical slice — definition of done

A Markdown **Description** add-on proves the platform end to end:

- An Admin can enable and select it as the active description provider.
- A project editor can write, edit and read a description.
- The record stores `body`, `format`, `plaintext`, `metadata`; search and previews use `plaintext`.
- Disabling the provider leaves the content readable as plaintext.
- Switching to a provider that does not support `markdown@1` shows a read-only plaintext fallback and
  a clear warning; switching back restores editing.
- Permissions match project edit/read rules.
- No core module branches on the add-on identifier.
- Contract tests cover save, fallback, switch, permissions, search and missing-provider cases.

The Markdown **Comments** add-on then reuses the same record, slot and provider machinery. WYSIWYG
providers follow once the file/image service exists.

### 7.4 Parallel-work rules

- Do not build tags, icons or custom fields before WP5/WP6. Otherwise each invents its own storage,
  API and management pattern and the core becomes a patchwork.
- Do not build planned issues before WP10.
- Links (WP11) and the file service (WP8) are independent and can run alongside the content platform.
- After WP2/WP3, Markdown and WYSIWYG providers can be developed in parallel as separate add-ons
  because they share the content envelope, not the implementation.
- WP1 must land before parallel client work; otherwise the slot and capability contracts will drift.

---

## 8. Deferred decisions

These are deliberately not locked yet. They block only the listed work.

| Area | Deferred decision | Blocks |
|---|---|---|
| Planned issues | Calendar schedule vs on-completion; job actor; missed-run behaviour; where the recurrence is configured; what a template copies | Planned issues, external-sync jobs |
| Tags | Global vs per-project vocabulary; category model; rename/merge/delete semantics | Tags |
| Dynamic fields | App-level vs per-project definitions; type changes; field deletion/retention; grouping | Custom fields |
| Provider scope | Whether the active description/comments/icon provider can differ per project; default is installation-wide | Provider selection UI |
| Format migration | When to build a migration tool; compatibility warning UX; format registry | Provider switching |
| Search | Whether comments are searchable, or only descriptions and plaintext previews | Search integration |
| Mentions/notifications | In-app only vs external delivery; who can be mentioned | Comments mentions |
| i18n | Per-add-on message catalog format and completeness checks | Client add-on UI |
| Current add-on migration | How Assignee and the current four modes move to the new scope/mode model; schema compatibility | Platform rollout |
| People/access policy | Assignment, mentions, access changes | Separate issue (D12) |

---

## 9. Non-goals

- A generic add-on panel or arbitrary add-on box on the project details page.
- Runtime-installable third-party add-ons or a marketplace (D6).
- Inventory, shopping lists, meal planning, bills/subscriptions, wiki pages or household operations
  features.
- Add-ons adding their own Next.js routes or running their own timers.
- Add-ons altering core tables, permissions, audit, statuses or lifecycle invariants.
- Per-add-on custom permission models.
- Designing the people/access policy here.

---

## 10. Risks and consequences

- **Front-loaded platform work.** No large add-on portfolio until the spine exists. This is the
  deliberate cost of keeping add-ons independent instead of patching core per add-on.
- **Opaque formats can become unreadable.** Plaintext fallback limits the damage; a migration tool is
  the escape hatch. Admins must see a compatibility warning before switching providers.
- **Client add-ons increase bundle and security surface.** First-party-only and a static registry keep
  this tractable; a marketplace would require a sandbox and versioning model.
- **Add-on migrations complicate backups and upgrades.** Namespacing, version records and failure
  isolation are mandatory; an add-on migration failure must disable that add-on, not the application.
- **Two add-on models during the transition.** The current field-only guide and this target document
  will coexist. Documentation must clearly distinguish “shipped” from “target” to avoid contract
  drift.
- **Deferred decisions block specific add-ons.** Tags and planned issues cannot start until their
  decisions are made, even though the platform spine can proceed.

---

## 11. Glossary

- **Capability** — what an add-on provides (property, description provider, comments provider, tags,
  icon provider, filter, widget, automation, custom fields).
- **Slot** — a named core-owned place or structure that a capability fills (description region,
  comments region, identity icon, property area, filter bar, dashboard grid).
- **Provider** — an add-on that fills an exclusive capability slot.
- **Exclusive capability** — one active provider at a time (description, comments, project icon).
- **Additive capability** — many contributors (properties, filters, widgets, automations).
- **Static field source** — developer-defined fields in add-on code.
- **Dynamic field source** — user-defined field definitions stored as data by the custom-fields add-on.
- **Content envelope** — the core record around an add-on-owned body: author, timestamps, format,
  plaintext, metadata, mentions and attachment references.
- **Plaintext fallback** — the readable projection core always retains and can render without the
  provider.
- **Active provider** — the selected provider for an exclusive capability.
- **Scope** — whether an add-on is system-wide or per-project.
- **Mode** — Required, Enabled or Disabled availability.
