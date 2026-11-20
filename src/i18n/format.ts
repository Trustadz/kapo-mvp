import { DEFAULT_LOCALE, type Locale } from './config';

/**
 * Locale-aware date, time, number and relative formatting. Formatters are
 * cached per locale because constructing `Intl` objects is comparatively
 * expensive and these helpers run for every Activity row and card meta line.
 */

const dateFormats = new Map<Locale, Intl.DateTimeFormat>();
const timeFormats = new Map<Locale, Intl.DateTimeFormat>();
const dayMonthFormats = new Map<Locale, Intl.DateTimeFormat>();
const dayMonthYearFormats = new Map<Locale, Intl.DateTimeFormat>();
const numberFormats = new Map<Locale, Intl.NumberFormat>();
const relativeFormats = new Map<Locale, Intl.RelativeTimeFormat>();

/**
 * Maps the UI language to the regional Intl locale that matches the design.
 * English uses en-GB's "17 Nov 2026" order (as the app always did); Dutch uses
 * nl-NL. Keeping this mapping in one place means every formatter agrees.
 */
const INTL_LOCALES: Record<Locale, string> = {
  en: 'en-GB',
  nl: 'nl-NL',
};

function safeLocale(locale: Locale): Locale {
  return locale && locale in INTL_LOCALES ? locale : DEFAULT_LOCALE;
}

function intlLocale(locale: Locale): string {
  return INTL_LOCALES[safeLocale(locale)];
}

function dateFormat(locale: Locale): Intl.DateTimeFormat {
  const key = safeLocale(locale);
  let formatter = dateFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(key), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    dateFormats.set(key, formatter);
  }
  return formatter;
}

function timeFormat(locale: Locale): Intl.DateTimeFormat {
  const key = safeLocale(locale);
  let formatter = timeFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(key), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    timeFormats.set(key, formatter);
  }
  return formatter;
}

function dayMonthFormat(locale: Locale): Intl.DateTimeFormat {
  const key = safeLocale(locale);
  let formatter = dayMonthFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(key), { day: 'numeric', month: 'short' });
    dayMonthFormats.set(key, formatter);
  }
  return formatter;
}

function dayMonthYearFormat(locale: Locale): Intl.DateTimeFormat {
  const key = safeLocale(locale);
  let formatter = dayMonthYearFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(key), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    dayMonthYearFormats.set(key, formatter);
  }
  return formatter;
}

function parseDate(iso: string | Date): Date | null {
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "17 Nov 2026" (EN) / "17 nov 2026" (NL). */
export function formatDate(locale: Locale, iso: string | Date): string {
  const date = parseDate(iso);
  if (!date) return '';
  return dateFormat(locale).format(date);
}

/** "10:42" (24-hour clock in both locales). */
export function formatTime(locale: Locale, iso: string | Date): string {
  const date = parseDate(iso);
  if (!date) return '';
  return timeFormat(locale).format(date);
}

/** "17 Nov 2026 · 10:42" — the Activity row pattern from the design. */
export function formatDateTime(locale: Locale, iso: string | Date): string {
  const date = parseDate(iso);
  if (!date) return '';
  return `${dateFormat(locale).format(date)} · ${timeFormat(locale).format(date)}`;
}

/**
 * Compact timestamp for dense contexts such as the Home "Recent changes"
 * widget: "17 Nov · 10:42". The year is omitted while it matches `now` and
 * included otherwise. Activity uses formatDateTime (always with year).
 */
export function formatDayTime(
  locale: Locale,
  iso: string | Date,
  now: Date = new Date(),
): string {
  const date = parseDate(iso);
  if (!date) return '';
  const dayMonth =
    date.getFullYear() === now.getFullYear()
      ? dayMonthFormat(locale).format(date)
      : dayMonthYearFormat(locale).format(date);
  return `${dayMonth} · ${timeFormat(locale).format(date)}`;
}

/** Locale-aware number formatting ("1,234.5" / "1.234,5"). */
export function formatNumber(locale: Locale, value: number): string {
  const key = safeLocale(locale);
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(intlLocale(key));
    numberFormats.set(key, formatter);
  }
  return formatter.format(value);
}

/**
 * Relative time such as "yesterday" / "gisteren". `value` is a timestamp or
 * Date; the unit is chosen from the largest sensible difference (days, hours,
 * minutes, then seconds). "now" is returned for differences under 30 seconds.
 */
export function formatRelative(
  locale: Locale,
  value: string | Date,
  now: Date = new Date(),
): string {
  const date = parseDate(value);
  if (!date) return '';
  const key = safeLocale(locale);
  let formatter = relativeFormats.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(intlLocale(key), { numeric: 'auto' });
    relativeFormats.set(key, formatter);
  }
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (Math.abs(diffSeconds) < 30) return formatter.format(0, 'second');
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour');
  return formatter.format(Math.round(diffHours / 24), 'day');
}
