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
