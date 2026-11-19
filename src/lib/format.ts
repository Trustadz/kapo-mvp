/** Date and time formatting shared by activity, cards and dashboards. */

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DAY_MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
});

const DAY_MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "17 Nov 2026" */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return DATE_FORMAT.format(date);
}

/** "10:42" */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return TIME_FORMAT.format(date);
}

/** "17 Nov 2026 · 10:42" — the Activity row pattern from the design. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${DATE_FORMAT.format(date)} · ${TIME_FORMAT.format(date)}`;
}

/**
 * Compact timestamp for dense contexts such as the Home "Recent changes"
 * widget: "17 Nov · 10:42". The year is omitted while it matches the current
 * year and included otherwise. Activity uses formatDateTime (always with year).
 */
export function formatDayTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const dayMonth =
    date.getFullYear() === now.getFullYear()
      ? DAY_MONTH_FORMAT.format(date)
      : DAY_MONTH_YEAR_FORMAT.format(date);
  return `${dayMonth} · ${TIME_FORMAT.format(date)}`;
}

/**
 * Human display name for a username: capitalise the first letter, keep the
 * rest ("tristan" -> "Tristan", "mary.jane" -> "Mary.jane"). Editable username
 * inputs should still show the stored value.
 */
export function formatPersonName(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return username;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
