# Kapo MVP design handoff

Start in **Kapo → New Design → 00 · Guide & foundations**. The numbered Penpot pages below identify the source for each feature. Use the desktop and mobile examples together for layout decisions, and the light and dark examples for appearance.

| Feature | Penpot source |
|---|---|
| App shell, capture and Inbox release | **01 · Overview · desktop** and **02 · Overview · mobile** |
| Inbox custom start status and empty state | **04 · Inbox · refinement** |
| Project header, Status, views, empty state and Activity | **07 · Projects · views & states** |
| Profile, password and application settings | **03 · Settings · overview** and mobile equivalents on **02** |
| Workflow, permissions and layout | **08 · Settings · workflow & permissions** |
| Move, remapping, access errors and confirmation dialogs | **09 · Flows · dialogs & feedback** |
| Search, Trash and restoration | **10 · Search & Trash** |
| Sign-in, first account creation and user management | **11 · Accounts · access & users** |
| Dashboard widgets and customization | **12 · Dashboard · views & customization** |

## Core interactions

- Global capture creates a Root child with a title. Project capture creates a child under the current project. Both use the parent’s start status.
- Inbox shows each project’s parent, an action labeled with the destination status, and a separate Open action. The release action clears Inbox membership. Retain the card as Pulled until the user leaves the screen.
- Use the same Status control across project views. Root has no Status. Viewers see the current value without editing. Changing a project’s Status and switching the view are separate operations.
- Place the view selector next to Add child project. Hide the collection and its selector when there are no children. Keep Add child project and Activity. On mobile Kanban, reveal part of the next column.
- Put Project settings in the project actions menu and open settings as a page. Show archived is a personal preference that affects all views. Archived project titles must remain readable.
- Trash is reachable from Search. The restore flow identifies the projects affected by the same trash action. A separately trashed project retains its own purge deadline and stays in Trash.
- Home offers Inbox, Recent changes and Completed last week. Its editor saves visibility and order per user. Assignee, assignment rules and Assigned to me are deferred throughout the MVP.

## Shared patterns

Use the Assets panel for navigation, form controls, actions, status, cards and activity events. Take spacing and appearance from the Foundations specimens and theme tokens. Use the page frames to understand responsive composition. Prototype interactions are representative examples with local page destinations. Use this document and [product.md](product.md) for routes and rules that span pages.

## Prototype walkthroughs

| Start frame | Action and expected result |
|---|---|
| **01 · Home · Desktop · Light** or **01 · Home · Mobile · Light** on the corresponding Overview page | Open capture and use Create project to reach Inbox. Release the first sample project and check its Pulled label. Open that project, then choose In progress from its Status control to see the changed-state example. |
| **02 · Project · Card · Desktop · Light** on page 07 | Use the child toolbar to compare the four views. Open project actions for Settings, archive visibility and lifecycle actions. The overview is the wired Status-change example. Page 07 illustrates the reusable controls and view layouts. |
| **01 · Search · Results · Desktop · Light** or its mobile equivalent on page 10 | Open Trash, then Restore action. Confirm which projects return. The prototype shows a confirmation overlay. The implementation must also remove restored projects from the active Trash list. |
| **02 · Dashboard · Edit · Desktop · Light** or its mobile equivalent on page 12 | Hide Recent changes and save. The customized example retains Inbox and Completed last week. Restore defaults returns to the three-widget default. |
