import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.2 contrast calculator for the Kapo design tokens (issue #34).
 *
 * Parses the real values from src/styles/tokens.css so a token edit that
 * regresses a required pair fails the unit suite. Pairs that are intentionally
 * decorative or inactive (card borders, soft icons, disabled text) are not
 * asserted here; they are documented as exceptions in
 * docs/accessibility-contrast.md.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CSS = readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');
const LIGHT_START = CSS.indexOf(':root,');
const DARK_START = CSS.indexOf("[data-theme='dark']");
const LIGHT_CSS = CSS.slice(LIGHT_START, DARK_START);
const DARK_CSS = CSS.slice(DARK_START);

type Theme = 'light' | 'dark';

function token(theme: Theme, name: string): string {
  const block = theme === 'light' ? LIGHT_CSS : DARK_CSS;
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`Token --${name} not found for ${theme}`);
  return match[1];
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function linear(component: number): number {
  return component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map(linear);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

interface Pair {
  theme: Theme;
  label: string;
  foreground: string;
  background: string;
  minimum: number;
}

function pair(
  theme: Theme,
  label: string,
  foregroundToken: string,
  backgroundToken: string,
  minimum: number,
): Pair {
  return {
    theme,
    label,
    foreground: token(theme, foregroundToken),
    background: token(theme, backgroundToken),
    minimum,
  };
}

function literalPair(
  theme: Theme,
  label: string,
  foreground: string,
  background: string,
  minimum: number,
): Pair {
  return { theme, label, foreground, background, minimum };
}

const TEXT = 4.5;
const LARGE_OR_UI = 3;

const PAIRS: Pair[] = [
  // Body and secondary text.
  pair('light', 'body text on canvas', 'color-text', 'color-canvas', TEXT),
  pair('light', 'body text on surface', 'color-text', 'color-surface', TEXT),
  pair('light', 'muted text on canvas', 'color-muted', 'color-canvas', TEXT),
  pair('light', 'muted text on surface', 'color-muted', 'color-surface', TEXT),
  pair('light', 'muted text on surface-alt', 'color-muted', 'color-surface-alt', TEXT),
  pair('light', 'muted text on brand-light', 'color-muted', 'color-brand-light', TEXT),
  pair('light', 'muted text on pulled', 'color-muted', 'color-pulled', TEXT),
  pair('light', 'muted-strong on canvas', 'color-muted-strong', 'color-canvas', TEXT),
  pair('dark', 'body text on canvas', 'color-text', 'color-canvas', TEXT),
  pair('dark', 'body text on surface', 'color-text', 'color-surface', TEXT),
  pair('dark', 'muted text on canvas', 'color-muted', 'color-canvas', TEXT),
  pair('dark', 'muted text on surface', 'color-muted', 'color-surface', TEXT),
  pair('dark', 'muted text on surface-alt', 'color-muted', 'color-surface-alt', TEXT),
  pair('dark', 'muted text on brand-light', 'color-muted', 'color-brand-light', TEXT),
  pair('dark', 'muted text on pulled', 'color-muted', 'color-pulled', TEXT),
  pair('dark', 'muted-strong on canvas', 'color-muted-strong', 'color-canvas', TEXT),

  // Links and focus rings.
  pair('light', 'accent link on surface', 'color-accent', 'color-surface', TEXT),
  pair('light', 'accent link on canvas', 'color-accent', 'color-canvas', TEXT),
  pair('light', 'accent on brand-light', 'color-accent', 'color-brand-light', LARGE_OR_UI),
  pair('light', 'focus ring on surface', 'color-focus', 'color-surface', LARGE_OR_UI),
  pair('light', 'focus ring on canvas', 'color-focus', 'color-canvas', LARGE_OR_UI),
  pair('dark', 'accent link on surface', 'color-accent', 'color-surface', TEXT),
  pair('dark', 'accent link on canvas', 'color-accent', 'color-canvas', TEXT),
  pair('dark', 'accent on brand-light', 'color-accent', 'color-brand-light', LARGE_OR_UI),
  pair('dark', 'focus ring on surface', 'color-focus', 'color-surface', LARGE_OR_UI),
  pair('dark', 'focus ring on canvas', 'color-focus', 'color-canvas', LARGE_OR_UI),

  // Buttons and solid actions.
  literalPair('light', 'white text on primary action', '#ffffff', token('light', 'color-action'), TEXT),
  pair('light', 'primary action fill on surface', 'color-action', 'color-surface', LARGE_OR_UI),
  literalPair('light', 'white text on danger action', '#ffffff', token('light', 'color-danger-action'), TEXT),
  pair('light', 'danger action fill on surface', 'color-danger-action', 'color-surface', LARGE_OR_UI),
  literalPair('dark', 'white text on primary action', '#ffffff', token('dark', 'color-action'), TEXT),
  pair('dark', 'primary action fill on surface', 'color-action', 'color-surface', LARGE_OR_UI),
  pair('dark', 'primary action fill on canvas', 'color-action', 'color-canvas', LARGE_OR_UI),
  literalPair('dark', 'white text on danger action', '#ffffff', token('dark', 'color-danger-action'), TEXT),
  pair('dark', 'danger action fill on surface', 'color-danger-action', 'color-surface', LARGE_OR_UI),

  // Control boundaries.
  pair('light', 'control border on surface', 'color-control-border', 'color-surface', LARGE_OR_UI),
  pair('dark', 'control border on surface', 'color-control-border', 'color-surface', LARGE_OR_UI),
  pair('light', 'input border on surface', 'color-input-border', 'color-surface', LARGE_OR_UI),
  pair('light', 'input border on canvas', 'color-input-border', 'color-canvas', LARGE_OR_UI),
  pair('light', 'input border on surface-alt', 'color-input-border', 'color-surface-alt', LARGE_OR_UI),
  pair('light', 'input border on brand-light', 'color-input-border', 'color-brand-light', LARGE_OR_UI),
  pair('dark', 'input border on surface', 'color-input-border', 'color-surface', LARGE_OR_UI),
  pair('dark', 'input border on surface-alt', 'color-input-border', 'color-surface-alt', LARGE_OR_UI),
  pair('dark', 'input border on brand-light', 'color-input-border', 'color-brand-light', LARGE_OR_UI),

  // Badges and status colours.
  pair('light', 'neutral badge text', 'color-muted', 'color-surface-alt', TEXT),
  pair('light', 'pulled badge text', 'color-muted', 'color-pulled', TEXT),
  pair('light', 'warning badge text', 'color-warning-strong', 'color-warning-bg', TEXT),
  pair('light', 'danger badge text', 'color-danger', 'color-danger-bg', TEXT),
  pair('light', 'success badge text', 'color-success', 'color-success-bg', TEXT),
  pair('light', 'warning icon on warning-bg', 'color-warning', 'color-warning-bg', LARGE_OR_UI),
  pair('dark', 'neutral badge text', 'color-muted', 'color-surface-alt', TEXT),
  pair('dark', 'pulled badge text', 'color-muted', 'color-pulled', TEXT),
  pair('dark', 'warning badge text', 'color-warning-strong', 'color-warning-bg', TEXT),
  pair('dark', 'danger badge text', 'color-danger', 'color-danger-bg', TEXT),
  pair('dark', 'success badge text', 'color-success', 'color-success-bg', TEXT),
  pair('dark', 'warning icon on warning-bg', 'color-warning', 'color-warning-bg', LARGE_OR_UI),

  // Actor avatars (initials are decorative when the name is adjacent, but the
  // colour pair still meets AA so the avatar is readable on its own).
  pair('light', 'avatar 1 initials', 'avatar-1-text', 'avatar-1-bg', TEXT),
  pair('light', 'avatar 2 initials', 'avatar-2-text', 'avatar-2-bg', TEXT),
  pair('light', 'avatar 3 initials', 'avatar-3-text', 'avatar-3-bg', TEXT),
  pair('light', 'avatar 4 initials', 'avatar-4-text', 'avatar-4-bg', TEXT),
  pair('dark', 'avatar 1 initials', 'avatar-1-text', 'avatar-1-bg', TEXT),
  pair('dark', 'avatar 2 initials', 'avatar-2-text', 'avatar-2-bg', TEXT),
  pair('dark', 'avatar 3 initials', 'avatar-3-text', 'avatar-3-bg', TEXT),
  pair('dark', 'avatar 4 initials', 'avatar-4-text', 'avatar-4-bg', TEXT),
];

describe('theme contrast (WCAG AA)', () => {
  it.each(PAIRS)('$theme: $label', ({ label, foreground, background, minimum }) => {
    const ratio = contrastRatio(foreground, background);
    expect(
      ratio,
      `${label}: ${foreground} on ${background} measured ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
    ).toBeGreaterThanOrEqual(minimum);
  });
});
