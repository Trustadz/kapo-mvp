/**
 * Locale configuration shared by the server and client.
 *
 * The UI locale is a plain cookie (`kapo_locale`), not a URL segment, so the
 * current page and all query parameters survive a language switch. English is
 * the default whenever the cookie is absent or invalid.
 */

export const LOCALES = ['en', 'nl'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie name, path, lifetime and attributes used by the switcher. */
export const LOCALE_COOKIE = 'kapo_locale';
export const LOCALE_COOKIE_PATH = '/';
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
export const LOCALE_COOKIE_SAME_SITE = 'lax';

/**
 * Native language names, deliberately not translated: a language picker reads
 * best when every option is written in its own language.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Parses a raw cookie/document value, falling back to English. */
export function parseLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
