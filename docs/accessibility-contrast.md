# Accessibility contrast audit — light and dark themes

Issue #34. This document records the WCAG 2.2 AA contrast measurements for the
Kapo design tokens and the component pairs that use them, the fixes made, and
the intentional exceptions.

- Thresholds: **4.5:1** for normal text (below 18.66px bold / 24px regular),
  **3:1** for large text and for UI components/graphical objects (WCAG 1.4.3,
  1.4.11).
- Method: WCAG relative luminance over sRGB, measured with the same formula as
  `tests/unit/contrast.test.ts`. Ratios are rounded to two decimals.
- Themes: `[data-theme="light"]` and `[data-theme="dark"]` from
  `src/styles/tokens.css`; "System" resolves to one of those before first paint.
- The token calculator parses `tokens.css` directly, so changing a token to a
  failing value breaks `npm test`. `tests/e2e/contrast.spec.ts` samples computed
  colours from Home, Inbox, project, dialog and settings screens in both themes.

## Fixes

| Pair | Before | After | Why |
| --- | --- | --- | --- |
| Light `--color-muted` | `#65786B` (4.25:1 on canvas, 4.12:1 on brand-light, 4.18:1 on pulled) | `#5D7063` (4.77 / 4.63 / 4.69) | Muted secondary text is used on canvas, Inbox highlights and pulled cards; it now passes AA everywhere it is used as text. |
| Light `--color-input-border` | `#DDDCD5` (1.38:1 on surface) | `#868C85` (3.44:1 on surface, 3.10:1 on canvas) | Inputs, selects, textareas, checkboxes and radios need a 3:1 control boundary. `--color-border` stays light for decorative separators. |
| Light `--avatar-3-text` | `#886338` (4.33:1) | `#7A5730` (5.20:1) | Orange avatar initials now pass normal-text AA. |
| Dark `--color-action` | `#28614A` (white text 7.24:1, fill 2.02:1 vs surface) | `#3D8067` (white text 4.69:1, fill 3.13:1 vs surface, 3.68:1 vs canvas) | Primary buttons and checked controls need both readable text and a 3:1 component boundary. |
| Dark `--color-action-hover` | `#1D4A38` | `#35755D` | Keeps white text at 5.45:1 on hover. |
| Dark `--color-danger-action` | reused `--color-danger` `#F0A497` (white text 1.9:1) | `#BE4D41` (white text 4.85:1, fill 3.02:1 vs surface) | The solid danger button cannot use the light danger *text* tone as a fill. `--color-danger` remains the danger text/icon tone. |
| Dark `--color-input-border` | `#75877A` (3.84:1 surface, 2.85:1 on brand-light) | `#7B8D80` (4.16 / 3.09) | Control boundary also passes on Inbox highlight backgrounds. |
| Drop/focus indicators | `--color-brand` (`#28614A` in dark) | `--color-accent`/`--color-focus` (`#9BD6B3` in dark) | Drag insertion lines, drop outlines, Inbox row markers, two focus outlines and the pressed-favorite/drop icons are graphical objects; the dark brand fill was below 3:1 on dark surfaces. |

No layout, spacing or typography changed. The visual hierarchy is preserved:
`--color-muted` is still lighter than body text, `--color-border` still draws
the light hairlines, and dark action fills remain the same brand family — just
bright enough to read as a component boundary.

## Measured token pairs

### Light theme

| Pair | Foreground | Background | Ratio | Minimum | Result |
| --- | --- | --- | --- | --- | --- |
| Body text on canvas | `#173629` | `#F5F3EC` | 11.85:1 | 4.5 | Pass |
| Body text on surface | `#173629` | `#FFFFFF` | 13.16:1 | 4.5 | Pass |
| Muted text on canvas | `#5D7063` | `#F5F3EC` | 4.77:1 | 4.5 | Pass |
| Muted text on surface | `#5D7063` | `#FFFFFF` | 5.30:1 | 4.5 | Pass |
| Muted text on surface-alt | `#5D7063` | `#F7F6F2` | 4.90:1 | 4.5 | Pass |
| Muted text on brand-light (Inbox highlight) | `#5D7063` | `#E8F2EC` | 4.63:1 | 4.5 | Pass |
| Muted text on pulled | `#5D7063` | `#F3F1EC` | 4.69:1 | 4.5 | Pass |
| Muted-strong on canvas | `#5B6D61` | `#F5F3EC` | 4.97:1 | 4.5 | Pass |
| Soft on canvas | `#9AABA0` | `#F5F3EC` | 2.17:1 | — | Decorative exception |
| Link/accent on surface | `#28614A` | `#FFFFFF` | 7.24:1 | 4.5 | Pass |
| Link/accent on canvas | `#28614A` | `#F5F3EC` | 6.52:1 | 4.5 | Pass |
| Accent on brand-light (focus/drag indicator) | `#28614A` | `#E8F2EC` | 6.33:1 | 3 | Pass |
| White on primary action | `#FFFFFF` | `#28614A` | 7.24:1 | 4.5 | Pass |
| White on danger action | `#FFFFFF` | `#A33A2F` | 6.56:1 | 4.5 | Pass |
| Primary fill on surface | `#28614A` | `#FFFFFF` | 7.24:1 | 3 | Pass |
| Danger fill on surface | `#A33A2F` | `#FFFFFF` | 5.63:1 | 3 | Pass |
| Warning icon on warning-bg | `#AA6736` | `#FFF2E5` | 4.06:1 | 3 | Pass (graphical) |
| Warning badge text on warning-bg | `#94562A` | `#FFF2E5` | 5.27:1 | 4.5 | Pass |
| Danger text/icon on danger-bg | `#A33A2F` | `#FBEAE7` | 5.63:1 | 4.5 | Pass |
| Success text/icon on success-bg | `#28614A` | `#E8F2EC` | 6.33:1 | 4.5 | Pass |
| Input border on surface | `#868C85` | `#FFFFFF` | 3.44:1 | 3 | Pass |
| Input border on canvas | `#868C85` | `#F5F3EC` | 3.10:1 | 3 | Pass |
| Input border on surface-alt | `#868C85` | `#F7F6F2` | 3.18:1 | 3 | Pass |
| Input border on brand-light | `#868C85` | `#E8F2EC` | 3.01:1 | 3 | Pass |
| Card/table border on surface | `#DDDCD5` | `#FFFFFF` | 1.38:1 | — | Decorative exception |
| Focus ring on surface | `#28614A` | `#FFFFFF` | 7.24:1 | 3 | Pass |
| Focus ring on canvas | `#28614A` | `#F5F3EC` | 6.52:1 | 3 | Pass |
| Disabled text on disabled background | `#8B8C85` | `#F0EFEB` | 2.95:1 | — | Inactive exception |
| Avatar 1 initials | `#305C7B` | `#DBE8F1` | 5.72:1 | 4.5 | Pass |
| Avatar 2 initials | `#894F6A` | `#F0DDE8` | 4.78:1 | 4.5 | Pass |
| Avatar 3 initials | `#7A5730` | `#F4E4CD` | 5.20:1 | 4.5 | Pass |
| Avatar 4 initials | `#66508A` | `#E5DFF2` | 5.25:1 | 4.5 | Pass |

### Dark theme

| Pair | Foreground | Background | Ratio | Minimum | Result |
| --- | --- | --- | --- | --- | --- |
| Body text on canvas | `#E9EEE7` | `#181C19` | 14.64:1 | 4.5 | Pass |
| Body text on surface | `#E9EEE7` | `#242A25` | 12.46:1 | 4.5 | Pass |
| Muted text on canvas | `#AFBBAF` | `#181C19` | 8.65:1 | 4.5 | Pass |
| Muted text on surface | `#AFBBAF` | `#242A25` | 7.36:1 | 4.5 | Pass |
| Muted text on surface-alt | `#AFBBAF` | `#1F2420` | 7.92:1 | 4.5 | Pass |
| Muted text on brand-light (Inbox highlight) | `#AFBBAF` | `#2B4234` | 5.46:1 | 4.5 | Pass |
| Muted text on pulled | `#AFBBAF` | `#2B2D27` | 7.00:1 | 4.5 | Pass |
| Muted-strong on canvas | `#C2CDC4` | `#181C19` | 10.52:1 | 4.5 | Pass |
| Soft on surface | `#88978B` | `#242A25` | 4.78:1 | — | Decorative (passes anyway) |
| Link/accent on surface | `#9BD6B3` | `#242A25` | 8.84:1 | 4.5 | Pass |
| Link/accent on canvas | `#9BD6B3` | `#181C19` | 10.39:1 | 4.5 | Pass |
| Accent on brand-light (focus/drag indicator) | `#9BD6B3` | `#2B4234` | 6.56:1 | 3 | Pass |
| White on primary action | `#FFFFFF` | `#3D8067` | 4.69:1 | 4.5 | Pass |
| Primary fill on surface | `#3D8067` | `#242A25` | 3.13:1 | 3 | Pass |
| Primary fill on canvas | `#3D8067` | `#181C19` | 3.68:1 | 3 | Pass |
| White on danger action | `#FFFFFF` | `#BE4D41` | 4.85:1 | 4.5 | Pass |
| Danger fill on surface | `#BE4D41` | `#242A25` | 3.02:1 | 3 | Pass |
| Warning icon on warning-bg | `#F0B77D` | `#453424` | 6.65:1 | 3 | Pass |
| Warning badge text on warning-bg | `#F5C08B` | `#453424` | 7.23:1 | 4.5 | Pass |
| Danger text/icon on danger-bg | `#F0A497` | `#452A26` | 6.49:1 | 4.5 | Pass |
| Success text/icon on success-bg | `#9BD6B3` | `#2B4234` | 6.56:1 | 4.5 | Pass |
| Input border on surface | `#7B8D80` | `#242A25` | 4.16:1 | 3 | Pass |
| Input border on surface-alt | `#7B8D80` | `#1F2420` | 4.48:1 | 3 | Pass |
| Input border on brand-light | `#7B8D80` | `#2B4234` | 3.09:1 | 3 | Pass |
| Card/table border on surface | `#48534A` | `#242A25` | 1.82:1 | — | Decorative exception |
| Focus ring on surface | `#9BD6B3` | `#242A25` | 8.84:1 | 3 | Pass |
| Focus ring on canvas | `#9BD6B3` | `#181C19` | 10.39:1 | 3 | Pass |
| Disabled text on disabled background | `#939C91` | `#30352F` | 4.42:1 | — | Inactive exception |
| Avatar 1 initials | `#B2D8F4` | `#263F51` | 7.33:1 | 4.5 | Pass |
| Avatar 2 initials | `#F1BCD6` | `#493142` | 7.16:1 | 4.5 | Pass |
| Avatar 3 initials | `#F1D0A1` | `#473A27` | 7.50:1 | 4.5 | Pass |
| Avatar 4 initials | `#D7C5F4` | `#39314A` | 7.70:1 | 4.5 | Pass |

## Component coverage

| Component | Tokens checked | Notes |
| --- | --- | --- |
| Body copy, page subtitles, helpers | `text`, `muted`, `muted-strong` on canvas/surface/surface-alt | All pass in both themes. |
| Sidebar / top bar | `text` on surface, `brand-dark` wordmark, `muted` helper text, active `brand-light` fill | Wordmark passes (light `#1D4A38` on white 10.05:1; dark `#B9E4C9` on surface 10.47:1). |
| Dialogs | `text` title, `muted` description, `surface` body, `focus` ring, `input-border` controls | Dialog description uses muted on surface (5.30 / 7.36). |
| Forms | `text` labels, `muted` hints, `danger` errors, `input-border` controls, `warning` required marker | Errors use `danger` on surface (light 6.56:1, dark 7.30:1). Required marker is decorative; native `required` carries the state. |
| Buttons | Primary/danger fills + white text, quiet/ghost `text`, disabled `disabled-text` | Solid actions listed above. Quiet/ghost buttons are identified by their text label (11.49:1 light on brand-light, 13.16:1 on surface; dark 9.24/12.46) rather than by a 3:1 fill boundary. |
| Badges | `neutral`/`archived`/`pulled` muted, `brand`, `warning`, `success`, `danger` | Text pairs pass; neutral/archived border is decorative. |
| Inbox highlights | `brand-light` row/card wash with `text` and `muted` status; left marker `accent` | Text passes (11.49 and 4.63 light; 9.24 and 5.46 dark). |
| Changed-field accent | `accent` 3px marker and `text` on `brand-light` | Marker is 6.33:1 light / 6.56:1 dark; tint is not the only cue (marker + session copy). |
| Toasts / alerts | `text` on surface, `success`/`danger`/`accent` icons | Tone is not colour-only: each tone has a distinct icon and the message text. |

## Remaining exceptions

1. **`--color-border` (light `#DDDCD5`, dark `#48534A`)** — 1.38:1 / 1.82:1.
   Used only for decorative card, table, badge and shell separators. Every
   interactive control boundary uses `--color-input-border` (≥3:1) and focus
   rings use `--color-focus`. Changing the hairline to 3:1 would make the UI
   visually heavy without adding information.
2. **`--color-soft` (light `#9AABA0`, dark `#88978B`)** — 2.17:1 on the light
   canvas. Used only for decorative icons (empty-state glyph), the `·` view-meta
   separator, breadcrumb `/` separators and disabled move arrows. It is never
   used for required labels or state. Dark soft passes 4.78:1 anyway.
3. **Disabled text (`--color-disabled-text`)** — 2.95:1 light / 4.42:1 dark on
   the disabled fill. Inactive controls are exempt from 1.4.3 and 1.4.11; the
   disabled state is also conveyed by `disabled`/`aria-disabled` and colour is
   not the only signal. Disabled menu items use 3.39:1 light / 5.17:1 dark on
   the menu surface but remain inactive.
4. **Light warning icon (`#AA6736` on `#FFF2E5`)** — 4.06:1. It is a graphical
   icon (≥3:1 required) and, in the required marker, decorative; warning *text*
   uses `--color-warning-strong` at 5.27:1.
5. **Dark primary action hover (`#35755D`)** — white text 5.45:1 but the fill is
   2.69:1 against the dark surface. Hover is transient and the button remains
   identified by its text; the resting fill is 3.13:1. If a stricter reading of
   1.4.11 is required for hover boundaries, raise the hover fill to `#3D8067`
   (3.13:1) and accept a smaller hover delta.
6. **Avatar initials** — decorative when the name is adjacent (the component
   also exposes the name); all pairs still meet 4.5:1, so no exception is
   needed in practice.

## Verification

```bash
npm run typecheck
npm test -- tests/unit/contrast.test.ts
npx playwright test tests/e2e/contrast.spec.ts --project=desktop
```

Manual checks still worth doing on real hardware: NVDA + Firefox and VoiceOver
+ Safari with each theme, OS forced-colours/high-contrast mode, and a colour
vision simulator. Automated sampling cannot validate anti-aliasing on
photos, user-uploaded avatars, or the OS-level contrast overrides.
