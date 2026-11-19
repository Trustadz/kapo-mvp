import type { Appearance } from './types';

/**
 * Client-safe appearance helpers. The server renders an explicit data-theme
 * when the account has a light/dark preference; "System" is resolved before
 * first paint by ThemeScript (no flash of the wrong theme).
 */

export const APPEARANCE_STORAGE_KEY = 'kapo-appearance';
export const APPEARANCE_COOKIE_NAME = 'kapo_appearance';

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function preferDark(appearance: Appearance): boolean {
  return appearance === 'dark' || (appearance === 'system' && systemPrefersDark());
}

export function resolvedTheme(appearance: Appearance): 'light' | 'dark' {
  return preferDark(appearance) ? 'dark' : 'light';
}

/** Applies the appearance to <html>, remembers it, and mirrors it to a cookie. */
export function applyAppearance(appearance: Appearance): void {
  if (typeof document === 'undefined') return;
  const theme = resolvedTheme(appearance);
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
  } catch {
    /* storage may be unavailable (private mode); the cookie still works */
  }
  document.cookie = `${APPEARANCE_COOKIE_NAME}=${appearance}; path=/; max-age=${365 * 24 * 60 * 60}; samesite=lax`;
}

export function readStoredAppearance(): Appearance {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* ignore */
  }
  return 'system';
}
