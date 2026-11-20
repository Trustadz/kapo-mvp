import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_PATH,
  LOCALE_COOKIE_SAME_SITE,
  parseLocale,
  type Locale,
} from './config';

/**
 * Client-side cookie helpers. The locale cookie is intentionally readable by
 * JavaScript (not httpOnly) so the switcher can persist it without a server
 * round-trip; it contains no sensitive data.
 */
export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=${LOCALE_COOKIE_PATH}; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=${LOCALE_COOKIE_SAME_SITE}`;
}

/** Reads the locale cookie from `document.cookie`, falling back to English. */
export function readLocaleCookie(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  for (const part of document.cookie.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === LOCALE_COOKIE) {
      return parseLocale(decodeURIComponent(rawValue.join('=')));
    }
  }
  return DEFAULT_LOCALE;
}
