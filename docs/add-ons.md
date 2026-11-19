# Building Kapo add-ons

**Audience:** a developer adding a feature to Kapo that is not core project management.
**Status:** MVP ships the add-on **contract** and an **empty registry** — `src/server/addons/types.ts`,
`registry.ts`, `index.ts`, no endpoints, no UI slots, no add-on registered. This guide is the
contract you code against, plus the forward contracts the core must add once, generically, when the
first add-on lands. Sections marked **FORWARD** are not represented in the MVP TypeScript yet;
implementing one is a core contract change (add it to `types.ts`), never an add-on-specific branch.
**Companion documents:** [architecture.md](architecture.md), [build-spec.md](build-spec.md) §5/§6/§12,
[product.md](../product.md) §7.

Precedence: `docs/build-spec.md` wins over this guide where they conflict. `src/server/addons/types.ts`
is the registry source of truth; if this document and the file disagree, the file wins and this
document must be corrected — report the mismatch, never fork the contract.

---

## 1. What an add-on is — and is not

An add-on is a **typed vertical slice**: a definition (fields, validation hooks, search exposure,
compact rendering, dashboard widgets) that the core discovers and renders through generic extension
points. It is a module inside the monolith — not a plugin host, a separately deployed service, or a
runtime download.

| An add-on **is** | An add-on **is not** |
|---|---|
| One or more typed fields stored per project in `projects.addon_data[identifier][fieldKey]` | A change to the `projects`, `statuses`, `project_roles` or `audit_events` schema |
| A definition registered through `registerAddon()` in `src/server/addons/` | A second server, container, background worker, or external SaaS |
| Owner of its own field definitions, validation, search fields, compact renderer and dashboard widgets | Owner of identity, hierarchy, workflows, permissions, audit or lifecycle transitions |
| Able to block an Inbox refinement exit **only** by returning validation issues for its own fields (`beforeLeaveInbox`) | Able to approve/deny an operation, mutate permissions, suppress audit, or bypass last-Admin / cycle / status-mapping invariants |
| Preserved when hidden, disabled or `unavailable` | Allowed to delete stored values when disabled |
| A typed contribution resolved by core at fixed slots | Free-form HTML/script injection, arbitrary writes, or client-side business rules |

Two rules follow and are non-negotiable:

1. **Core invariants are enforced before and outside the add-on boundary.** Hooks are consumers of a
   transaction the core owns; they cannot see or alter the permission decision, target status, audit
   record or trash deadline.
2. **Add-on data outlives add-on availability.** Disabling, making unavailable, removing the code or
   moving a project to a parent where it is inapplicable must never delete values. Only project purge
   deletes data.

The MVP deliberately ships the **contract only**. That means add-on behaviour is verified by
construction and by registry/contract tests, not by an end-to-end add-on flow; the review record in
[architecture-review.md](architecture-review.md) says so explicitly. Do not interpret an empty
registry as "add-ons are not designed" — the storage contract (`addon_data`, `settings.addons`) is
live in the schema, and the types are frozen public API.

---

## 2. The four global modes

Application Admins choose exactly one mode per registered add-on. The mode is application-wide;
projects cannot change the mode. The product labels (product.md §7) and the code values differ —
the mapping is part of the contract:

| Product label | `AddonMode` value | Present on every project | Project may enable/disable | Required before a normal Inbox exit | Values kept when unavailable |
|---|---|---|---|---|---|
| **Required** | `'required'` | Yes (including Root) | No | Yes — `beforeLeaveInbox` issues block the exit | n/a (mode change away keeps values) |
| **Always on** | `'always'` | Yes (including Root) | No | No — fields optional | Yes |
| **Available** | `'optional'` | No — only where enabled per project/inheritance | Yes | Only if the project configuration makes it required (FORWARD, §2.3) | Yes |
| **Unavailable** | `'unavailable'` | No | No | No | Yes — **kept**, hidden from pages, views, search and dashboard |

"Present on every project" means the field slots/renderers are offered for the project even if the
project layout does not display them; layout controls visibility, not existence. Root is subject to
the same modes — a Required add-on renders on Root — but Root never has Inbox membership, so
`beforeLeaveInbox` can never fire there.

Mode is stored in the `addons` table (`mode TEXT CHECK (mode IN ('required','always','optional',
'unavailable'))`, build-spec §5). The table is empty in the MVP; it is synced from the registry at
startup (FORWARD, §3.4) when add-ons ship.

### 2.1 Inheritance to projects and children

The MVP storage contract (build-spec §12, implemented as a reserved JSON shape, not code) is:

```json
{
  "skip_inbox": false,
  "inherit_layout": true,
  "addons": {
    "assignee": {
      "enabled": true,
      "inheritFromParent": true,
      "settings": { "show_avatar": true }
    }
  }
}
```

`projects.settings.addons[identifier]` is keyed by add-on identifier. Reserved keys are `enabled`,
`inheritFromParent` and `settings`; everything inside `settings` belongs to the add-on. Core must
preserve unknown identifiers and unknown setting keys so forward/backward compatibility does not
need migrations.

Mode is global; availability and settings flow down the tree only when the parent says so:

1. `required` / `always`: effectively available on every project (no project enable needed).
   Required validation applies to `required`; `always` is optional.
2. `optional`: walk from the project upwards. `enabled: true` on the project (or on an ancestor that
   has `inheritFromParent: true`) makes it available; an explicit `enabled: false` on the project
   makes it unavailable for that project. `settings` inherit from the nearest ancestor that sets them
   while `inheritFromParent` is true; a child may override.
3. `unavailable`: not available anywhere; values retained, hidden.

Rules:

- **Data is never inherited.** Only configuration is. Each project has its own values in
  `addon_data`; a child never reads the parent's value.
- **Moving a project preserves add-on values**, even when the destination makes the add-on
  inapplicable (build-spec §6.4). Values are hidden, not lost.
- **An ancestor switching the add-on off hides it below that ancestor** until a project re-enables
  it; values below remain.
- **Skip-Inbox exemption:** a project whose parent has `settings.skip_inbox = true` is created with
  `inbox = 0`; Required fields are optional for it (product.md §4; build-spec §6.1). Required means
  "complete before refinement exit", not "never save incomplete".
- **Root has no Inbox**, so Required validation never fires on Root; the fields still render.

### 2.2 Resolution helper the core provides (FORWARD — not in MVP code)

```ts
// src/server/domain/project-addons.ts (core; owns inheritance, not the add-on)
interface ResolvedAddonConfig {
  readonly identifier: string;
  readonly mode: AddonMode;
  readonly available: boolean;   // effectively enabled for this project
  readonly required: boolean;    // gates this project's Inbox exit
  readonly inherited: boolean;   // config came from an ancestor
  readonly settings: Readonly<Record<string, AddonFieldValue>>;
}
function resolveAddonConfig(db: Db, projectId: string, identifier: string): ResolvedAddonConfig;
function resolveProjectAddons(db: Db, projectId: string): readonly ResolvedAddonConfig[];
```

Every surface (slots, validation, search body, dashboard) asks this helper; no module re-implements
inheritance.

### 2.3 Project-level "required" is a contract gap (FORWARD)

`product.md` §7 says project settings can change an add-on's validation requirements, and
`build-spec.md` §12's storage shape reserves only `enabled`, `inheritFromParent`, `settings`. There is
no reserved `required` key and no type field for it today. Until the contract is extended, the only
requirement source is the global mode. **Recommended extension** (add to the core contract, not to an
add-on): reserve `projects.settings.addons[identifier].required?: boolean` (default `false`) and make
`resolveAddonConfig().required = mode === 'required' || settings.required === true`. This is flagged
in `architecture-review.md`; do not hack it into an add-on's `settings` because `settings` is
add-on-owned.

---

## 3. Registry contract (verified against the code)

`src/server/addons/types.ts` is framework-free: no React, no Next.js, no database imports. It is
exported from `src/server/addons/index.ts`. The exact current types:

```ts
export type AddonMode = 'required' | 'always' | 'optional' | 'unavailable';
export type AddonFieldType =
  'boolean' | 'number' | 'text' | 'longtext' | 'date' | 'select' | 'user';
export type AddonFieldValue = string | number | boolean | null;

export interface AddonFieldOption {
  value: string;
  label: string;
}

export interface AddonFieldDefinition {
  key: string;
  label: string;
  type: AddonFieldType;
  required?: boolean;
  description?: string;
  options?: AddonFieldOption[];       // select with static options
  optionsSource?: 'users';           // select populated from permission-filtered users
  maxLength?: number;
  min?: number;
  max?: number;
  defaultValue?: AddonFieldValue;
}

export interface AddonValidationIssue {
  field?: string;
  message: string;
}

export interface AddonWidgetItem {
  id: string;
  label: string;
  href: string;
  meta?: string;
}

export interface AddonWidgetContext {
  viewerId: string;
  visibleProjectIds: string[];
  query<T>(sql: string, params?: unknown[]): T[]; // read-only helper; no writes
}

export interface AddonDashboardWidget {
  id: string;
  label: string;
  description?: string;
  load(ctx: AddonWidgetContext): Promise<AddonWidgetItem[]> | AddonWidgetItem[];
}

export interface AddonHooks {
  validate?(ctx: {
    projectId: string;
    values: Record<string, AddonFieldValue>;
    mode: AddonMode;
  }): AddonValidationIssue[];
  beforeLeaveInbox?(ctx: {
    projectId: string;
    values: Record<string, AddonFieldValue>;
    mode: AddonMode;
  }): AddonValidationIssue[];
}

export interface AddonDefinition {
  identifier: string; // /^[a-z][a-z0-9-]*$/, stable, namespaces addon_data
  name: string;
  description?: string;
  version: string;
  fields: AddonFieldDefinition[];
  searchFields?: string[];   // field keys exposed to FTS
  compactRenderer?: string;  // UI key resolved later; registry ships none
  dashboardWidgets?: AddonDashboardWidget[];
  hooks?: AddonHooks;
}
```

`src/server/addons/registry.ts` provides:

```ts
export function registerAddon(definition: AddonDefinition): void;
export function getAddon(identifier: string): AddonDefinition | undefined;
export function listAddons(): AddonDefinition[];
export function clearAddonsForTests(): void; // test/development only; product never clears
```

`registerAddon` **throws** (and therefore does not register) when:

| Check | Rule |
|---|---|
| Identifier | matches `/^[a-z][a-z0-9-]*$/` |
| Name / version | non-empty after trim |
| Duplicate identifier | one definition per identifier, ever, in one process |
| Field key | non-empty, unique within the add-on |
| `select` field | has non-empty static `options` **or** `optionsSource === 'users'` |
| `user` field | must not define static `options` (the user list comes from core) |
| `searchFields` | every listed key must exist in `fields` (the registry does not yet enforce that it is a text field — see §8) |

A malformed definition is a **startup failure of that add-on, not of the app**: log the identifier and
error, continue booting, register nothing for it. A broken add-on must never take Kapo down.

Registration lives in one server manifest and (FORWARD) one client UI manifest — no core edits:

```ts
// src/server/addons/index.ts — the only server-side registration point
import { registerAddon } from './registry';
import { assigneeAddon } from './assignee';
registerAddon(assigneeAddon);

// src/addons/client.ts (FORWARD) — renderer keys -> client components
import { registerAddonUi } from './registry';
import { assigneeUi } from './assignee/components';
registerAddonUi('assignee', assigneeUi);
```

### 3.1 Storage contract (live in the schema)

Values: `projects.addon_data[identifier][fieldKey]`.

```json
{ "assignee": { "assignee": "8f14e45f-ceea-4c7b-8c3a-4d4f6e6f2a11" } }
```

- `addon_data` is a JSON object keyed by identifier; each value is an object keyed by field key.
- Core must **merge** on write and preserve unknown identifiers/keys; never replace the whole JSON
  object from an add-on's view of the world.
- The database column exists and defaults to `'{}'` in `001_init.sql`; no add-on column exists and
  none may be added.

### 3.2 FORWARD: project add-on configuration

`projects.settings.addons[identifier] = { enabled, inheritFromParent, settings }` (build-spec §12).
UI and endpoints:

| Surface | Contract |
|---|---|
| Application config | `/settings` → "Add-ons" section: one row per registered add-on with name, version, description, mode radio (`Required` / `Always on` / `Available` / `Unavailable`) and the add-on's global settings. Save via `PUT /api/settings` body `{ addons: { "<id>": { mode, settings } } }`. |
| Project config | `/p/[id]/settings?tab=addons` (tab hidden when the registry is empty). Per add-on: Enable, Inherit from parent, add-on settings; inherited values shown with an Override action. Save via `PUT /api/projects/:id/settings` body `{ addons: { "<id>": { enabled, inheritFromParent, settings } } }`. |
| Value write | `PATCH /api/projects/:id/addons/:identifier` body `{ values: { "<fieldKey>": value } }` (partial merge). 403/404 when not writable (Viewer, trashed, unavailable, no access); 409 `ADDON_VALIDATION_FAILED` with `fields`. This endpoint is **contracted and not built in the MVP**. |

The value endpoint must be generic: resolve availability/required, core field-type check, run
`hooks.validate` (trigger "save"), merge values preserving unknown keys, append an audit event, update
FTS if a `searchFields` value changed, all in one transaction. An add-on must never add its own
route.

### 3.3 FORWARD: lifecycle and migration contract

Not in `types.ts` today. The first add-on that needs tables/versioning requires one generic contract
change; do not put SQL in `dashboardWidgets` or ids in `settings`:

```ts
// proposed addition to AddonDefinition — reviewed centrally, not per add-on
compatibility?: { kapo: string };                 // semver range; mismatch disables the add-on, keeps data
migrations?: readonly { id: string; up(ctx: { exec(sql: string): void }): void }[];
hooks?: AddonHooks & {
  onInstall?(ctx): void;                          // inside startup tx; may seed namespaced tables
  onModeChange?(ctx: { from: AddonMode; to: AddonMode }): void;  // inside mode-change tx
  onProjectPurge?(ctx: { projectIds: readonly string[]; exec(sql: string): void }): void;
};
```

Rules now: no add-on migration may alter a core table; add-on tables are named
`addon_<identifier_with_underscores>_<table>` and reference `projects(id) ON DELETE CASCADE`;
migrations are forward-only, namespaced ids (`assignee/001_<slug>`), recorded in `schema_migrations`,
and idempotent on retry. Preference order for MVP add-ons: JSON in `addon_data` first, own tables only
for volume the JSON column cannot reasonably hold.

### 3.4 FORWARD: registry ↔ `addons` table sync

Code is the source of truth for definitions; the `addons` table stores the Admin-chosen mode and
application-level settings. At startup, after migrations: insert a row for each registered identifier
(mode = product default; the map of defaults needs one generic field on `AddonDefinition`), never
overwrite an existing mode, never delete rows for unregistered identifiers (their data must survive
code removal). `Unavailable` is a stored mode, not a deletion.

---

## 4. Field types, values, validation

| Type | Stored JSON | Core control | Validation (always server-side) | Searchable | Compact default |
|---|---|---|---|---|---|
| `boolean` | `true` / `false` / `null` | checkbox | must be boolean; `null` = not set; required + `required` means **true** (explicit acknowledgement), not merely non-null | no | check / em dash |
| `number` | number / `null` | number input | finite, no `NaN`; `min`/`max` honoured; reject numeric strings | no | plain number |
| `text` | string / `null` | text input | trimmed, no newlines, `maxLength`; plain text, never HTML | yes | clamped single line |
| `longtext` | string / `null` | textarea | trimmed, `maxLength`; plain text rendered escaped; line breaks allowed | yes | first line + ellipsis |
| `date` | `YYYY-MM-DD` / `null` | date input | calendar-date regex + real date; no timezone conversion (never `toISOString()` on submit) | no | locale date |
| `select` | option `value` / `null` | select | value must equal a declared `options[].value`, or a live `users.id` when `optionsSource: 'users'`; unknown value = issue, old value preserved | no | option label / "Not set" |
| `user` | `users.id` / `null` | user picker | zero-or-one user; must be an existing user id from the core **permission-filtered** picker; never an array; never grants access | no | avatar + name / "Unassigned" |

Notes:

- `options[].value` strings are permanent; labels are editable. Removing an option does not delete
  stored values — display a neutral "value (removed option)" chip and fail validation for that field
  on the next save/Inbox exit until a valid option is chosen.
- `optionsSource: 'users'` is select-with-dynamic-users; the separate `user` type is the zero-or-one
  reference used by Assignee. `user` fields carry neither `options` nor `optionsSource` (registry
  rejects static options; the picker list is core-provided at render time).
- `defaultValue` applies to new projects only and must never overwrite a stored value.
- Assignment via a `user` field **never grants project access** (product.md §6/§7). The value may point
  at a user who cannot read the project; the compact renderer shows the value only to viewers who can
  already read the project, and no permission row is ever created by an add-on.

### 4.1 Validation pipeline

```
request body
  -> core field-type checks (type, maxLength, min/max, option membership, date/number format)
  -> hooks.validate(ctx) for every registered, effectively available add-on   [trigger: save]
  -> aggregate issues from all add-ons (do not stop at the first add-on)
  -> any issue: 409 ADDON_VALIDATION_FAILED, fields = { "<addonId>.<fieldKey>": message }
  -> otherwise merge values, audit, reindex, commit
```

Hook rules:

- Signature: `(ctx: { projectId, values, mode }) => AddonValidationIssue[]`; **empty array = valid**.
- Synchronous and pure: the context deliberately carries **no database handle, no query helper, no
  network**. Anything needing a lookup (does this user exist?) is core field-type validation or the
  `user`/`optionsSource` resolution, never the hook.
- A throwing hook is isolated by core and treated as a validation failure with a generic message
  (logged with the identifier); it must not 500 the request or block other add-ons' issues.
- Issues are displayed inline by `field` (field key, or `"<addonId>.<fieldKey>"` once namespaced by
  core) and as a form-level notice when `field` is omitted. Messages are sentences, actionable, no
  stack traces or internal ids.

### 4.2 Required before Inbox exit, and skip-Inbox

The only gate location is the core Inbox-exit path (release **or** status change while `inbox = 1`):

```ts
// src/server/domain/inbox.ts — core; FORWARD until the projects domain lands
function exitInbox(tx: Db, actorId: string, project: Project, nextStatusId?: string) {
  const issues = resolveProjectAddons(tx, project.id)
    .filter(c => c.mode === 'required')            // + project-level required once §2.3 lands
    .flatMap(c => getAddon(c.identifier)?.hooks?.beforeLeaveInbox?.({
      projectId: project.id, values: valuesOf(project, c.identifier), mode: c.mode,
    }) ?? []);
  if (issues.length) throw new DomainError('ADDON_VALIDATION_FAILED', 409, '…', fields);
  // clear inbox + apply status + audit + commit
}
```

- Release (Inbox → same start status) and "change status out of Inbox" both go through this gate;
  neither can bypass it.
- `skip_inbox` parents create children with `inbox = 0`, so the gate never runs and Required fields
  are optional for those children (build-spec §6.1).
- After a project leaves Inbox there is no required-field gate for ordinary edits, Kanban moves or
  later status changes.
- `hooks.validate` runs on every value save; `hooks.beforeLeaveInbox` runs on the exit only. Core runs
  the gate **before** writing the transition, so a blocked exit leaves no partial audit/search/status
  change.
- Status changes from a collection view are the same path: a status update on an `inbox = 1` project
  is an Inbox exit and must pass the gate. Test matrix §14.2 covers this — it is a common bug.

---

## 5. Project settings and the settings UI contract

Storage is §2.1/§3.2. UI contracts (FORWARD; the MVP `AddonDefinition` has no settings-control type):

```ts
interface AddonSettingsProps {
  readonly addonId: string;
  readonly projectId: string | null;              // null in application settings
  readonly mode: AddonMode;
  readonly values: Readonly<Record<string, AddonFieldValue>>;  // current add-on settings
  readonly inheritedValues: Readonly<Record<string, AddonFieldValue>> | null;
  readonly canEdit: boolean;                      // false for application Viewers
  readonly disabledReason?: string;               // e.g. "Available only; enable it for this project"
  readonly onChange: (settings: Readonly<Record<string, AddonFieldValue>>) => void;
}
```

Requirements: labeled controls (label beside the control on desktop, above on mobile), helper text
from `description`, disabled + explanation when `canEdit` is false, no direct fetch/persistence (the
parent form owns submission), serialisable values. Application Viewers may edit their own
profile/password/appearance/dashboard but never project or application add-on settings.

Placement:

- Application settings (`/settings`, Admin): "Add-ons" section, one panel per registered add-on.
  Mode radio plus `show_avatar`-style global settings; the panel explains Unavailable: "Existing
  values are kept and hidden."
- Project settings (`/p/[id]/settings?tab=addons`): Enable for this project (hidden for
  Required/Always on), Inherit from parent, the add-on's project settings, and inherited-state
  display with Override. Hidden entirely when the registry is empty (shipped MVP).
- Value editing happens at the project page/view slots only; settings panels never edit values.

---

## 6. Project page placement — main / sidebar (FORWARD)

The MVP `AddonDefinition` has no page-slot field; only `compactRenderer` and `dashboardWidgets` are
representable. Before an add-on with a project-page editor ships, extend the contract once:

```ts
// proposed addition to AddonDefinition
projectPage?: {
  main?: string;      // renderer key: main content region, above Activity
  sidebar?: string;   // renderer key: one row in the right-hand Properties sidebar
};
```

Renderer props (client component, resolved from the client UI map):

```ts
interface AddonProjectPanelProps {
  readonly addonId: string;
  readonly projectId: string;
  readonly values: Readonly<Record<string, AddonFieldValue>>;
  readonly settings: Readonly<Record<string, AddonFieldValue>>;
  readonly mode: AddonMode;
  readonly required: boolean;
  readonly canEdit: boolean;
  readonly readOnlyReason?: string;  // trashed, Viewer, unavailable below this ancestor
  readonly onSave: (values: Readonly<Record<string, AddonFieldValue>>) => Promise<void>;
}
```

Rules:

- **Sidebar** renders one property row at rest (label, compact value, edit affordance); editing may
  open a popover/dialog owned by the component. Root renders sidebar contributions too.
- **Main** renders in the main content region above Activity; it must not repeat core field slots,
  take over layout, or hide title/status/reporter.
- Placement in a **layout template** is core-controlled (visible fields and order, `main | sidebar |
  hidden`). The add-on contributes the field and renderer; the project decides whether/where it
  appears. No freeform builder (product.md §3) and no arbitrary property-count limit.
- No component fetches data itself, imports `src/server/**`, mutates permissions, or bypasses
  `onSave`. Viewer/trashed/unavailable → render read-only or hidden, never a disabled form implying
  access.

---

## 7. Compact renderer for Kanban / Card / Tree / List

The current contract has **one** renderer key for all views:

```ts
compactRenderer?: string; // UI key, e.g. 'assignee.compact'; resolved by the client UI map
```

The registry ships no UI; when the core UI resolves the key it must pass (proposed, FORWARD):

```ts
type CollectionViewKey = 'kanban' | 'card' | 'tree' | 'list';

interface AddonCompactProps {
  readonly addonId: string;
  readonly fieldKey: string;
  readonly value: AddonFieldValue;
  readonly values: Readonly<Record<string, AddonFieldValue>>;
  readonly view: CollectionViewKey;
  readonly projectId: string;
  readonly readOnly: boolean;                    // Tree/List are read-only in MVP
  readonly density: 'comfortable' | 'compact';
  readonly onChange?: (fieldKey: string, value: AddonFieldValue) => void; // absent = read-only
}
```

Rules:

- **No data access.** No fetch, no effects loading data, no server imports. Props in, pixels out.
- **One visual line** in compact density; clamp with ellipsis, do not grow cards/rows. Unlimited
  configured fields simply stack; an add-on must never impose a property-count limit.
- **Null-safe.** `null` renders a quiet "Not set"/dash, never an empty clickable area.
- **Interactive only when `onChange` is provided** (Kanban/Card may allow inline edit; Tree/List render
  read-only). `onChange` is core-supplied and already permission-checked; an add-on must not call the
  API itself.
- **Tokens only:** existing CSS tokens for colour/spacing/radius/type; no hard-coded hex, no new icon
  family; contrast ≥ 4.5:1; icon buttons need `aria-label`.
- **Fallback:** unresolved key or absent `compactRenderer` → core renders the field-type default
  (checkbox chip, number, clamped text, date, select/user label). Omit a renderer unless the default is
  genuinely wrong for the view.
- **Gap:** one key for four views cannot express "editable chip in Kanban, read-only chip in Tree" by
  itself — the renderer branches on `view` and `readOnly`. If the first add-on needs different
  renderers per view, change the contract to
  `compactRenderer?: Partial<Record<CollectionViewKey, string>>` centrally; do not add per-view
  special cases to the views.

---

## 8. Search exposure

Declare searchable field keys in `definition.searchFields: string[]`. Only `text` and `longtext`
fields may be listed.

- Core builds `project_search.body` from `searchFields` values **only while the add-on is effectively
  available for the project**, in definition order; `projects.title` is always indexed.
- Reindex points: project create, add-on value write, title change, project move, add-on
  availability/mode change (affected projects), restore from trash. Rebuild path:
  `src/server/db/search.ts` `indexProject`/`removeProjectFromSearch` (already implemented);
  `searchBodyFromAddonValues` builds the body from namespaced values.
- Query path: `project_search` joins `projects` and the permission-filtered access set, excludes
  `trashed_at IS NOT NULL`, follows `users.show_archived`, prefix tokens (`term*`), escaped query
  syntax. No result may include an inaccessible title/snippet.
- **Unavailable/non-enabled values are never indexed and never searchable.** Disabling reindexes the
  affected projects; the old value stays in `addon_data` but is unsearchable. This is a privacy rule,
  not a performance one.
- Registry gap: `assertValidDefinition` currently checks only that `searchFields` keys exist, not that
  they are `text`/`longtext`. Core indexing must reject non-text search fields (or the registry must
  be tightened); an add-on must not rely on boolean/number/user fields being searchable.
- Add-on code never receives the FTS table or query; it only declares fields. Snippets are core-owned
  (title match in MVP; bounded escaped excerpt with field label once add-on text is indexed).

---

## 9. Dashboard widget contributions

```ts
interface AddonWidgetItem {
  id: string;
  label: string;
  href: string;
  meta?: string;
}

interface AddonWidgetContext {
  viewerId: string;
  visibleProjectIds: string[];                      // already permission-filtered
  query<T>(sql: string, params?: unknown[]): T[];   // READ-ONLY helper; no writes
}

interface AddonDashboardWidget {
  id: string;                                       // namespaced: '<identifier>.<slug>'
  label: string;
  description?: string;
  load(ctx: AddonWidgetContext): Promise<AddonWidgetItem[]> | AddonWidgetItem[];
}
```

**Invariant — the widget context is read-only and must remain so.** `query` gives an add-on a way to
read its own namespaced data joined to `visibleProjectIds`; it must never be backed by a writable
handle, and future implementations must not weaken this to "convenience" raw DB access, a transaction
object, or a permission helper. `visibleProjectIds` is the permission result computed by core; an
add-on may filter within it but never expand it. A widget loader that ignores it and queries all
projects is a privacy bug and must fail review. This invariant is also recorded in
`architecture-review.md`.

Editor and visibility contract (from `dashboard.md`, binding for core):

- One instance per widget id; show/hide + Move up/down + Save/Cancel + Restore defaults; no resize,
  grid, free positioning or query builder.
- The saved preference is an ordered id list in `users.dashboard` JSON. Entries for widgets that are
  not registered right now (add-on unregistered, mode `unavailable`, code/UI skew) are **preserved**,
  hidden from Home, and listed in the editor as unavailable with a one-line explanation. Only an
  explicit user Save/Restore-defaults changes the preference. **Current-MVP gap:** `src/lib/types.ts`
  `parseDashboard` filters against the hard-coded `DASHBOARD_WIDGETS` (`inbox`, `recent`) and drops
  unknown ids, so the required preservation is not implemented yet. Before shipping any add-on widget
  (or reinstating Completed last week), relax the parser to keep unknown ids/order and let rendering
  filter; flagged in `architecture-review.md`.
- When the add-on is `unavailable`, the widget is absent from Home even if projects hold values. When
  `optional` but not enabled for any project the viewer can read, the loader returns an empty list
  (no stale values).
- Loaders use core-filtered queries, respect `show_archived`, never include trashed projects; totals
  are counts of the filtered set.
- A loader that throws produces a **widget-local error with Retry**; it must not disable the rest of
  Home. Renderers are core-owned list rendering (`label`/`href`/`meta`), so add-ons do not ship
  arbitrary widget UI in the MVP — a deliberate constraint, not a missing feature.
- Widgets link to existing core surfaces. Add-ons must not add a top-level route or navigation entry.

Core dashboard widgets (Inbox, Recent changes) use the same registry shape internally; that is what
makes the deferred "Completed last week" reintroduction (§13) a registration change.

---

## 10. Data retention, namespacing, schema evolution, versioning

### 10.1 Never delete on hide/disable/unavailable

| Event | `addon_data` values | Add-on tables | Search body | Dashboard preference |
|---|---|---|---|---|
| Mode set to `unavailable` | kept | kept | field removed (reindexed) | preserved, widget hidden |
| Project disables an `optional` add-on | kept | kept | field removed (reindexed) | n/a |
| Ancestor stops inheriting | kept | kept | reindexed per project | n/a |
| Add-on code unregistered | kept | kept | removed by rebuild/startup | preserved |
| Project moved where add-on is unavailable | kept, hidden | kept | body rebuilt without field | n/a |
| Project trashed | kept, hidden | kept | excluded by trash filter | n/a |
| Project purged (30-day automatic) | deleted with project | `onProjectPurge` hook, then core cascade | deleted | n/a |
| User hides dashboard widget | n/a | n/a | n/a | removed only by user Save/Restore defaults |

Core must not "clean up" unknown identifiers in `addon_data` or `settings.addons`. A re-registered
add-on with the same identifier sees its old values again.

### 10.2 Namespacing rules

- `addon_data` top-level keys = add-on identifiers; field keys scoped under the identifier. Never use
  camelCase identifiers, never a core column name, never nest another add-on's identifier.
- Add-on tables (FORWARD, only when JSON is insufficient): `addon_<identifier_with_underscores>_<table>`,
  created by the add-on's own migrations, `REFERENCES projects(id) ON DELETE CASCADE`.
- Never write `projects`, `statuses`, `project_roles`, `favorites`, `audit_events`, `sessions`, `users`.
- Migration ids namespaced `'<identifier>/<NNN>_<slug>'`; run after core migrations, one transaction per
  migration, recorded in `schema_migrations`.
- Search/dashboard are read surfaces: derive from core-filtered queries, never from private caches.

### 10.3 Schema evolution and versioning

- Identifier is permanent. Field keys and select option values are permanent; `label` may change.
  Renaming a key requires a new key plus a migration that moves values; keep the old key readable for
  one release (retention applies to schema too). Never reuse a key for a different meaning.
- Adding/removing a field needs no migration (JSON), but never delete a key with stored values; hide
  the field (remove from `fields`/`searchFields`) and keep the value until a documented deprecation
  migration.
- Definition `version` is informational in the MVP; there is **no `compatibility` field yet**. Before
  the first versioned add-on, add `compatibility.kapo` (semver range) and a startup check: mismatch →
  log, do not register, keep data and mode row, continue booting. Never crash startup for an add-on.
- Migrations are forward-only and idempotent on retry; an interrupted transaction rolls back and
  reruns. Downgrade is unsupported (core rule); an add-on must tolerate the previous release's data
  shape for one release (`readValue` with defaults) before its migration runs.
- Removing an add-on from the codebase is not a data migration: no core code deletes its JSON/tables;
  the `addons` row remains; the identifier stays reserved.

---

## 11. Lifecycle hooks and failure isolation

MVP hooks are `validate` and `beforeLeaveInbox` (§3, §4.2). Everything else is FORWARD (§3.3) and
must obey the same rules when added.

```
startup        -> registry validates definition; compatibility check; add-on migrations; sync addons rows
value save     -> core type-check -> hooks.validate -> merge/audit/FTS -> commit
inbox exit     -> required add-ons hooks.beforeLeaveInbox -> clear inbox/status/audit -> commit
mode change    -> onModeChange (inside tx) -> update mode + reindex -> commit
project purge  -> onProjectPurge (inside tx) -> delete add-on rows/values -> commit
```

Isolation rules:

1. **Validation never writes.** The context has no DB/query/network. A throwing hook is caught, logged
   with the identifier, surfaced as a generic validation failure, and does not stop other add-ons'
   issues from being reported.
2. **Hooks are inside the core transaction.** If `onModeChange`/`onProjectPurge`/`onInstall` throws,
   the operation rolls back (mode unchanged / purge retried later) and the app keeps running.
3. **Post-commit work is not a hook.** Notifications/external calls and anything fallible belong
   outside the transaction; add-ons must not add network I/O inside hooks (it blocks SQLite's writer
   and the Node event loop).
4. **Read-side failures are local.** A throwing dashboard loader gets a widget error state with Retry;
   a throwing compact renderer is caught by the view boundary and replaced with the core fallback plus
   a logged identifier. One add-on cannot blank a page.
5. **Time budgets.** Hooks run synchronously in a request; keep them O(fields), no scans outside
   namespaced data. Large data migrations belong to startup migrations, not requests.
6. **No capability escalation.** Hook contexts deliberately omit permission helpers, the session and
   core mutation functions. An add-on cannot approve itself, change a role, suppress audit or widen
   `visibleProjectIds`. This is enforced by type shape, not only by review.

An add-on **must not bypass core invariants** (product.md §9). It cannot change a project's status,
inbox flag, parent, archived/trash state, priority or roles; write/suppress audit; mark a required
field complete without a value; make a trashed project writable or a Viewer a writer; or return
inaccessible projects from search/dashboard.

---

## 12. Worked example: the Assignee add-on (deferred from MVP)

Assignee is specified in product.md §7 and deferred from this iteration. It is the reference exercise
for the contract: zero or one assignee per project, optional by default, application- and project-level
availability/requirement, compact rendering in views, an **Assigned to me** dashboard widget. Building
it must not add special-case logic to core; if it does, the contract has failed.

It exercises every current type: the `user` field (zero-or-one), `hooks.validate` and
`hooks.beforeLeaveInbox`, `compactRenderer`, `dashboardWidgets`, and the FORWARD project-page/settings
slots.

### 12.1 Definition and registration

```ts
// src/server/addons/assignee/index.ts
import type { AddonDefinition, AddonValidationIssue } from '../types';

export const assigneeAddon: AddonDefinition = {
  identifier: 'assignee',
  name: 'Assignee',
  description: 'Assign a project to one household member.',
  version: '1.0.0',
  fields: [
    {
      key: 'assignee',
      label: 'Assignee',
      type: 'user',
      required: false,
      description: 'One person responsible for this project.',
    },
  ],
  searchFields: [],              // user ids are not searchable text; see §12.4
  compactRenderer: 'assignee.compact',
  hooks: {
    validate({ values }) {
      const issue = validateAssignee(values.assignee);
      return issue ? [issue] : [];
    },
    beforeLeaveInbox({ values, mode }) {
      // Required globally: the Inbox exit is blocked until a user is chosen.
      if (mode === 'required' && values.assignee == null) {
        return [{ field: 'assignee', message: 'Choose an assignee before leaving the Inbox.' }];
      }
      const issue = validateAssignee(values.assignee);
      return issue ? [issue] : [];
    },
  },
  dashboardWidgets: [{
    id: 'assignee.assigned_to_me',
    label: 'Assigned to me',
    description: 'Open projects assigned to you, grouped by parent.',
    load: ({ viewerId, visibleProjectIds, query }) => loadAssignedToMe(
      { viewerId, visibleProjectIds, query },
    ),
  }],
};

function validateAssignee(value: unknown): AddonValidationIssue | null {
  if (value == null) return null;            // zero assignee is valid unless required
  if (typeof value !== 'string' || !value.trim()) {
    return { field: 'assignee', message: 'Choose a valid assignee.' };
  }
  // Existence/permission of the user is core's `user` field check (permission-filtered picker);
  // assigning never grants access, so no permission check belongs in this hook.
  return null;
}

// src/server/addons/index.ts
import { registerAddon } from './registry';
import { assigneeAddon } from './assignee';
registerAddon(assigneeAddon);
```

No core file changes. v1 stores values in `addon_data` (no table, no migration). If a later version
adds a table, it adds `migrations: [{ id: 'assignee/001_scope', up: ctx => ctx.exec('CREATE TABLE …') }]`
with `REFERENCES projects(id) ON DELETE CASCADE`.

### 12.2 Validation hooks

- Zero-or-one is inherent in one `user` field; the hook rejects non-strings/blank, the core rejects
  arrays and unknown users.
- Requirement is resolved, not assumed: `mode === 'required'` is the only MVP source; a project-level
  requirement needs the FORWARD §2.3 contract. Do not put a `required` flag in `settings` (add-on-owned
  settings are not a place for core policy).
- **Assignment never grants access.** The hook adds no project roles; renderers show the assignee only
  to viewers who can already read the project. If the assignee loses access, the value stays; their
  "Assigned to me" query no longer returns it.
- Skip-Inbox children never run the gate.
- Deleting/deactivating the assigned user does not delete the value: display "Former member", fail the
  next save/Inbox-exit validation that requires it until reassigned.

### 12.3 Compact renderer

```tsx
// src/addons/assignee/components.tsx  ('use client')
export function AssigneeCompact(props: AddonCompactProps) {
  if (props.value == null) return <span className="muted">Unassigned</span>;
  return <span className="chip"><Avatar userId={String(props.value)} size={16} />{props.label}</span>;
}
```

- registration key `assignee.compact`; the renderer branches on `props.view` (Kanban/Card may offer
  inline edit when `onChange` is provided; Tree/List are read-only).
- one line, clamps with ellipsis; null → muted "Unassigned"; no fetch — user label/avatar data comes
  from core via props (when the FORWARD UI contract lands, extend `AddonCompactProps` with a
  core-resolved `options` map; do not fetch inside the renderer).
- no avatar when the user cannot be shown (deleted user → "Former member").

### 12.4 Search exposure

`searchFields: []` in v1. User ids are opaque and display names are identity data already reachable
through project membership; indexing them would create surprising snippets and a privacy question.
An "assigned to me" query is a filtered surface (the dashboard widget), not FTS. If search filtering by
assignee is wanted later, add a core search filter parameter, not a fake searchable text field.

### 12.5 Settings UI

- Application settings (`/settings` → Add-ons → Assignee): mode radio (Required / Always on /
  Available / Unavailable) with the explanation for Unavailable ("Existing assignee values are kept
  and hidden"). MVP has no global add-on settings for Assignee.
- Project settings (`/p/[id]/settings?tab=addons` → Assignee): Enable for this project (Optional mode
  only), Inherit from parent, and a state line "Inherited from <parent>" with Override. Required mode
  has no enable toggle.
- Project page sidebar row (FORWARD `projectPage.sidebar`): "Assignee" + compact chip; edit popover
  with the user picker; Viewer sees the value without an edit affordance.
- Dashboard editor: "Assigned to me" appears when the registered widget is available; `unavailable`
  shows the editor explainer with the preference preserved; no stale values.

### 12.6 Dashboard widget

```ts
// loader using the real read-only context
function loadAssignedToMe(ctx: AddonWidgetContext): AddonWidgetItem[] {
  if (ctx.visibleProjectIds.length === 0) return [];
  const placeholders = ctx.visibleProjectIds.map(() => '?').join(',');
  const rows = ctx.query<{ id: string; title: string; parent_title: string; status: string; inbox: number }>(
    `SELECT p.id AS id, p.title AS title, parent.title AS parent_title,
            s.name AS status, p.inbox AS inbox
       FROM projects p
       JOIN projects parent ON parent.id = p.parent_id
       JOIN statuses s ON s.id = p.status_id
      WHERE p.id IN (${placeholders})
        AND p.trashed_at IS NULL
        AND json_extract(p.addon_data, '$.assignee.assignee') = ?
      ORDER BY parent.title COLLATE NOCASE, p.priority
      LIMIT 5`,
    [...ctx.visibleProjectIds, ctx.viewerId],
  );
  return rows.map(row => ({
    id: row.id,
    label: row.title,
    href: `/p/${row.id}`,
    meta: `${row.parent_title} · ${row.status}${row.inbox ? ' · Inbox' : ''}`,
  }));
}
```

- Permission filtering is already in `visibleProjectIds`; the loader may narrow, never widen. Counts
  come from the same filtered query. `show_archived` handling is core-supplied when the widget context
  is wired (include archived only per viewer preference); trashed is excluded explicitly here.
- Group/order: `dashboard.md` says group by parent title, sibling priority inside a group, max five,
  no global priority score. That is what the query above approximates; final SQL must join the parent's
  finish status to exclude "closed" projects and honour archived visibility.
- Empty state: "Nothing assigned to you." Not a metric tile, no streaks/urgency.
- **Known gap:** `dashboard.md` says link to "the full Assigned to me collection", but the MVP has no
  filtered-collection route. Link to `/p/<id>` items only; do not invent a top-level route. A filtered
  collection is deferred work, flagged for the product owner.

### 12.7 Test checklist for Assignee

| # | Test | Expected |
|---|---|---|
| A1 | `user` field validation | array/blank/unknown id rejected 409 with field path; `null` allowed |
| A2 | Required mode | Inbox release blocked; status change out of Inbox blocked; no partial write |
| A3 | skip_inbox parent | child `inbox = 0`; no gate; Required fields optional |
| A4 | Always/Optional modes | no gate; value optional; enable/inherit behaviour per §2.1 |
| A5 | Inheritance | enable + inherit flows down; child off hides below; values below kept |
| A6 | Unavailable retention | mode → unavailable: JSON unchanged; field hidden; search body lacks it |
| A7 | Move/reparent | value preserved when destination has assignee unavailable; reappears when enabled |
| A8 | Search privacy | assignee id/name never in FTS or snippets |
| A9 | Widget permissions | only `visibleProjectIds` rows; inaccessible never counted; trashed excluded |
| A10 | Widget availability | unavailable → absent from Home, editor explainer, preference preserved |
| A11 | Viewer | cannot edit; no picker; value readable if project readable |
| A12 | Purge | JSON removed with project; no purge audit event; widget count updated |
| A13 | Zero-or-one | no path stores an array or multiple assignees |
| A14 | Compact renderer | null → "Unassigned"; one line; no fetch; read-only in Tree/List |
| A15 | Failure isolation | throwing hook → field error; throwing loader → local widget error, page intact |

### 12.8 Why Assignee is the contract test

Assignee is simple in business terms and hard in contract terms: dynamic user resolution, project and
application configuration, inheritance, a required gate, compact rendering across four views, a
permission-filtered dashboard query and retention across every state. If it ships through these
manifests with no core `if (addon === 'assignee')`, the extension model works.

---

## 13. The deferred "Completed last week" built-in widget

Build-spec §1 removes the **Completed last week** widget from this iteration: it is not registered,
not in the default dashboard order, and not offered in the editor. `dashboard.md` keeps it as a
reviewed MVP idea with counting semantics still open. It is the reference example of a **built-in
contribution** that can return without a schema change.

Why reintroduction needs no migration:

| Concern | Why no schema change |
|---|---|
| Dashboard preference | `users.dashboard` JSON already stores an ordered widget-id list (`[{"id":"inbox","visible":true},{"id":"recent","visible":true}]` by default). The forward-compat rule is that the editor preserves ids it does not currently recognise — the same rule as unavailable add-on widgets — so a saved preference survives absence and returns intact. **Gap:** today `parseDashboard` in `src/lib/types.ts` drops unknown ids; relax it before reintroducing the widget (no schema change, code change only). |
| Counting data | `audit_events` already records project changes while the project exists (append-only, actor/timestamp). The count is derived: distinct live readable projects with a transition into the parent's finish status during the previous calendar week. No new column, no event-store table. |
| Permissions/archival | The loader uses the same permission-filtered access set and `show_archived`/trashed filters as every dashboard query. |
| Registration | Core widgets use the same registry shape (`AddonDashboardWidget`/`AddonWidgetItem`) internally. Reintroducing it = one core definition plus a default-order entry; feature presence is registration, not a column. |
| Purge | Purged projects lose their own audit events, so they naturally leave the count; no tombstone needed. |
| Defaults | `restore defaults` reads the registered default list: omitted while unregistered, present when re-registered. Keep the default order in the core definition. |

Counting semantics to fix when it returns (dashboard.md decisions): count **distinct projects** that
entered their parent's finish status during the previous calendar week, not transitions; a project
reopened and re-completed inside the window counts once; only live/readable/not-trashed projects;
archived follows `show_archived`; a count, not a chart.

**Dependency to preserve now:** this reintroduction is schema-free only if the MVP audit records
status changes with enough detail (old/new status id and timestamp) in the project's own log. If the
audit implementation does not record status changes, reintroduction would need an event schema — an
MVP audit-completeness issue, flagged in `architecture-review.md`.

Reintroduction checklist: register core widget definition → add to default order behind Inbox/Recent
changes → implement loader with the filters above → editor picks it up through the registry only →
tests for permission filtering, UTC week boundary, reopen/recomplete, purge, preference preservation
while unregistered → update this section. No migration, no new table, no `users.dashboard` shape
change.

---

## 14. Checklists

### 14.1 Review checklist (blocking)

- [ ] Registered via `src/server/addons/index.ts` only; no core-domain file imports the add-on
      definition; no `if (identifier === …)` in core.
- [ ] Identifier kebab-case and unique; field keys immutable; version declared.
- [ ] Definition passes `registerAddon`: duplicate keys, select options/optionsSource, `user` with no
      static options, `searchFields` keys exist (and are text — core indexing must enforce).
- [ ] Values only in `addon_data[identifier][fieldKey]` (or namespaced `addon_*` tables with
      `ON DELETE CASCADE`); core tables/columns untouched; unknown keys preserved on merge.
- [ ] Field types use core controls; hooks pure/sync, no DB/network; throwing hooks isolated.
- [ ] Required gate only through the core Inbox-exit path; `skip_inbox` exemption; no gate elsewhere.
- [ ] Every read (page, compact, search, dashboard) permission-filtered in SQL and respects
      `show_archived`/trash; `visibleProjectIds` never expanded; no JS-only filtering.
- [ ] Availability changes hide values, never delete them; unregistering leaves data intact.
- [ ] Search: only effectively available `searchFields` indexed; reindex on availability/mode change;
      no snippets from hidden values.
- [ ] Dashboard widget: one instance, preference preserved when unavailable, local error Retry, no new
      top-level route, item-only output (no custom widget UI in MVP).
- [ ] Renderers: client-only, no data access, null-safe, one line compact, tokens only, a11y labels,
      fallback when key unresolvable.
- [ ] Migrations (FORWARD): namespaced, forward-only, idempotent, tested on a real DB copy, non-
      destructive, backup/rollback documented, compatibility range added centrally.
- [ ] Hooks transactional, rollback on throw, no post-commit work, no capability escalation.
- [ ] Viewer/trashed/unavailable render read-only or hidden; no disabled form implying access.
- [ ] Tests in §14.2 exist and fail on deliberate regression; no scope creep beyond product.md §7.
- [ ] No "coming soon", disabled teaser or placeholder UI for deferred features (product convention).

### 14.2 Testing checklist

- [ ] Field-type matrix: all seven types with valid, null, wrong-type, boundary (min/max/maxLength,
      removed option, impossible date, non-user id).
- [ ] Required gate: release, status-change-out-of-Inbox, skip_inbox exemption, mode Required vs not,
      rollback asserted on failure.
- [ ] Mode matrix (4) × project enabled/disabled × inherited/overridden × Root/ordinary.
- [ ] Retention: disable/unavailable/unregister/reparent/trash → JSON and tables unchanged; re-enable
      → values visible again.
- [ ] Inheritance: enabled/settings/required flow down; child override; sibling unaffected; move
      re-resolves config.
- [ ] Permission: app Viewer read-only; app Admin without grant cannot read a private project; direct
      descendant grant without ancestor access; inaccessible values never in search/dashboard.
- [ ] Search: indexed when available, removed when unavailable, prefix query, escaping, trashed
      excluded, archived follows preference.
- [ ] Dashboard: filters/archiving/Inbox indicator/limit/order, unavailable handling, preference
      preservation, loader failure isolation, read-only context invariant (no write path exposed).
- [ ] Audit: value changes audited with old/new; no parent duplication; no purge audit.
- [ ] Registry: malformed definitions rejected with clear errors; duplicate identifier/keys; empty
      registry boots; `clearAddonsForTests` isolated.
- [ ] UI: Root has no status but renders fields; no-children state; four view slots; mobile widths;
      dark tokens; keyboard/focus; labels for controls.
- [ ] E2E (when the first add-on is enabled in a fixture): one happy path per mode, one required-gate
      block, one unavailable-retention path. Until then, contract tests only — the MVP registry is
      empty, so there is no end-to-end add-on flow to test.

### 14.3 Migration checklist (data/schema evolution)

- [ ] Add migration id (namespaced, sequential); immutable once released.
- [ ] Runs after core migrations, in core transaction, registration order documented; no cross-add-on
      dependency.
- [ ] Test on a copy of a version-N database with real rows; assert values before/after.
- [ ] Idempotent on rerun; failure leaves no partial state; compatibility range covers versions that
      can hit it.
- [ ] No destructive rewrite of `addon_data` without a deprecated-key read path for one release.
- [ ] No field/option removal while values are stored; deprecate/hide, migrate later.
- [ ] New tables namespaced, FK `ON DELETE CASCADE`, indexes for widget/search query paths.
- [ ] Searchable-field changes update the reindex/repair story; rebuild tested.
- [ ] Backup before upgrade documented; rollback (previous image + compatible schema, or volume
      restore) stated in the PR.
- [ ] Changelog: identifier, version, compatibility range, required Admin action (e.g. re-enable mode).
