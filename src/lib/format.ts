/**
 * Date, time and name formatting shared by activity, cards and dashboards.
 *
 * Locale-aware Intl formatting lives in `src/i18n/format.ts`; these wrappers
 * keep the historical call sites working (English by default) while allowing
 * components to pass the active locale. Server-only code that has no request
 * locale can keep calling them without a second argument.
 */
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import {
  formatDate as formatDateForLocale,
  formatDateTime as formatDateTimeForLocale,
  formatDayTime as formatDayTimeForLocale,
  formatNumber as formatNumberForLocale,
  formatRelative as formatRelativeForLocale,
  formatTime as formatTimeForLocale,
} from '@/i18n/format';

/** "17 Nov 2026" */
export function formatDate(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return formatDateForLocale(locale, iso);
}

/** "10:42" */
export function formatTime(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return formatTimeForLocale(locale, iso);
}

/** "17 Nov 2026 · 10:42" — the Activity row pattern from the design. */
export function formatDateTime(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return formatDateTimeForLocale(locale, iso);
}

/**
 * Compact timestamp for dense contexts such as the Home "Recent changes"
 * widget: "17 Nov · 10:42". The year is omitted while it matches the current
 * year and included otherwise. Activity uses formatDateTime (always with year).
 */
export function formatDayTime(
  iso: string,
  locale: Locale = DEFAULT_LOCALE,
  now: Date = new Date(),
): string {
  return formatDayTimeForLocale(locale, iso, now);
}

/** Locale-aware number formatting: "1,234.5" (EN) / "1.234,5" (NL). */
export function formatNumber(value: number, locale: Locale = DEFAULT_LOCALE): string {
  return formatNumberForLocale(locale, value);
}

/** Relative time such as "yesterday" / "gisteren". */
export function formatRelative(
  value: string | Date,
  locale: Locale = DEFAULT_LOCALE,
  now: Date = new Date(),
): string {
  return formatRelativeForLocale(locale, value, now);
}

/**
 * Human display name for a username: capitalise the first letter, keep the
 * rest ("admin" -> "Admin", "mary.jane" -> "Mary.jane"). Editable username
 * inputs should still show the stored value.
 */
export function formatPersonName(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return username;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
