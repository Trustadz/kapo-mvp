import { describe, expect, it } from 'vitest';
import {
  MENU_TRIGGER_GAP,
  MENU_VIEWPORT_MARGIN,
  clampToRange,
  computeMenuPosition,
} from '@/lib/menu-position';

/**
 * Viewport clamping for the shared menu panel (issue #30 / #20).
 *
 * These cases pin down the edge geometry that used to let an `align="end"`
 * panel open past the left edge on a 390px viewport, and that keeps a panel
 * opened near the bottom/right edge fully visible.
 */

const PANEL = { width: 224, height: 300 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

describe('clampToRange', () => {
  it('clamps values to the range', () => {
    expect(clampToRange(-12, 10, 100)).toBe(10);
    expect(clampToRange(42, 10, 100)).toBe(42);
    expect(clampToRange(140, 10, 100)).toBe(100);
  });

  it('falls back to the minimum when the range is inverted', () => {
    expect(clampToRange(50, 10, 4)).toBe(10);
  });
});

describe('computeMenuPosition', () => {
  it('anchors a start-aligned panel to the trigger left', () => {
    const position = computeMenuPosition(
      { top: 100, right: 300, bottom: 140, left: 200 },
      PANEL,
      DESKTOP_VIEWPORT,
    );
    expect(position).toEqual({ top: 148, left: 200 });
  });

  it('anchors an end-aligned panel to the trigger right', () => {
    const position = computeMenuPosition(
      { top: 100, right: 800, bottom: 140, left: 700 },
      PANEL,
      DESKTOP_VIEWPORT,
      { align: 'end' },
    );
    expect(position.left).toBe(576);
  });

  it('keeps the mobile collection-view menu off the left edge (issue #30)', () => {
    // The wrapped mobile header starts the actions at the left, so an
    // end-aligned 224px panel would otherwise start at -6px on a 390px screen.
    const trigger = { top: 260, right: 218, bottom: 300, left: 140 };
    const position = computeMenuPosition(trigger, PANEL, MOBILE_VIEWPORT, { align: 'end' });
    expect(position.left).toBe(MENU_VIEWPORT_MARGIN);
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.left).toBeLessThanOrEqual(12);
    expect(position.left + PANEL.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width - 8);
  });

  it('clamps a start-aligned panel that would overflow the right edge', () => {
    const trigger = { top: 100, right: 1270, bottom: 140, left: 1200 };
    const position = computeMenuPosition(trigger, PANEL, DESKTOP_VIEWPORT);
    expect(position.left).toBe(DESKTOP_VIEWPORT.width - PANEL.width - MENU_VIEWPORT_MARGIN);
  });

  it('opens below the trigger with the documented gap', () => {
    const trigger = { top: 100, right: 300, bottom: 140, left: 200 };
    const position = computeMenuPosition(trigger, PANEL, DESKTOP_VIEWPORT, { side: 'bottom' });
    expect(position.top).toBe(trigger.bottom + MENU_TRIGGER_GAP);
  });

  it('opens above the trigger with the documented gap', () => {
    const trigger = { top: 500, right: 300, bottom: 540, left: 200 };
    const position = computeMenuPosition(trigger, PANEL, DESKTOP_VIEWPORT, { side: 'top' });
    expect(position.top).toBe(trigger.top - MENU_TRIGGER_GAP - PANEL.height);
  });

  it('clamps a menu opened from the last card near the bottom edge (issue #20)', () => {
    const trigger = { top: 620, right: 900, bottom: 660, left: 780 };
    const position = computeMenuPosition(trigger, PANEL, DESKTOP_VIEWPORT, { align: 'end' });
    expect(position.top).toBe(DESKTOP_VIEWPORT.height - PANEL.height - MENU_VIEWPORT_MARGIN);
    expect(position.top + PANEL.height).toBeLessThanOrEqual(DESKTOP_VIEWPORT.height - 8);
    expect(position.left).toBe(676);
  });

  it('keeps a panel larger than the viewport at the top-left margin', () => {
    const oversized = { width: 380, height: 900 };
    const position = computeMenuPosition(
      { top: 200, right: 380, bottom: 240, left: 100 },
      oversized,
      MOBILE_VIEWPORT,
    );
    expect(position).toEqual({ top: MENU_VIEWPORT_MARGIN, left: MENU_VIEWPORT_MARGIN });
  });

  it('respects an explicit margin and gap', () => {
    const position = computeMenuPosition(
      { top: 100, right: 200, bottom: 140, left: 100 },
      PANEL,
      MOBILE_VIEWPORT,
      { align: 'end', margin: 12, gap: 4 },
    );
    expect(position.left).toBe(12);
    expect(position.top).toBe(144);
  });
});
