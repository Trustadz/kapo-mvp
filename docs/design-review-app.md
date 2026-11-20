# Kapo MVP — independent design review (running app vs Penpot design)

Reviewed 19 November 2026 against `docs/build-spec.md` §1/§3/§8, `design-handoff.md`, `design-review.md`,
the Penpot exports in `docs/reference/`, and the live Penpot file (frame text/style extraction).
The app was reviewed as a **production build** (`next build` + `next start`) on port 3401 against a
snapshot copy of `data/kapo.db` (the running demo on 3400 was left untouched). State that the review
needs but the seed does not contain (archived project, trash actions, read-only trashed project,
hidden dashboard, widget failure) was created in the snapshot only; the 500-error screen was produced
by breaking the snapshot's search index, again in the snapshot only. No application code was modified.

Viewports: **1440×1000** and **390×844**, light and dark (dark via `prefers-color-scheme: dark` with the
seeded "System" appearance). Screenshots: `docs/screenshots/` (98 captures). The design exports in
`docs/reference/` are partly stale relative to the locked scope — Home/Tree still show the cut
`Completed last week` widget and the Inbox export uses an older fixture — so comparisons below focus on
layout, tokens, copy and states, not on fixture content.

**Verdict: no blockers. 7 major and 18 minor findings.** The shell and token layer are strong and
consistent; the biggest gaps are (1) lowercase account names shown raw across the UI, (2) Kanban columns
lacking the designed panel treatment, (3) contradictory Members copy, (4) a broken search/trash input on
mobile, (5) the absence of the designed error state, (6) un-grouped Trash, and (7) low-contrast
placeholder text.

---

## Major findings

### F01 — Account names are shown raw and lowercase everywhere · **Major**

- **Screens:** sidebar account block (all pages), Profile, project Properties/Details, Activity, Users,
  project Members, Trash.
- **Evidence:** [app-home-desktop-light.png](docs/screenshots/app-home-desktop-light.png),
  [app-profile-desktop-light.png](docs/screenshots/app-profile-desktop-light.png),
  [app-project-kanban-desktop-light.png](docs/screenshots/app-project-kanban-desktop-light.png),
  [app-project-settings-members-desktop-light.png](docs/screenshots/app-project-settings-members-desktop-light.png),
  [app-users-desktop-light.png](docs/screenshots/app-users-desktop-light.png),
  [app-trash-readonly-project-desktop-light.png](docs/screenshots/app-trash-readonly-project-desktop-light.png).
- **Expected (reference):** display names are title-cased: sidebar/account menu show **“Admin”** with
  **“Application Admin”**; Profile identity and Username field show “Admin”; Reporter “Admin”;
  Activity “Maya renamed the project”, “Jules created Paint hallway”; Members rows “Admin/Maya/Jules”.
- **Actual:** the raw `username` column is printed unmodified: sidebar “admin”, Profile “admin”,
  Username field “admin”, Reporter “admin”/“maya”/“jules”, Activity actors “maya renamed the
  project”, Members rows “alex/jules/maya/admin”, Users list “alex/jules/maya/admin”. The account
  menu also omits the designed “Application Admin” role line. Recent changes already capitalises
  (“Maya updated…”, “Admin created…”), so the UI is internally inconsistent.
- **Fix:** add a client-safe `displayName(username)` helper (`src/lib/format.ts`, first grapheme upper-cased)
  and use it for every read-only identity: `Sidebar`/`AccountMenu` (`AccountMenu.tsx:118`),
  `ProfileForm` identity (`ProfileForm.tsx:213`), `ProjectView` reporter (lines 69, 259),
  `ProjectSettingsPage` member names, `UsersManager` rows/toasts, `ActivityPanel` actor label. Add the
  role line (“Application Admin”) to the account menu header per **01 · Overview · Account menu**.

### F02 — Kanban columns are missing the designed surface panel · **Major**

- **Screen:** Root and project page — Kanban (also the base column treatment used by drag-over).
- **Evidence:** [app-project-kanban-desktop-light.png](docs/screenshots/app-project-kanban-desktop-light.png),
  [app-root-desktop-dark.png](docs/screenshots/app-root-desktop-dark.png) vs
  [docs/reference/root-desktop-light.png](docs/reference/root-desktop-light.png).
- **Expected (reference):** each status column is a rounded `surfaceAlt` panel (`#F7F6F2` light /
  `#1F2420` dark) inset 12px, spanning header + cards, with white 1px-border cards inside (reference
  column panel x=276–630, card inset 12px, radius 12).
- **Actual:** the column is transparent (`views.module.css .column` sets only padding-8 with negative
  margin and a radius used for the drag outline). Cards float directly on the cream canvas; the only
  panel appears during a drag (`[data-over]`). This makes Kanban read as three loose card stacks instead
  of the designed columns, and the dark screen loses the designed column separation entirely.
- **Fix:** in `src/components/views/views.module.css`:
  `.column { background: var(--color-surface-alt); padding: var(--space-3); border-radius: var(--radius-md); margin: 0; }`
  and remove the negative margin; keep `[data-over]` as the brand outline. Verify column gap 24px
  (`reference` measures ~29px between panels; 24px is within the 4px scale).

### F03 — Members: access rows contradict the selected access mode; designed copy/flow missing · **Major**

- **Screens:** project settings → Members (inherited project, custom/private project).
- **Evidence:** [app-project-settings-members-desktop-light.png](docs/screenshots/app-project-settings-members-desktop-light.png),
  [app-project-settings-members-private-desktop-light.png](docs/screenshots/app-project-settings-members-private-desktop-light.png),
  [app-project-settings-members-desktop-dark.png](docs/screenshots/app-project-settings-members-desktop-dark.png).
- **Expected (Penpot 08 · Settings · workflow & permissions → 02 Members, 03 Private access):** radios
  **“Inherit parent permissions”** / **“Custom access”**, a checked **“Private — only selected members”**
  state, a compact member list of **name + role** (“Admin  Admin”), an **Add member** action and a
  **Save permissions** button. No per-row “Custom access” annotation is shown.
- **Actual:** with **“Inherited from parent”** selected, every row says
  “Application admin · **Custom access (Admin)**”, “Application user · **Custom access (User)**” (because
  the seed grants explicit roles). This literally contradicts the selected access mode. Additional
  deviations: radio copy is “Inherited from parent” (not “Inherit parent permissions”); the private state
  is represented by a destructive **“Make private”** button that is still shown on the already-private
  Personal project; there is no “Private — only selected members” state and no “Add member” flow; the
  footer says “Save members”. Dark mode inherits the same copy.
- **Fix:** in `ProjectSettingsPage.tsx` `MembersTab` render the row meta only for the active mode:
  `access === 'inherit' ? `Inherited: ${ROLE_LABELS[inherited] ?? 'No access'}`` and show
  `Custom access (${role})` only when `access === 'custom'` (or simply drop the meta line and show the
  role select, as designed). Rename the radio label to “Inherit parent permissions”, add the design’s
  “Private — only selected members” checkbox/state, hide “Make private” when the project already has
  ≤1 explicit grant, and align button copy with “Save permissions”.

### F04 — Mobile Search/Trash filter input collapses to 19px · **Major**

- **Screens:** Search and Trash at 390×844 (light and dark).
- **Evidence:** [app-search-results-mobile-light.png](docs/screenshots/app-search-results-mobile-light.png),
  [app-trash-mobile-light.png](docs/screenshots/app-trash-mobile-light.png),
  [app-trash-mobile-dark.png](docs/screenshots/app-trash-mobile-dark.png).
- **Expected (design + build-spec §8):** 42px input on mobile (reference frames use a 42px field), as on
  desktop.
- **Actual:** measured input height **19px** (mobile) vs **42px** (desktop). The placeholder is clipped
  vertically and the field reads like a thin divider; only the 40px Search button below it has normal
  height. Cause: `search.module.css` `@media (max-width:899px) .searchForm { flex-direction: column }`
  combined with `.searchInput { flex: 1 }` — the zero flex-basis collapses in the column layout.
- **Fix:** in `src/components/search/search.module.css` add to the mobile block:
  `.searchInput { flex: 0 0 auto; width: 100%; height: var(--input-height); }` (or set the Input
  component’s `height`/`min-height` in the same rule). Re-check Trash, which shares the form.

### F05 — No designed error state; failures drop out of the app shell · **Major**

- **Screens:** Search (and all `/p/*`, `/inbox` pages by inheritance — no route-level `error.tsx`).
- **Evidence:** [app-search-error-desktop-light.png](docs/screenshots/app-search-error-desktop-light.png),
  [app-search-error-desktop-dark.png](docs/screenshots/app-search-error-desktop-dark.png),
  [app-search-error-mobile-dark.png](docs/screenshots/app-search-error-mobile-dark.png).
- **Expected (Penpot 10 · Search & Trash → 04 Search · Error):** an in-shell state — “Search is
  unavailable / Your query is preserved. Retry when Kapo is available.” with a **Retry** action, header
  and sidebar intact.
- **Actual:** the route throws and the framework default page renders: “This page couldn’t load / A
  server error occurred. Reload to try again. / Reload / ERROR <digest>”, with **no shell, no brand, no
  preserved query, no designed copy**, and no theme variables (page is black/white rather than Kapo
  canvas in dark mode).
- **Fix:** add `src/app/(app)/error.tsx` (client) rendered inside the app layout, mapping the digest to a
  `Notice`-style panel: title “This page couldn’t load”, body copy, and a **Retry** button calling
  `reset()`; for `/search` restore the current `q` from `useSearchParams`. Optionally add a
  `search/error.tsx` with the design’s exact copy “Search is unavailable / Your query is preserved.
  Retry when Kapo is available.”.

### F06 — Trash ignores trash-action grouping, actor and designed deadline/restore copy · **Major**

- **Screen:** Search → Trash tab; Restore dialog.
- **Evidence:** [app-trash-desktop-light.png](docs/screenshots/app-trash-desktop-light.png),
  [app-dialog-restore-desktop-light.png](docs/screenshots/app-dialog-restore-desktop-light.png),
  [app-trash-readonly-project-desktop-light.png](docs/screenshots/app-trash-readonly-project-desktop-light.png).
- **Expected (Penpot 10 → 06 Trash · Projects, 08 Trash · Read-only project):** items grouped by trash
  action: “Renovate basement — Trashed by Maya · 15 Nov 2026 — Purge deadline: 15 Dec 2026 —
  *Also trashed by this action: Find contractor* — **Restore action**”, and a separately trashed
  “Old receipts — Trashed separately · 10 Nov 2026 — Keeps its own deadline…” with its own **Restore**.
  The restore dialog should identify which projects return.
- **Actual:** a flat list in which “Paint hallway”, “Find contractor” and “Renovate basement” look
  identical. Copy is “Trashed 19 Nov 2026 · Permanently removed 19 Dec 2026” (no actor, no action
  grouping, no “Trashed separately” distinction, per-item Restore buttons even for descendants of the
  same action). The restore dialog says only “Restoring undoes this trash action. Only projects trashed
  together with it return…” and never names the projects, so the user cannot confirm what will return.
- **Fix:** group `trashItems` by `trash_action_id` in the `/search?tab=trash` server payload: render one
  card per action whose parent is the earliest-trashed project, list siblings/descendants under
  “Also trashed by this action”, show the actor from `trash_actions`, and change labels to
  “Trashed by {actor} · {date}” and “Purge deadline: {date}”; restore dialog should list the affected
  titles (from the same action group) before the confirm button. Update the page subtitle to the design
  copy “Read-only projects · Permanently removed 30 days after entering Trash”.

### F07 — Placeholder text uses `soft` at ~2.4:1 contrast · **Major**

- **Screens:** global capture, Search/Trash filter, all text inputs (Profile, settings, dialogs).
- **Evidence:** [app-home-desktop-light.png](docs/screenshots/app-home-desktop-light.png),
  [app-search-empty-desktop-light.png](docs/screenshots/app-search-empty-desktop-light.png),
  [app-app-settings-desktop-light.png](docs/screenshots/app-app-settings-desktop-light.png).
- **Expected (reference + build-spec §8 4.5:1):** the design’s capture placeholder “Add a project to
  Root…” is rendered in the **muted** colour; sampled reference pixels are `#65786B` (4.72:1 on white).
- **Actual:** `Input.module.css` placeholder uses `--color-soft` `#9AABA0` → sampled app pixels
  `#9AABA0`; computed contrast **2.41:1** on surface and **2.17:1** on canvas. The same token is used for
  empty-column labels (“No projects”, `views.module.css .columnEmpty`) at 2.17:1.
- **Fix:** `src/components/ui/Input.module.css`: `::placeholder { color: var(--color-muted); opacity: 1; }`
  (4.72:1 on white). For text placed on the canvas (empty column labels), use a darker semantic colour
  (e.g. `--color-text` at the designed muted weight) rather than `soft`; reserve `soft` for icons/dividers.

---

## Minor findings

### F08 — Search empty state is missing · Minor

- **Screen:** `/search` with no query.
- **Evidence:** [app-search-empty-desktop-light.png](docs/screenshots/app-search-empty-desktop-light.png).
- **Expected (Penpot 10 → 02 Search · Empty):** an info empty state — “**Find a project** / Enter a title
  or another available text value to search.”
- **Actual:** only the utility note “Trash is not included in ordinary search.” appears under the input;
  the page reads unfinished.
- **Fix:** in `src/components/search/SearchPage.tsx`, when `tab === 'search' && !query`, render
  `<EmptyState icon="search" title="Find a project" description="Enter a title or another available text value to search." />`
  in place of the results section; change the input placeholder to “Search projects…”.

### F09 — Search results show status badges the design does not include · Minor

- **Screen:** Search results, archived results.
- **Evidence:** [app-search-results-desktop-light.png](docs/screenshots/app-search-results-desktop-light.png),
  [app-search-archived-desktop-light.png](docs/screenshots/app-search-archived-desktop-light.png).
- **Expected (Penpot 10 → 01 Results / 05 Archived):** title, parent context, “Match in Title: …”, and an
  **Archived** badge only when archived.
- **Actual:** an extra status pill (“To do”, “In progress”) is rendered next to every title.
- **Fix:** drop `{result.statusName ? <Badge>{result.statusName}</Badge> : null}` from
  `SearchPage.tsx` result headings (or confirm with design that status is now wanted and add it to the
  design). Keep the archived badge (dashed `archived` tone).

### F10 — Dialog chrome/type differs from the designed dialog · Minor

- **Screens:** Move, Trash, Restore, Add project dialogs (desktop + mobile).
- **Evidence:** [app-dialog-move-desktop-light.png](docs/screenshots/app-dialog-move-desktop-light.png)
  vs [docs/reference/dialog-move-project.png](docs/reference/dialog-move-project.png),
  [app-dialog-trash-desktop-light.png](docs/screenshots/app-dialog-trash-desktop-light.png).
- **Expected (reference dialog, 600×401):** 600px wide surface, ~24px padding, **24px** title, field labels
  at the left gutter with controls at x≈224, footer buttons **left-aligned** with no divider, no close “×”.
- **Actual:** surface 560px (`Dialog.module.css .surface`), title **20px** (measured 18px cap height vs
  reference 22px), footer right-aligned with a full-width `border-top`, and a close “×” added to every
  dialog. Body copy and field labels are correct (e.g. “To do maps to”, “Map explicitly”).
- **Fix:** in `Dialog.module.css`: `.surface { width: min(600px, calc(100vw - 24px)); }`,
  `.title { font-size: 24px; }`, `.footer { justify-content: flex-start; border-top: 0; }`. Remove the
  header close button where the design shows none (keep it for stackable dialogs only if needed).

### F11 — Active tab uses a brandLight fill; reference tabs stay white · Minor

- **Screens:** Search/Trash tabs, project settings tabs.
- **Evidence:** [app-search-results-desktop-light.png](docs/screenshots/app-search-results-desktop-light.png)
  vs [docs/reference/search-desktop-light.png](docs/reference/search-desktop-light.png),
  [app-project-settings-workflow-desktop-light.png](docs/screenshots/app-project-settings-workflow-desktop-light.png).
- **Expected:** both tabs are white surfaces with 1px border; the active tab is distinguished by brand
  text/border only (sampled reference tab fill `#FFFFFF`).
- **Actual:** active tab has `background: var(--color-brand-light)` (`#E8F2EC`) and brand text; inactive
  tabs are white. Applies to search tabs and the Settings tab strip.
- **Fix:** `.tab[data-active] { background: var(--color-surface); border-color: var(--color-brand); color: var(--color-brand-dark); }`
  in `search.module.css` and `ProjectSettings.module.css`; keep the subtle hover on
  `surface-alt`.

### F12 — No-children project renders a dashed “empty collection”; toolbar Add is hidden · Minor

- **Screen:** project page with no child projects (`/p/…/Find contractor`).
- **Evidence:** [app-project-empty-desktop-light.png](docs/screenshots/app-project-empty-desktop-light.png).
- **Expected (design handoff, core interactions):** “Hide the collection and its selector when there are
  no children. Keep Add child project and Activity.” No dashed empty collection.
- **Actual:** the collection area renders a large dashed empty panel “No child projects yet / Break this
  work down into smaller projects” with an Add project button inside it, while the section toolbar’s Add
  button is suppressed. The dashed treatment also collides with the design’s archived-row language
  (dashed = archived).
- **Fix:** in `ChildProjects.tsx`, when `!hasChildren` render only the section header with the Add project
  button (and keep `ActivityPanel`); remove `styles.emptyCollection`. If an empty hint is kept, use a
  plain `EmptyState` with a solid border and no dashed style.

### F13 — Muted text on the canvas is 4.25:1 (below the 4.5:1 requirement) · Minor

- **Screens:** page subtitles and breadcrumbs on the cream canvas (Profile, Inbox, Search, project
  breadcrumb, settings subtitles).
- **Evidence:** [app-profile-desktop-light.png](docs/screenshots/app-profile-desktop-light.png),
  [app-inbox-desktop-light.png](docs/screenshots/app-inbox-desktop-light.png).
- **Expected (build-spec §3/§8):** 14px body/utility text at ≥4.5:1.
- **Actual:** `--color-muted #65786B` on `--color-canvas #F5F3EC` computes **4.25:1** (`#65786B` on white
  is 4.72:1, so only canvas placements fail). The design itself places muted text on the canvas (e.g. the
  Profile subtitle), so this is a token-level issue rather than an implementation slap-dash.
- **Fix:** darken the light-mode muted token to `#5B6D61` (4.97:1 on canvas, 5.52:1 on white) — a change to
  `src/styles/tokens.css` that should be mirrored back into the Penpot `Kapo` token set — or introduce a
  semantic `--color-text-muted-on-canvas` used by `.page-subtitle`, `.breadcrumb`, `.sectionLabel`.

### F14 — Warning badge text is 4.06:1 · Minor

- **Screen:** Kanban/Card/Tree/List “Inbox” badge; warning notices.
- **Evidence:** [app-project-kanban-desktop-light.png](docs/screenshots/app-project-kanban-desktop-light.png),
  [app-project-kanban-desktop-dark.png](docs/screenshots/app-project-kanban-desktop-dark.png).
- **Expected:** small badge text (11–12px) meets 4.5:1.
- **Actual:** `--color-warning #AA6736` on `--color-warning-bg #FFF2E5` = **4.06:1** (the dark pair is
  fine at 6.65:1). Notice body text inherits `--color-text` so only the badge/icon colour is affected.
- **Fix:** darken the warning foreground token to `#94562A` (5.27:1 on `#FFF2E5`) and keep the same
  warning background; alternatively set the badge label to `--color-text` and use warning only for the
  border/icon.

### F15 — Checkbox/radio rendering is native/UA-styled, not token-styled (suspect verified: no “bare tick”) · Minor

- **Screens:** Application settings, Profile appearance, Layout, workflow editor, dashboard editor,
  Members access, List finish checkboxes.
- **Evidence:** [app-app-settings-desktop-light.png](docs/screenshots/app-app-settings-desktop-light.png),
  [app-app-settings-desktop-dark.png](docs/screenshots/app-app-settings-desktop-dark.png),
  [app-project-settings-members-desktop-dark.png](docs/screenshots/app-project-settings-members-desktop-dark.png),
  [app-project-list-desktop-light.png](docs/screenshots/app-project-list-desktop-light.png).
- **Expected (reference form controls):** 16×16 box drawn with the neutral border tokens, ~4px radius,
  brand fill + white check when checked; radio as a 16px ring with a brand dot.
- **Actual:** **The suspected “bare tick glyph with no box” was not reproduced** in Chromium/Linux — both
  controls render as proper boxes/circles with `accent-color: #28614A`. Residual issues: the box is
  purely UA-rendered (`appearance: auto`, `border-radius: 0`, 16px), so in dark mode the unchecked box
  becomes a filled light-grey square rather than a transparent surface with `--color-input-border`; the
  selected radio in dark mode shows a white outer ring. Rendering will also differ on macOS/Safari.
- **Fix:** replace the native look with a design-owned control in `Checkbox.tsx`/`Radio.tsx`: visually
  hidden input + `span` box (`width/height:16px; border:1.5px solid var(--color-input-border); border-radius:4px;
  background: var(--color-surface)`) and `[data-checked]` brand fill/white `check` Material Symbol; radio
  equivalent with `border-radius:50%` and a 6px brand dot. Keep the existing focus-visible outline.
  **Note:** while this review was running, the working tree gained exactly this treatment
  (`Checkbox.module.css`/`Radio.module.css` now use `appearance: none`, 18px, input-border tokens). The
  production build under review predates that change, so re-verify F15 (and the remaining
  `/docs/screenshots` set) after the next rebuild.

### F16 — Favorites always use a folder icon; the design uses per-project icons · Minor

- **Screen:** sidebar Favorites list (all pages).
- **Evidence:** [app-home-desktop-light.png](docs/screenshots/app-home-desktop-light.png),
  [app-project-settings-members-desktop-light.png](docs/screenshots/app-project-settings-members-desktop-light.png),
  [app-home-collapsed-desktop-light.png](docs/screenshots/app-home-collapsed-desktop-light.png).
- **Expected (Penpot 01 · Overview):** Home improvement = `home_repair_service`, Household = `cottage`,
  Personal = `person` (distinct icon per favourite; folder is only the generic fallback).
- **Actual:** `Sidebar.tsx` hard-codes `icon="folder"` for every favourite.
- **Fix:** add an icon to the favourite data (e.g. `projects.settings.icon` or a small deterministic map
  from project title/parent in `src/lib/icons.ts` with `folder` fallback), return it from the layout’s
  `favorites` payload and render `icon={favorite.icon ?? 'folder'}`.

### F17 — Profile “Appearance” radios wrap to two lines on desktop · Minor

- **Screen:** Profile → Appearance (1440 wide only).
- **Evidence:** [app-profile-desktop-light.png](docs/screenshots/app-profile-desktop-light.png).
- **Expected:** Light / Dark / System on one row (as on mobile).
- **Actual:** “System” wraps to a second row. Measured cause: the `FieldGroup` control column resolves to
  **190px** wide (the label-track width) so `.radioRow` (flex-wrap) breaks at 190px; on mobile the field
  stacks at full width and all three fit.
- **Fix:** in `Field.module.css` ensure the control track gets the content width for fieldsets — e.g.
  `.fieldset .control { grid-column: 2; width: max-content; }` (and `min-width: 0`), or give
  `ProfileForm.module.css .radioRow { flex-wrap: nowrap; }` plus enough width. Verify at 1024/1280 as well.

### F18 — Sidebar vertical rhythm is compressed vs the reference · Minor

- **Screen:** expanded sidebar, all pages.
- **Evidence:** [app-home-desktop-light.png](docs/screenshots/app-home-desktop-light.png) vs
  [docs/reference/home-desktop-light.png](docs/reference/home-desktop-light.png).
- **Expected:** brand row ~88px tall; navigation starts at y≈81; divider at y≈288; FAVORITES label at
  y≈304 (1440×1000 frame).
- **Actual:** brand row 72px (brand centred y≈38 vs 47); Home active pill starts y≈73; divider at y≈242;
  FAVORITES label at y≈261 — the favourites block sits ~46px higher than the design, making the top of
  the rail feel crowded while the bottom is empty.
- **Fix:** `Sidebar.module.css`: `.brandRow { height: 88px; }` and `.divider { margin: var(--space-5) 0; }`
  (24px each side) to restore the designed breathing room; re-check the collapsed rail stays 72px.

### F19 — Activity exposes the raw audit field (`project.inbox_released`) · Minor

- **Screens:** project Activity after an Inbox release (e.g. Renovate basement, Home improvement).
- **Evidence:** [app-dialog-move-desktop-light.png](docs/screenshots/app-dialog-move-desktop-light.png)
  (background), [app-trash-readonly-project-desktop-light.png](docs/screenshots/app-trash-readonly-project-desktop-light.png).
- **Expected:** human copy for every event, e.g. “Released from Inbox”, in the design’s event style;
  also the design rows have no per-row 1px rules.
- **Actual:** the row reads “admin updated the project / **project.inbox_released**” — an internal
  action/field name shown to users. Actor names are also lowercase (F01) and each row is separated by a
  1px border (design shows plain rows with spacing).
- **Fix:** extend the activity formatter used by `ActivityPanel`/dashboard recent changes so
  `project.inbox_released` maps to a summary “released it from Inbox” with detail
  “Released from Inbox”; fall back to the human field label (`inbox`, not the action constant) for any
  unmapped pair. Consider dropping `.activityRow { border-bottom }` in favour of the design’s row gap.

### F20 — Content widths diverge from the reference (Inbox too wide, Search too narrow) · Minor

- **Screens:** Inbox (760px column vs reference ~690px); Search results (1040px vs reference ~1146px).
- **Evidence:** [app-inbox-desktop-light.png](docs/screenshots/app-inbox-desktop-light.png),
  [app-search-results-desktop-light.png](docs/screenshots/app-search-results-desktop-light.png) vs
  [docs/reference/inbox-desktop-light.png](docs/reference/inbox-desktop-light.png),
  [docs/reference/search-desktop-light.png](docs/reference/search-desktop-light.png).
- **Expected:** Inbox card column `max-width: 690px`; Search results fill the design content width
  (reference cards span ~1146px from the content gutter); the reference has no submit button next to the
  search field (field ~610px).
- **Actual:** `inbox.module.css .page { max-width: 760px }`; `search.module.css .page { max-width: 1040px }`
  plus a 40px “Search” submit button beside the field. Both are outside the design’s content rhythm.
- **Fix:** set Inbox max-width to 690px and Search result width to the full content column
  (remove the 1040 cap / use `max-width: none`); remove the submit button and submit on Enter (keep an
  inline search icon) to match the reference field.

### F21 — Home “Recent changes” timestamps include the year · Minor

- **Screen:** Home widget.
- **Evidence:** [app-home-desktop-light.png](docs/screenshots/app-home-desktop-light.png) vs
  [docs/reference/home-desktop-light.png](docs/reference/home-desktop-light.png).
- **Expected:** Home widget short format “17 Nov · 10:42” (no year); project Activity keeps
  “17 Nov 2026 · 10:42”.
- **Actual:** Home renders “18 Nov 2026 · 16:45” (year included, identical to Activity).
- **Fix:** add a `formatDayMonthTime()` helper (or an option on `formatDate`) and use it in
  `Dashboard.tsx` `RecentWidgetBody`; leave Activity on the long format.

### F22 — Archiving from a project with “Show archived” off dead-ends on “Project not available” · Minor

- **Screen:** project page → actions → Archive project.
- **Evidence:** [app-project-archived-notavailable-desktop-light.png](docs/screenshots/app-project-archived-notavailable-desktop-light.png)
  (compare the archived page when the preference is on:
  [app-project-archived-page-desktop-light.png](docs/screenshots/app-project-archived-page-desktop-light.png)).
- **Expected:** the user should see the archived project (subdued/Archived badge) or be returned to the
  parent with a confirmation toast; the design never shows a permission-style dead end after a
  successful action.
- **Actual:** the refresh hides the project (correct per archive visibility) but leaves the user on the
  generic “Project not available / It may not exist, or you may not have access to it.” page — the
  action looks like it failed.
- **Fix:** after `archived: true` succeeds, either enable `show_archived` for the viewer for that session
  and re-render the project with the `Archived` badge, or `router.push` to the parent and toast
  “Project archived. Show archived to see it again.”.

### F23 — Stale “required properties” copy in Application settings · Minor

- **Screen:** Application settings → Application defaults.
- **Evidence:** [app-app-settings-desktop-light.png](docs/screenshots/app-app-settings-desktop-light.png),
  [app-app-settings-mobile-light.png](docs/screenshots/app-app-settings-mobile-light.png).
- **Expected (locked scope §1/§12):** no required add-on fields exist in this iteration; the settings page
  should not promise a validation that cannot happen.
- **Actual:** “Required properties are checked when projects leave Inbox.” remains between Trash
  retention and Views available to projects.
- **Fix:** remove that paragraph from `ApplicationSettingsForm.tsx` (or move it behind the future add-on
  contract in `docs/add-ons.md`); replace with the design’s neutral helper for enabled views.

### F24 — Project Details card uses a stacked label/value grid instead of the designed inline meta line · Minor

- **Screen:** project page → Details card (all project pages).
- **Evidence:** [app-project-kanban-desktop-light.png](docs/screenshots/app-project-kanban-desktop-light.png),
  [app-project-empty-desktop-light.png](docs/screenshots/app-project-empty-desktop-light.png) vs
  [docs/reference/project-detail-desktop-light.png](docs/reference/project-detail-desktop-light.png).
- **Expected:** compact inline metadata on one line — “Project ID KAP-104 · Parent Root · Reporter
  Admin” — inside a 188px card.
- **Actual:** three separate label/value rows (Project ID / Parent / Reporter) with 24px vertical gaps,
  producing a different card rhythm from the design, and the Reporter uses the lowercase username (F01).
- **Fix:** render the details as a wrapped meta row with `·` separators and 12px gaps (keep the stacked
  grid only for mobile, where the reference stacks labels above values). Reuse `.detailValue` styling for
  each segment.

### F25 — Tree view has no selection checkboxes · Minor

- **Screen:** project page → Tree view.
- **Evidence:** [app-project-tree-desktop-light.png](docs/screenshots/app-project-tree-desktop-light.png)
  vs [docs/reference/project-tree-desktop-light.png](docs/reference/project-tree-desktop-light.png).
- **Expected (reference page 07 / design review: Tree includes selection controls):** a leading checkbox
  column (with the “Project / Status” table header), matching the List view’s checkboxes.
- **Actual:** the tree table starts with the disclosure chevron and title; there is no selection column,
  so Tree and List differ in affordances. (Multi-select actions are not in the product scope, so this may
  be an intentional cut — flagging because the reference explicitly includes the controls.)
- **Fix:** if selection is in scope, add the same 16px checkbox cell to the tree rows (header cell
  blank/“Project”); if not, remove the checkbox column from the reference scope and document the cut.
  Indentation and the nested “Find contractor” row otherwise match.

---

## Suspect verification

| Suspect | Verdict | Evidence |
|---|---|---|
| Checkbox/radio render as bare tick glyphs, no box | **Not reproduced** in Chromium. Native 16px boxes/circles render with brand accent; residual UA-styling/contrast issue logged as F15. | [app-app-settings-desktop-light.png](docs/screenshots/app-app-settings-desktop-light.png), [app-app-settings-desktop-dark.png](docs/screenshots/app-app-settings-desktop-dark.png) |
| Account label casing (“admin” vs “Admin”) | **Confirmed** everywhere; also missing “Application Admin” in the account menu. F01. | [app-home-desktop-light.png](docs/screenshots/app-home-desktop-light.png), [app-profile-desktop-light.png](docs/screenshots/app-profile-desktop-light.png) |
| Kanban column background/panel treatment | **Confirmed missing.** Reference columns are `surfaceAlt` rounded panels; app columns are transparent. F02. | [app-project-kanban-desktop-light.png](docs/screenshots/app-project-kanban-desktop-light.png) |
| Members rows say “Custom access (User)” while mode is “Inherited from parent” | **Confirmed**, plus missing “Add member”/“Private — only selected members” states. F03. | [app-project-settings-members-desktop-light.png](docs/screenshots/app-project-settings-members-desktop-light.png) |
| Favorites icons all folders vs per-project icons | **Confirmed.** Design: `home_repair_service` / `cottage` / `person`; app: `folder` for all. F16. | [app-home-desktop-light.png](docs/screenshots/app-home-desktop-light.png) |
| Inbox readiness “Ready to do” for every item vs reference “In ready”/“In Inbox” | **Not a defect for this iteration.** The home widget hard-codes “Ready to do”; the reference shows “In Inbox” for one fixture, which corresponds to the retired required-fields/not-ready state (design-review line 13, cut in build-spec §1/§12). With no add-on fields every capture is legitimately ready. If design wants the mixed state, derive the label from the parent’s start status instead of a constant. | [app-home-desktop-light.png](docs/screenshots/app-home-desktop-light.png) vs [docs/reference/home-desktop-light.png](docs/reference/home-desktop-light.png) |

---

## What is right

- **Token fidelity is high.** Light/dark values match the Penpot sets: canvas `#F5F3EC`/`#181C19`, surface
  `#FFFFFF`/`#242A25`, surfaceAlt `#F7F6F2`/`#1F2420`, border `#DDDCD5`/`#48534A`, brand `#28614A`,
  text `#173629`/`#E9EEE7`, pulled `#F3F1EC`. No invented gradients/shadows; cards are white (or dark
  surface), 1px border, radius 12, `box-shadow: none` — verified computed (`rgb(255,255,255)`, 1px
  `#DDDCD5`, 12px, `none`).
- **Shell geometry matches the contract:** sidebar 244px expanded / **72px collapsed** (measured), topbar
  64px, mobile bar 64px, content padding 40/36/64/32, capture field 393×42, nav item 38px.
- **Control heights:** primary/quiet buttons 40px, inputs/selects 42px, radius 8 — uniform across Home,
  Profile, Settings, dialogs; disabled buttons/inputs use the disabled tokens.
- **Mobile composition is solid:** bottom bar Home/Root/Add/Inbox/Search with active state and
  `aria-current`, Add sheet, full-width forms, labels above controls, Kanban viewport peeks the next
  column (scrollWidth 836 vs 358 client) as the design requires. **No horizontal overflow** was detected
  on any captured 1440 or 390 screen.
- **Dark mode is complete and readable:** every reviewed screen has a dark variant; body text 12.5:1,
  muted 7.4:1, soft 4.8:1, focus token 8.8:1; warning/inbox badges, avatars, borders and the logo plate all
  switch correctly.
- **Designed states that are present and match:** dashboard widget error (exact copy “Could not load /
  Other widgets remain available. Retry this widget. / Retry”), hidden-all dashboard, Pulled inbox card,
  archived cards (dashed border, muted title, Archived badge), trashed read-only project notice, empty
  trash, Move dialog mapping (“To do maps to”, “Map explicitly” notice) and the capture placeholder copy.
- **Focus and keyboard affordances:** visible 2px focus ring on inputs/buttons, skip link, labelled
  controls, `aria-current` nav, menu keyboard handling, focus returned from dialogs.
- **Permission-aware rendering looks intentional:** archived/trashed rows are subdued but readable
  (opacity never below 0.7), viewer read-only states render without editing controls, and the private
  project settings screen does not leak other accounts’ access.
- **Typography:** display 32px/700, title 20px/600, body 14px, small 12px; Material Symbols icons at 18/20
  with a single weight; uppercase 11px section labels — consistent with the design.

---

## Coverage and limitations

Captured (1440×1000 and 390×844, light + dark): Home default / Edit dashboard / hidden-all / widget error;
Root; project page Kanban / Card / Tree / List, empty children, archived card and archived project; Inbox
default and Pulled; Search results / empty / no-results / error / archived; Trash empty, populated and
read-only trashed project; Move, Trash and Restore dialogs; Profile (incl. focus ring); Application
settings; Users; project settings General / Workflow / Members / Layout plus private project members;
mobile Add sheet, Search, Trash, Users, Settings and project settings. Screenshot inventory and exact
state paths are in `docs/screenshots/`.

Limitations: the app was reviewed against the **production build that was already running when this
task started**; the working tree meanwhile received unrelated concurrent edits (including the
checkbox/radio control rewrite noted in F15), so a rebuild is required before re-checking those items.
Penpot live tab suspended during the session, so pages without a raster export (Members,
Search empty/error, Trash, Dashboard variants) were compared against extracted Penpot frame text and
documented design intent rather than a pixel export; native form-control rendering was tested in
Chromium-on-Linux only (see F15); contrast values were computed from the shipped tokens
(relative-luminance formula, WCAG 2.x). Screenshots were produced from a disposable DB snapshot; the
committed seed database was not mutated.
