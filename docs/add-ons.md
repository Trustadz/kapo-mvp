# Building Kapo add-ons

**Audience:** a developer adding a feature to Kapo that is not core project management.
**Status:** Issue #7 ships the first add-on plumbing bundle: the contract plus the **Assignee**
reference add-on (`src/server/addons/assignee/`), registry→`addons` table mode sync, application and
project settings surfaces, the generic value endpoint
(`PATCH /api/projects/:id/addons/:identifier`), a generic project-page field editor,
availability/inheritance resolution (`src/server/domain/project-addons.ts`), add-on search
maintenance, audit/activity integration and `onProjectPurge` hooks. Core still owns every invariant;
the Assignee definition is registered only through the manifest and no core module branches on its
identifier. The Inbox-exit hook gate (`src/server/domain/addon-hooks.ts`) now resolves the stored
mode and runs the shipped add-on's hooks. Still **FORWARD**: a client renderer registry for
`compactRenderer`, a consumer for add-on dashboard widgets, per-add-on settings controls, per-add-on
project-page slots and project-level "required" (§2.3). Sections marked **FORWARD** remain the target
contract for those surfaces.
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
'unavailable'))`, build-spec §5). Startup sync inserts a row for every registered add-on using
`AddonDefinition.defaultMode` (default `optional`), never overwriting an Admin choice; `/settings` →
Add-ons lets an Admin change the mode. The hook runner and value endpoint resolve
`addons.mode ?? definition.defaultMode ?? 'optional'`. Per-project enablement in
`projects.settings.addons` is read by `src/server/domain/project-addons.ts`; see §2.1.

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
`inheritFromParent` and `settings`; everything inside `settings` belongs to the add-on. Core
preserves unknown identifiers, unknown entry keys and unknown setting keys on merge, so
forward/backward compatibility does not need migrations. The inheritance algorithm below is
implemented centrally in `src/server/domain/project-addons.ts` (not in the add-on) and is used by the
value endpoint, the project page, search and the settings surfaces.

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

### 2.2 Resolution helper the core provides (implemented)

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

`resolveAddonConfig` / `resolveProjectAddons` are implemented in
`src/server/domain/project-addons.ts`; every shipped surface (value save, page editor, settings,
search) calls them. Project-level `required` remains the gap in §2.3, so `required` is still derived
from the global mode only.

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

`registerAddon` **throws** (and therefore does not register) when (re-verified against the final
`registry.ts`):

| Check | Rule |
|---|---|
| Identifier | matches `/^[a-z][a-z0-9-]*$/` |
| Name / version | non-empty after trim |
| Duplicate identifier | one definition per identifier, ever, in one process |
| Field key | non-empty, unique within the add-on |
| `select` field | has non-empty static `options` **or** `optionsSource === 'users'` |
| `user` field | must define **neither** static `options` **nor** `optionsSource` (both are rejected by `registry.ts`; the picker list is core-provided at render time) |
| `searchFields` | every listed key must exist in `fields` and be a `text`/`longtext` field (§8) |

A malformed definition must be a **failure of that add-on, not of the app**: log the identifier and
error, continue booting, register nothing for it. A broken add-on must never take Kapo down.
`registerAddon` still throws immediately; the shipped manifest wraps each `registerAddon` call in a
per-add-on try/catch so importing the manifest cannot crash startup. That wrapper is part of the
generic plumbing, not per-add-on code.

Registration lives in one server manifest and (FORWARD) one client UI manifest — no core edits.
The server manifest below is implemented in `src/server/addons/index.ts`, wrapping each
`registerAddon` call in a per-add-on try/catch (a malformed definition is logged and skipped):

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
| Value write | `PATCH /api/projects/:id/addons/:identifier` body `{ values: { "<fieldKey>": value } }` (partial merge). 403/404 when not writable (Viewer, trashed, unavailable, no access); 422 `addon_validation` with `fields` (same code/status as the implemented Inbox-exit gate). Implemented. |

The value endpoint is implemented as `PATCH /api/projects/:id/addons/:identifier` in
`src/app/api/projects/[id]/addons/[identifier]/route.ts`, backed by
`writeAddonValues()` in `src/server/domain/project-addons.ts`. It resolves availability, runs the
generic field-type checks, calls `hooks.validate`, merges values preserving unknown keys/fields,
appends `project.addon_value_changed` audit events and updates FTS in one transaction. An add-on
never adds its own route. The hook context has no `trigger` field (`{ projectId, values, mode }`
only), so an add-on cannot tell "save" from "Inbox exit" inside `validate`; use
`beforeLeaveInbox` for exit-only rules. The shipped endpoints are:

| Surface | Status |
|---|---|
| `PUT /api/settings` body `{ addons: { "<id>": { mode, settings } } }` | implemented |
| `PUT /api/projects/:id/settings` body `{ addons: { "<id>": { enabled, inheritFromParent, settings } } }` | implemented |
| `PATCH /api/projects/:id/addons/:identifier` body `{ values: { "<fieldKey>": value } }` | implemented |

### 3.3 Lifecycle and migration contract (purge hook implemented; migrations FORWARD)

`hooks.onProjectPurge` is implemented in `types.ts` and called by the purge transaction. The
remaining lifecycle fields are not in `types.ts`; the first add-on that needs tables/versioning
requires one generic contract change. Do not put SQL in `dashboardWidgets` or ids in `settings`:

```ts
// proposed addition to AddonDefinition — reviewed centrally, not per add-on
compatibility?: { kapo: string };                 // semver range; mismatch disables the add-on, keeps data
migrations?: readonly { id: string; up(ctx: { exec(sql: string): void }): void }[];
hooks?: AddonHooks & {
  onInstall?(ctx): void;                          // inside startup tx; may seed namespaced tables
  onModeChange?(ctx: { from: AddonMode; to: AddonMode }): void;  // inside mode-change tx
  onProjectPurge?(ctx: { projectIds: readonly string[]; exec(sql: string): void }): void; // shipped
};
```

`onProjectPurge` is part of the shipped `AddonHooks`; the other fields above are still proposed.

Rules now: no add-on migration may alter a core table; add-on tables are named
`addon_<identifier_with_underscores>_<table>` and reference `projects(id) ON DELETE CASCADE`;
migrations are forward-only, namespaced ids (`assignee/001_<slug>`), recorded in `schema_migrations`,
and idempotent on retry. Preference order for MVP add-ons: JSON in `addon_data` first, own tables only
for volume the JSON column cannot reasonably hold.

### 3.4 Registry ↔ `addons` table sync (implemented)

Code is the source of truth for definitions; the `addons` table stores the Admin-chosen mode and
application-level settings. At startup, after migrations: insert a row for each registered identifier
(mode = product default; the map of defaults needs one generic field on `AddonDefinition`), never
overwrite an existing mode, never delete rows for unregistered identifiers (their data must survive
code removal). `Unavailable` is a stored mode, not a deletion.

**Implemented:** `syncAddonRegistry()` in `src/server/domain/project-addons.ts` runs at startup
(instrumentation), after first-run setup and after `db:seed`. It inserts missing rows with
`defaultMode`, updates the display name, never overwrites `mode`/`settings`, and never deletes rows
for unregistered identifiers. `/settings` → Add-ons is the Admin mode surface. The hook runner and
the value endpoint resolve the stored mode, so Required semantics now work once an Admin selects
Required.

---

## 4. Field types, values, validation

The **type definitions** below are implemented in `types.ts` and enforced at registration where the
registry can do so (shape of `options`/`optionsSource`, and `searchFields` must be `text`/`longtext`).
The first add-on bundle also implements the generic value endpoint and field-type validation
(`fieldValueError` in `src/server/domain/project-addons.ts`) plus a generic project-page editor
driven by field definitions. `select`/`user` values are checked against declared options or existing
`users.id` rows. `compactRenderer` and dashboard widgets still have no core consumer (§6/§7/§9).

| Type | Stored JSON | Core control | Validation | Searchable | Compact default (FORWARD) |
|---|---|---|---|---|---|
| `boolean` | `true` / `false` / `null` | checkbox | must be boolean; `null` = not set; required + `required` means **true** (explicit acknowledgement), not merely non-null | no | check / em dash |
| `number` | number / `null` | number input | finite, no `NaN`; `min`/`max` honoured; reject numeric strings | no | plain number |
| `text` | string / `null` | text input | trimmed, no newlines, `maxLength`; plain text, never HTML | yes | clamped single line |
| `longtext` | string / `null` | textarea | trimmed, `maxLength`; plain text rendered escaped; line breaks allowed | yes | first line + ellipsis |
| `date` | `YYYY-MM-DD` / `null` | date input | calendar-date regex + real date; no timezone conversion (never `toISOString()` on submit) | no | locale date |
| `select` | option `value` / `null` | select | value must equal a declared `options[].value`, or a live `users.id` when `optionsSource: 'users'`; unknown value = issue, old value preserved | no | option label / "Not set" |
| `user` | `users.id` / `null` | user picker (FORWARD) | zero-or-one user; an existing user id from a core **permission-filtered** picker once that exists; never an array; never grants access. No core user-field check today — the add-on hook must reject wrong shapes | no | avatar + name / "Unassigned" |

Notes:

- `options[].value` strings are permanent; labels are editable. Removing an option does not delete
  stored values — display a neutral "value (removed option)" chip and fail validation for that field
  on the next save/Inbox exit until a valid option is chosen.
- `optionsSource: 'users'` is select-with-dynamic-users; the separate `user` type is the zero-or-one
  reference used by Assignee. `user` fields carry neither `options` nor `optionsSource` (the registry
  rejects both; the picker list is core-provided at render time). There is no generic user picker in
  the MVP UI yet — the type and validation rule exist, the control is FORWARD (§6/§7).
- `defaultValue` applies to new projects only and must never overwrite a stored value.
- Assignment via a `user` field **never grants project access** (product.md §6/§7). The value may point
  at a user who cannot read the project; the compact renderer shows the value only to viewers who can
  already read the project, and no permission row is ever created by an add-on.

### 4.1 Validation pipeline (current implementation)

There are two pipelines today: Inbox exit and value save. Both share the same hook signatures and core field checks.

**Implemented — Inbox exit** (`src/server/domain/addon-hooks.ts`,
`assertInboxExitAllowed(db, projectId)`), called before the transition writes:

```
list registry add-ons
  -> for each add-on, in registry insertion order:
       values = projects.addon_data[<identifier>] ?? {}
       mode   = addons.mode, default definition.defaultMode, else 'optional'
       run  hooks.beforeLeaveInbox({ projectId, values, mode })   (if defined)
       then hooks.validate({ projectId, values, mode })           (if defined)
  -> aggregate every issue from every add-on (all add-ons are evaluated; no early exit)
  -> any issue: throw DomainError(422, 'addon_validation', joined messages,
                 fields = { <issue.field>: <message> })
  -> otherwise continue with the caller's write transaction
```

The gate is invoked from exactly these paths, all before the write:

| Path | Call site |
|---|---|
| Inbox release | `src/server/domain/inbox.ts` → `releaseInboxProject` (before clearing `inbox`) |
| Status change while `inbox = 1` | `src/server/domain/projects.ts` → `updateProject` |
| Status change via reorder while `inbox = 1` | `src/server/domain/projects.ts` → `reorderProject` (a duplicate gate call found at review is being removed — AR-053; harmless while the registry is empty) |
| Move while `inbox = 1` | `src/server/domain/projects.ts` → `moveProject` and bulk `moveProjects` (once per moved project) |
| Workflow remap of an Inbox child | `src/server/domain/workflow.ts` → `replaceWorkflow` (per remapped child with `inbox = 1`) |

Actual semantics to rely on:

- Both `beforeLeaveInbox` **and** `validate` run on an Inbox exit, in that order, for every
  registered add-on. `beforeLeaveInbox` is not "exit-only" in the core's eyes: it is simply called
  first, then `validate`. An add-on that puts exit-only checks in `validate` will also run them
  during the exit.
- The gate is not mode-filtered by core: every registered add-on's hooks run, and the add-on
  receives `mode` so it can decide whether it applies. Mode is read from the synced `addons` table
  (default `optional`), so a Required add-on whose hook checks `mode === 'required'` blocks as soon
  as an Admin selects Required.
- `skip_inbox` needs no special case: the gate is only called when the project is actually exiting
  the Inbox (`inbox = 1`), and skip-Inbox children never enter it.
- The gate throws `422 addon_validation` (not `409 ADDON_VALIDATION_FAILED`); `fields` only contains
  entries for issues that set `field`. There is no namespacing of field keys by core today —
  duplicate field names across add-ons overwrite each other in the error map (a contract gap when
  more than one add-on ships).
- A throwing hook is isolated per add-on: it is logged and converted to a `422 addon_validation`
  failure rather than a 500 (implemented in the gate and the value endpoint).

**Implemented — value save** (`PATCH /api/projects/:id/addons/:identifier`, §3.2): core field-type
checks → `hooks.validate` → merge/audit/FTS → commit. The generic project-page editor calls this
endpoint, so controls and "validate on every save" are live.

Hook rules that hold today:

- Signature: `(ctx: { projectId, values, mode }) => AddonValidationIssue[]`; **empty array = valid**.
- Synchronous and pure: the context carries **no database handle, no query helper, no network**.
  Anything needing a lookup (does this user exist?) is core field-type validation or the
  `user`/`optionsSource` resolution, never the hook. The core checks run before `validate`, and
  `validate` runs on every save and on every Inbox exit.
- Issues are displayed by the calling handler as a form-level message; the API error map is
  `<issue.field>: <message>`. Messages must be sentences, actionable, no stack traces or internal ids.

### 4.2 Required before Inbox exit, and skip-Inbox

The gate is real and wired, but it is intentionally narrow and partly inert until the first add-on
ships.

**What is wired** — `assertInboxExitAllowed(db, projectId)` in
`src/server/domain/addon-hooks.ts` (the hook runner lives with the domain commands that call it; the
contract types live in `src/server/addons/`), called before the write by:

```
releaseInboxProject            (inbox.ts)
updateProject  (status change) (projects.ts)
reorderProject (status change) (projects.ts)
moveProject / moveProjects     (projects.ts; one call per moved Inbox project)
replaceWorkflow (remapped child)(workflow.ts)
```

The function loads every registered add-on (`listAddons()`), reads the project's
`addon_data[identifier]`, resolves `mode` from the `addons` table with default `'optional'`, calls
`hooks.beforeLeaveInbox` **then** `hooks.validate` for that add-on, aggregates all issues, and
throws `DomainError(422, 'addon_validation', …)` with an optional `fields` map. A throwing hook is
logged and converted to the same 422 envelope. The Assignee add-on is registered, so its
`beforeLeaveInbox` gate is live when the global mode is `required`.

Rules that are true today:

- Release (Inbox → same start status) and "change status out of Inbox" both pass the gate; neither
  path bypasses it. Status changes that do **not** exit the Inbox (project `inbox = 0`) do not call
  it.
- `skip_inbox` parents create children with `inbox = 0`, so the gate is never called for them and
  Required fields are optional there (build-spec §6.1). No core special case is needed.
- A blocked exit leaves no partial write: the gate runs before the caller's transaction starts.
- After a project leaves Inbox there is no required-field gate for ordinary edits, Kanban moves or
  later status changes.
- Status changes from a collection view use the same `updateProject`/`reorderProject` paths, so
  they are gated too.

**Implemented:** registry↔table sync and the `/settings` mode surface (§3.4); project-level
enablement/inheritance (`projects.settings.addons`); the generic value editor/endpoint; and
per-add-on hook isolation (a throwing hook becomes a `422 addon_validation` failure, not a 500).

**What is still missing / FORWARD:**

- **Project-level required under `Available`** has no storage key in the shipped contract (§2.3);
  only the global mode can require fields. Do not put a `required` flag in add-on-owned `settings`.
- The gate is not transactional with the caller's write (it runs before `db.transaction` starts).
  That is safe while hooks are pure and reads happen in the same single-threaded process, but a
  future async/fallible hook must not be added there.
- Duplicate field names across add-ons still overwrite each other in the error map — a §11
  follow-up when more than one add-on ships.
- A per-add-on client renderer registry and dashboard-widget consumer are still FORWARD (§6/§7/§9).

Do not put validation logic anywhere except `hooks.beforeLeaveInbox` / `hooks.validate` when they
are expanded; and do not assume `validate` is save-only (it runs on exit too).

---

## 5. Project settings and the settings UI contract

Storage is §2.1/§3.2. The application mode surface and the project enable/inherit surface are
implemented in `/settings` and `/p/[id]/settings?tab=addons`. Per-add-on **settings controls** remain
FORWARD (the contract has no settings-control type; Assignee has no global setting):

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
- Project settings (`/p/[id]/settings?tab=addons`, implemented): Enable for this project (hidden
  for Required/Always on), Inherit from parent, the add-on's project settings when a settings control
  exists, and inherited-state display. The tab is hidden while the registry is empty.
- Value editing happens at the project page/view slots only; settings panels never edit values.

---

## 6. Project page placement — main / sidebar (partially implemented)

The shipped generic project-page editor renders an "Add-ons" card from `AddonDefinition.fields`; it
is not per-add-on placement and there is still no `projectPage.sidebar` slot in the contract. Before
an add-on needs a specific main/sidebar slot, extend the contract once:

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
- **Main** is the project **Details** card: an add-on field renders there when the project layout
  places its `addon:<identifier>:<fieldKey>` reference in `main`. There is no standalone add-on card;
  it must not take over layout or hide title/status/reporter.
- Placement in a **layout template** is core-controlled (visible fields and order, `main | sidebar |
  hidden`). The add-on contributes the field and renderer; the project decides whether/where it
  appears. No freeform builder (product.md §3) and no arbitrary property-count limit.
- No component fetches data itself, imports `src/server/**`, mutates permissions, or bypasses
  `onSave`. Viewer/trashed/unavailable → render read-only or hidden, never a disabled form implying
  access.

---

## 7. Compact renderer for Kanban / Card / Tree / List

**Implemented contract (types only):** `AddonDefinition` has a **single** optional renderer key,
not a per-view map:

```ts
compactRenderer?: string; // UI key, e.g. 'assignee.compact'
```

There is **no add-on renderer registry and no consumer of this key in the core UI yet**. Add-on
field values selected in a view's property list now render through the core field-type default
below; `compactRenderer` remains a forward contract. The four collection views look up the selected
`addon:<identifier>:<fieldKey>` refs on each project card, but never call into add-on code. Adding a
custom renderer is therefore FORWARD core plumbing, not a per-view special case.

The implemented add-on field types (checked by `registry.ts` shape rules) are
`boolean | number | text | longtext | date | select | user`; `select` must have static `options` or
`optionsSource: 'users'`, and `user` must have neither. The generic field control and compact
renderer both switch on `type`, not on an add-on identifier; the "compact default" column in §4
describes that shipped field-type fallback.

When the core UI bridge is built (FORWARD), one renderer key is resolved per add-on and receives:

```ts
type CollectionViewKey = 'kanban' | 'card' | 'tree' | 'list';

interface AddonCompactProps {
  readonly addonId: string;
  readonly fieldKey: string;
  readonly value: AddonFieldValue;
  readonly values: Readonly<Record<string, AddonFieldValue>>;
  readonly view: CollectionViewKey;
  readonly projectId: string;
  readonly readOnly: boolean;                    // the slot's state, not "Tree/List are read-only"
  readonly density: 'comfortable' | 'compact';
  readonly onChange?: (fieldKey: string, value: AddonFieldValue) => void; // absent = read-only slot
}
```

Rules for that future bridge:

- **No data access.** No fetch, no effects loading data, no server imports. Props in, pixels out.
- **One visual line** in compact density; clamp with ellipsis, do not grow cards/rows. Unlimited
  configured fields simply stack; an add-on must never impose a property-count limit.
- **Null-safe.** `null` renders a quiet "Not set"/dash, never an empty clickable area.
- **Interactive only when `onChange` is provided.** `onChange` would be core-supplied and already
  permission-checked; an add-on must not call the API itself. This is about add-on slots only: in the
  shipped core views, **Tree status controls and the List finish checkbox are editable by writers**
  (read-only for Viewers/trashed projects). Do not describe the core Tree/List as read-only.
- **Tokens only:** existing CSS tokens for colour/spacing/radius/type; no hard-coded hex, no new icon
  family; contrast ≥ 4.5:1; icon buttons need `aria-label`.
- **Fallback:** absent/unresolved `compactRenderer` → core field-type default (checkbox chip, number,
  clamped text, date, select/user label). Omit a renderer unless the default is wrong for the view.
- **Per-view keys are not implemented.** The single key must branch on `view`/`readOnly`. If the first
  add-on genuinely needs different renderers per view, extend `types.ts` to
  `compactRenderer?: Partial<Record<CollectionViewKey, string>>` centrally (a contract change, not an
  add-on-local convention).

---

## 8. Search exposure

Declare searchable field keys in `definition.searchFields: string[]`. Only `text` and `longtext`
fields may be listed.

**Implemented:** `src/server/domain/project-addons.ts` computes the body from effectively available
add-ons only and calls `indexProject` inside the value-write transaction. It reindexes the affected
subtree on project enable/inherit changes, every project on application mode changes, and the whole
installation at startup (`syncAddonRegistryAndSearch`). `registry.ts` rejects non-`text`/`longtext`
`searchFields`. Assignee deliberately declares `searchFields: []` (§12.4).

The generic search bridge is implemented centrally (not per-add-on):

1. Every add-on value write computes the body from `addon_data` using the available add-ons'
   `searchFields` and calls `indexProject` inside the same transaction.
2. Add-on-aware FTS maintenance replaces the old `body: ''` writes on title/status rename, reorder,
   move, Inbox release/reparent, workflow remap and restore; project configuration changes reindex
   the affected subtree, application mode changes reindex every project, and startup repairs the
   whole installation (`syncAddonRegistryAndSearch`).
3. `registry.ts` rejects a `searchFields` entry whose field is not `text`/`longtext`, and the bridge
   only indexes available add-ons.
4. Privacy: when an add-on becomes unavailable, search is reindexed without its text. The stored
   value remains in `addon_data` but is unsearchable.

The query path itself is implemented: FTS5 prefix tokens, escaped syntax, trash excluded, archived
follows `show_archived`, and results are permission-filtered before titles/snippets are returned.
Add-on code never receives the FTS table or query; it only declares `searchFields`. Snippets are
core-owned (title match today; bounded escaped excerpt with a field label once add-on text is
indexed).

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
  not registered right now (add-on unregistered, mode `unavailable`, code/UI skew) are **preserved**
  and hidden from Home; they keep their slots across reorder/save, and only an explicit **Restore
  defaults** drops them. This is implemented: `src/lib/types.ts#parseDashboard` accepts any non-empty
  id (max 64 chars) and preserves unknown ids/order; the write path
  (`users.normalizeDashboardPreference`) shape-validates unknown ids and appends missing known
  widgets as hidden; the Home renderer and editor filter to `isKnownDashboardWidgetId`
  (`src/components/dashboard/Dashboard.tsx`). An "unavailable widget" row with an explanation is
  **not** rendered yet — the current editor shows known widgets only — so that affordance belongs to
  the future generic dashboard-widget bridge. No parser work remains.
- When the add-on is `unavailable`, the widget is absent from Home even if projects hold values. When
  `optional` but not enabled for any project the viewer can read, the loader returns an empty list
  (no stale values).
- Loaders use core-filtered queries, respect `show_archived`, never include trashed projects; totals
  are counts of the filtered set.
- A loader that throws produces a **widget-local error with Retry**; it must not disable the rest of
  Home. Renderers are core-owned list rendering (`label`/`href`/`meta`), so add-ons do not ship
  arbitrary widget UI in the MVP — a deliberate constraint, not a missing feature.
- Widgets link to existing core surfaces. Add-ons must not add a top-level route or navigation entry.

**Core widgets are not registry-backed.** `src/server/domain/dashboard.ts` hard-codes `inbox` and
`recent` with payload builders (`getInboxWidget`, `getRecentWidget`), `DASHBOARD_WIDGETS` is a fixed
tuple in `src/lib/types.ts`, `/api/dashboard?widget=` rejects any id outside that tuple, and
`AddonDashboardWidget` currently has **no consumer** (no code calls `listAddons()` for widgets). An
add-on dashboard widget is therefore FORWARD, and the deferred "Completed last week" widget (§13) is
**not** a registration-only change: it needs a small generic core bridge — a widget registry/payload
dispatch, the editor/renderer entry (currently known-id filtered), the default order, and removal of
the fixed-tuple assumption. No schema migration is involved, but it is core code, not just a
definition.

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

**Hooks implemented today:** `validate`, `beforeLeaveInbox` and `onProjectPurge`. Both validation
hooks are invoked together by `assertInboxExitAllowed` on Inbox exit (§4.1/§4.2) and by the value
save endpoint. `onProjectPurge` runs inside the purge transaction before the core cascade; a throwing
purge hook is logged and isolated. Migrations, mode-change and install hooks are still FORWARD
(§3.3). The dashboard widget loader (`AddonDashboardWidget.load`) still has **no consumer** (§9).

```
startup        -> manifest registers each add-on in a per-add-on try/catch: IMPLEMENTED
                  sync addons rows + reindex search: IMPLEMENTED
                  compatibility check + add-on migrations: FORWARD
value save     -> core type-check -> hooks.validate -> merge/audit/FTS -> commit: IMPLEMENTED
inbox exit     -> hooks.beforeLeaveInbox then hooks.validate -> clear inbox/status/audit -> commit: IMPLEMENTED
                  (gate runs before the caller's transaction starts)
mode change    -> update mode + reindex: IMPLEMENTED; onModeChange hook: FORWARD
project purge  -> onProjectPurge, delete add-on rows/values: IMPLEMENTED
```

Isolation rules (target) and current reality:

1. **Validation never writes.** True: the hook context has no DB/query/network. A hook that
   **throws** is caught per add-on, logged and converted to a `422 addon_validation` failure.
   Aggregation across add-ons is implemented (all registered add-ons are evaluated before failing).
2. **Transactional hooks.** The Inbox gate runs before the caller's write transaction.
   `onProjectPurge` runs inside the purge transaction and is isolated per add-on; future
   in-transaction hooks (`onModeChange`, `onInstall`) must roll back on throw and be isolated too.
3. **Post-commit work is not a hook.** Notifications/external calls and anything fallible belong
   outside the transaction; add-ons must not add network I/O inside hooks (it blocks SQLite's writer
   and the Node event loop).
4. **Read-side failures are local.** FORWARD: there is no add-on widget/renderer consumer, so there
   is nothing to isolate yet. The intended behaviour is dashboard-widget error + Retry and a compact
   renderer fallback plus logged identifier.
5. **Time budgets.** Hooks run synchronously in a request; keep them O(fields), no scans outside
   namespaced data. A long hook delays the Inbox-exit request.
6. **No capability escalation.** The hook context deliberately omits permission helpers, the session
   and core mutation functions; `AddonWidgetContext.visibleProjectIds` is core-computed and must
   never be expanded (read-only invariant, §9). This is enforced by type shape, not only by review.

**Known gaps:** add-on field keys from multiple add-ons are not namespaced in the error map,
`onModeChange`/`onInstall` are still FORWARD, and read-side widget/renderer isolation has nothing to
wrap until the dashboard and compact-renderer bridges ship.

An add-on **must not bypass core invariants** (product.md §9). It cannot change a project's status,
inbox flag, parent, archived/trash state, priority or roles; write/suppress audit; mark a required
field complete without a value; make a trashed project writable or a Viewer a writer; or return
inaccessible projects from search/dashboard.

---

## 12. Worked example: the Assignee add-on (shipped)

Assignee is specified in product.md §7 and shipped by issue #7 as the reference exercise for the
contract: zero or one assignee per project, optional by default, application- and project-level
availability, a required Inbox-exit gate, real **Details/Properties/view-property layout field
slots** with a small edit dialog, and an **Assigned to me** dashboard widget definition. Building it
added **no** `identifier === 'assignee'` branch to core; the definition lives only in
`src/server/addons/assignee/` and registers through the manifest. Field-type-default compact values
ship in all four collection views; the per-add-on `compactRenderer` bridge and dashboard-widget
consumer remain FORWARD (§7/§9).

It exercises every current type: the `user` field (zero-or-one), `hooks.validate` and
`hooks.beforeLeaveInbox` (both wired at Inbox exit), the generic project-page editor and settings
surfaces, `compactRenderer` (declared but still no core consumer), and `dashboardWidgets` (declared
but still no consumer).

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
      label: 'Assigned to',
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
      // Both hooks run on every Inbox exit (beforeLeaveInbox, then validate).
      // Mode defaults to 'optional' until the registry<->addons-table sync lands,
      // so this only blocks once an admin row with mode 'required' exists.
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

No add-on-specific core file changes; generic plumbing lives in core. v1 stores values in
`addon_data` (no table, no migration). If a later version
adds a table, it adds `migrations: [{ id: 'assignee/001_scope', up: ctx => ctx.exec('CREATE TABLE …') }]`
with `REFERENCES projects(id) ON DELETE CASCADE`.

### 12.2 Validation hooks

- Zero-or-one is inherent in one `user` field. The core value endpoint now rejects arrays and
  non-existing user ids, and the add-on hook still rejects blank/wrong-shaped values. The picker is
  core-provided from the account list; assignment never grants access.
- Requirement is resolved, not assumed: `mode === 'required'` is the only source, read from the
  synced `addons` table (default `optional`). Project-level requirement still needs the FORWARD §2.3
  contract. Do not put a `required` flag in `settings` (add-on-owned settings are not a place for
  core policy).
- Both `beforeLeaveInbox` and `validate` run on an Inbox exit, `beforeLeaveInbox` first. Keep the
  required check in `beforeLeaveInbox` (and note `validate` runs on exit too); an add-on that returns
  required errors from `validate` still blocks, but is harder to reason about.
- **Assignment never grants access.** The hook adds no project roles; renderers show the assignee only
  to viewers who can already read the project. If the assignee loses access, the value stays; their
  "Assigned to me" query no longer returns it.
- Skip-Inbox children never run the gate.
- Deleting/deactivating the assigned user does not delete the value: display "Former member", fail the
  next Inbox-exit validation that requires it until reassigned.

### 12.3 Compact renderer

```tsx
// src/addons/assignee/components.tsx  ('use client')
export function AssigneeCompact(props: AddonCompactProps) {
  if (props.value == null) return <span className="muted">Unassigned</span>;
  return <span className="chip"><Avatar userId={String(props.value)} size={16} />{props.label}</span>;
}
```

- registration key `assignee.compact` (the single `compactRenderer` string; there is no per-view map
  and **no core renderer registry/consumer yet**). When the bridge lands the renderer receives
  `view`/`onChange`; it should offer inline edit only when `onChange` is provided and otherwise render
  read-only. This says nothing about the core views: in the shipped app, Tree status controls and the
  List finish checkbox remain editable for writers.
- one line, clamps with ellipsis; null → muted "Unassigned"; no fetch — user label/avatar data must be
  supplied by core props (extend `AddonCompactProps` with a core-resolved user/option map when the
  bridge lands; never fetch inside the renderer).
- no avatar when the user cannot be shown (deleted user → "Former member").

### 12.4 Search exposure

`searchFields: []` in v1. User ids are opaque and display names are identity data already reachable
through project membership; indexing them would create surprising snippets and a privacy question.
An "assigned to me" query is a filtered surface (the dashboard widget), not FTS. If search filtering by
assignee is wanted later, add a core search filter parameter, not a fake searchable text field.

### 12.5 Settings UI

- **Implemented:** `/settings` Add-ons section = mode radio (Required / Always on / Available /
  Unavailable) with the Unavailable retention explanation; `/p/[id]/settings?tab=addons` = Enable for
  this project (Optional mode only), Inherit from parent, inherited-state text. There is no global
  Assignee setting in v1.
- **Implemented generically:** the project page renders an "Add-ons" card with the field controls from
  the definition (the Assignee `user` field uses a core-provided account picker). A Viewer or a
  trashed project sees values read-only. There is no per-add-on `projectPage.sidebar` renderer slot;
  that finer placement remains FORWARD.
- Dashboard editor: FORWARD — no add-on widget consumer exists (§9), so "Assigned to me" cannot appear
  until the generic widget bridge is built. Preference preservation is already implemented, so a saved
  entry survives until then.

### 12.6 Dashboard widget

**FORWARD:** `AddonDashboardWidget.load` has no consumer in the MVP; this loader is the contract the
generic bridge must call with a read-only `AddonWidgetContext` (not wired today). Target shape:

```ts
// loader using the read-only context contract
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

Coverage added by issue #7: `tests/integration/api-addons.test.ts` (sync, modes, inheritance,
value writes, permissions, audit, search, required gate), `tests/integration/addon-purge.test.ts`
(purge hook + isolation), `tests/unit/addons-manifest.test.ts`, and
`tests/e2e/addons.spec.ts` (enable → save → persist → hide/restore). Items below that depend on a
FORWARD surface (compact renderer, dashboard consumer) remain future tests.

| # | Test | Expected |
|---|---|---|
| A1 | `user` field validation | array/blank rejected by the add-on hook; the gate returns 422 `addon_validation` (not 409) with `fields` set; `null` allowed unless required |
| A2 | Required mode | Inbox release blocked; status change/move/workflow-remap out of Inbox blocked; no partial write. Requires an `addons` row with mode `required` — with no row the resolved mode is `optional` and this test will not block. |
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
| A14 | Compact renderer | null → "Unassigned"; one line; no fetch; when no core consumer exists the key is inert (bridge test is FORWARD) |
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
| Dashboard preference | `users.dashboard` JSON already stores an ordered widget-id list (`[{"id":"inbox","visible":true},{"id":"recent","visible":true}]` by default). Unknown ids/order are already preserved by `parseDashboard`, the write path and the editor (only an explicit Restore defaults drops them), so a preference for this widget survives absence and returns intact. |
| Counting data | `audit_events` records project changes while the project exists (append-only, actor/timestamp). Status-change events now carry `detail` JSON `{ fromId, toId }` alongside the display names (`projects.ts`, `workflow.ts`), so a transition into the parent's finish status is reliably derivable. Count: distinct live readable projects in the previous calendar week. No new column, no event-store table. |
| Permissions/archival | The loader uses the same permission-filtered access set and `show_archived`/trashed filters as every dashboard query. |
| Registration | **Not registration-only today:** core widgets are hard-coded in `src/server/domain/dashboard.ts`, `DASHBOARD_WIDGETS` is a fixed tuple, and there is no add-on widget consumer. The return needs a small generic bridge: a widget definition/payload dispatch (core widget registry or extended tuple), the editor/renderer entry, the default-order entry, and remove the fixed-tuple assumption. That is core code, not schema. |
| Purge | Purged projects lose their own audit events, so they naturally leave the count; no tombstone needed. |
| Defaults | `restore defaults` writes the build default list (`DEFAULT_DASHBOARD` today, or the generic widget registry's default order after the bridge). The widget is omitted while unregistered and appears when added; keep its default position in the core definition. |

Counting semantics to fix when it returns (dashboard.md decisions): count **distinct projects** that
entered their parent's finish status during the previous calendar week, not transitions; a project
reopened and re-completed inside the window counts once; only live/readable/not-trashed projects;
archived follows `show_archived`; a count, not a chart.

**Counting dependency — satisfied:** the MVP audit now records status names plus
`detail = {"fromId": <old status id>, "toId": <new status id>}` and the timestamp in the project's own
log (update/reorder/move/bulk-move/workflow-remap paths; AR-033 resolved), so reliable finish-status
transition counting is possible without any event-schema change. Keep the names for display and use
the ids for the calculation. Add a test that a renamed status still counts correctly (proving the id
is authoritative).

Reintroduction checklist: add the widget to the dashboard module's dispatch (generic bridge, §9) →
add it to the default order behind Inbox/Recent changes → implement the loader with the filters above
→ editor/renderer recognises the id (unknown-id preservation already works) → tests for permission
filtering, UTC week boundary, reopen/recomplete, purge, preference preservation while unregistered →
update this section. No migration, no new table, no `users.dashboard` shape change; yes to a small
core code change.

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
- [ ] Field types declared per the current contract (generic core controls/validation are FORWARD);
      hooks pure/sync, no DB/network; throwing-hook isolation is FORWARD (today a throw is a 500).
- [ ] Required gate only through the core Inbox-exit path; `skip_inbox` exemption; no gate elsewhere.
- [ ] Every read (page, compact, search, dashboard) permission-filtered server-side and respects
      `show_archived`/trash; the access set never expanded; no client-side filtering. (Core currently
      filters in the domain process, not SQL.)
- [ ] Availability changes hide values, never delete them; unregistering leaves data intact.
- [ ] Search (FORWARD wiring): only effectively available `searchFields` indexed; reindex on
      availability/mode change; no snippets from hidden values.
- [ ] Dashboard widget (FORWARD: no widget consumer yet): one instance, preference preserved when
      unavailable, local error Retry, no new top-level route, item-only output.
- [ ] Renderers: client-only, no data access, null-safe, one line compact, tokens only, a11y labels,
      fallback when key unresolvable.
- [ ] Migrations (FORWARD): namespaced, forward-only, idempotent, tested on a real DB copy, non-
      destructive, backup/rollback documented, compatibility range added centrally.
- [ ] Inbox gate runs before the caller's transaction; future transactional hooks roll back on throw;
      no post-commit work; no capability escalation.
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
