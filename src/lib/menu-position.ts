/**
 * Pure viewport-clamping math for the shared `Menu` panel.
 *
 * The panel is measured after it opens, then positioned from the trigger rect
 * (and, for the default absolute strategy, converted to coordinates relative
 * to the menu root). Keeping the arithmetic out of the component makes the
 * edge cases straightforward to unit test.
 */

/** Keep at least this much space between the panel and the viewport edge. */
export const MENU_VIEWPORT_MARGIN = 10;

/** Match the `--space-2` gap used by the original CSS positioning. */
export const MENU_TRIGGER_GAP = 8;

export interface MenuAnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MenuPanelSize {
  width: number;
  height: number;
}

export interface MenuViewportSize {
  width: number;
  height: number;
}

export interface MenuPositionOptions {
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  /** Space from each viewport edge. Defaults to {@link MENU_VIEWPORT_MARGIN}. */
  margin?: number;
  /** Space between the trigger and the panel. Defaults to {@link MENU_TRIGGER_GAP}. */
  gap?: number;
}

export interface MenuPosition {
  top: number;
  left: number;
}

/** Clamp `value` into `[min, max]`; a too-small viewport wins over `max`. */
export function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Compute the panel's fixed-position coordinates in the viewport.
 *
 * `align` controls the horizontal anchor and `side` the vertical one. Both
 * axes are clamped so a panel opened near any edge stays inside the viewport;
 * rounding avoids sub-pixel jitter while scrolling.
 */
export function computeMenuPosition(
  trigger: MenuAnchorRect,
  panel: MenuPanelSize,
  viewport: MenuViewportSize,
  options: MenuPositionOptions = {},
): MenuPosition {
  const align = options.align ?? 'start';
  const side = options.side ?? 'bottom';
  const margin = options.margin ?? MENU_VIEWPORT_MARGIN;
  const gap = options.gap ?? MENU_TRIGGER_GAP;

  const preferredLeft = align === 'end' ? trigger.right - panel.width : trigger.left;
  const preferredTop = side === 'top' ? trigger.top - gap - panel.height : trigger.bottom + gap;

  return {
    top: Math.round(clampToRange(preferredTop, margin, viewport.height - panel.height - margin)),
    left: Math.round(clampToRange(preferredLeft, margin, viewport.width - panel.width - margin)),
  };
}
