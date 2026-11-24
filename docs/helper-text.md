# Helper text guidelines

## Default: no helper text

Kapo defaults to **no helper text**. A label, placeholder, section title,
validation message or visible control should carry the meaning first. Helper
text is an exception, not a default layer.

Do not add helper text for a hypothetical question. Add it only after a real
user question, a support issue or an observed usability problem. The project owner
prefers to explain a feature when asked rather than have it explained
everywhere in advance. The exceptions below are risk-driven: they prevent a
mistake or unblock a task, not explain the interface in advance.

## What counts as helper text

Any supporting copy that is not a label, button, heading, empty-state title,
validation error, toast or activity sentence:

- field hints and control descriptions;
- section and card introductions;
- dialog subtitles and explanatory bodies;
- inline notes, warnings and empty-state descriptions;
- hover/focus tooltips;
- page subtitles.

Placeholders are not helper text, but the same default applies: use one only
when an example format is genuinely needed.

## When helper text is allowed

Add helper text only when it satisfies at least one of these exceptions, and
name the exception in the pull request:

| # | Exception | What qualifies | Kapo example |
|---|---|---|---|
| A | **Destructive or irreversible consequence** | The UI cannot show what else will be affected or that an action cannot be undone. | “Trashed projects are read-only and are permanently deleted 30 days after they enter Trash.” |
| B | **Non-obvious access consequence** | Permissions or visibility change in a way the role labels do not convey. | “Only the selected members below can open this project, even application Admins.” |
| C | **Security-sensitive behaviour** | A secret, token, sign-in method or delegated identity has a consequence the user must know. | “It is shown only once. Paste it into your AI client’s MCP configuration as a Bearer token.” |
| D | **Data lifecycle** | Retention, purge or backup timing/number is not inferable from the control. | “Between 1 and 30; the oldest are pruned after each run.” |
| E | **Shared help for a non-discoverable interaction** | The task needs an interaction that is not visible or conventional. Put the instruction in one shared help affordance, never under every view. | A “How dragging works” popover linked once. |
| F | **Empty state with a next step** | The page is empty and the action that fills it is not visible from that state. | “Watch a project to hear about its changes.” |
| G | **Accessibility-only description** | Screen-reader or focus help for a complex interaction. This is not visual clutter. | The visually hidden drag description on Inbox cards. |
| H | **Error recovery** | The error state needs a next step or reassurance the error message does not carry. | “Your query is preserved. Retry when Kapo is available.” |
| I | **High-stakes admin setting** | An infrequent administrator setting whose format or side effect is not inferable. | “Server local time”; “Days between 1 and 365. Default 30.” |

If a proposed string fits none of A–I, do not add it.

## Hard rules

1. **Never restate the label, title, placeholder or visible state.** “Your
   Inbox is empty.”, “Create a project under {title}.” and “Application
   administration” are not helper text; they are noise.
2. **One helper per control.** Do not stack a card introduction, a field hint
   and a checkbox description on the same setting.
3. **Do not repeat the same explanation on multiple screens.** Choose one
   canonical place. Link to it instead of copying it. The only exception is a
   destructive or permission consequence that recurs at a different decision
   point (for example single versus bulk trash); keep that wording identical.
4. **Respect the word budget.**
   - field hint: **12 words**;
   - section/card introduction: **20 words**;
   - dialog body: **40 words**;
   - destructive or permission confirmation: **60 words**.
   Cut or move anything longer.
5. **No marketing or self-congratulatory copy.** “The layout adapts to your
   device.” is not a reason to add a sentence.
6. **No implementation details in the UI.** Environment variables, container
   internals, file paths and “see the README” belong in docs or an admin help
   page. Link to them instead.
7. **No prospective copy.** Do not anticipate every question. Add helper text
   only after a real question or observed confusion.
8. **No tooltip that repeats a label or a visible state.** Tooltips are for
   disabled-control reasons and non-obvious icons only.
9. **Page subtitles default to none.** Keep one only when the page’s scope or
   audience is genuinely unclear.
10. **Add-on descriptions are metadata, not per-field help.** Show an add-on’s
    description once in its card or dialog; do not repeat availability notes
    beside every project row.
11. **Accessibility-only text is exempt from the visual budget.** Keep it
    concise and unique; do not delete it as clutter.
12. **No repeated interaction hints.** Do not put drag, touch or keyboard
    instructions under every collection view. Use one shared help affordance or
    an accessibility-only description; the visible Actions menu is the keyboard
    path.
13. **Do not narrate obvious state.** “Marked read when this closes.” and
    “Stays here as Pulled.” are not help; the UI already shows the state.
14. **Remove on touch.** When editing a screen, delete any helper text that no
    longer meets these rules. Do not leave it “for later”.

## Decision check

Before adding a string, answer these in order:

1. Is this actually a label, validation message, toast or empty-state title?
   If yes, use the existing pattern for that element, not helper text.
2. Does the UI already communicate it? Remove it.
3. Does it meet one of A–I? If no, remove it.
4. Is it within the word budget? If no, cut it or move it.
5. Is it repeated elsewhere? Keep one canonical version.
6. Is it only useful the first time? Put it in onboarding or docs, not on the
   screen.

## Where long explanations go

- Operator/install details: `README.md` and `docs/`.
- Repeated “how it works” explanations: a single help page or a `?` popover,
  linked from the screen.
- First-run guidance: the setup or onboarding flow, not every later screen.

## Pull-request requirement

A pull request that adds helper text must:

- cite the exception (A–I) in the description;
- include a screenshot of the screen in context;
- state what was removed or shortened to keep the screen balanced.

A pull request that changes a screen should remove any helper text on that
screen that fails these rules, even when the helper text is unrelated to the
main change.

## Examples

Keep:

- “Trashed projects are read-only and are permanently deleted 30 days after
  they enter Trash. You can restore them before then.” (A, D)
- “Only the selected members below can open this project, even application
  Admins.” (B)
- “It is shown only once. Paste it into your AI client’s MCP configuration as
  a Bearer token.” (C)
- “Between 1 and 30; the oldest are pruned after each run.” (D)
- “Watch a project to hear about its changes.” (F)
- The visually hidden card drag description. (G)
- “Your query is preserved. Retry when Kapo is available.” (H)

Remove:

- “Your Inbox is empty.” — the empty page already says it.
- “Application administration” — the dialog title already says it.
- “The interface, dates and numbers update immediately.” — a promise, not help.
- “Enter a title or another available text value to search.” — the search box
  placeholder says it.
- The same 30-day trash rule on the Trash tab and the empty Trash state. Keep
  it in the destructive dialogs and the project banner, where the decision or
  the exact deadline is shown.
- A field description that repeats its label, such as “One person responsible
  for this project.” under “Assigned to”.
- “Drag cards to reorder or change status. Keyboard: use Actions.” under every
  collection view. Use one shared help affordance, or rely on the visible
  Actions menu.
- “Marked read when this closes.” — the read state is already visible.
- “Stays here as Pulled.” — the Pulled badge says it.
