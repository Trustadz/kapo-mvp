/**
 * Client-safe i18n surface. Server components must import `./server` instead;
 * that module is the only one that touches `next/headers`.
 */
export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_PATH,
  LOCALE_LABELS,
  isLocale,
  parseLocale,
  type Locale,
} from './config';
export { CATALOGS, interpolate, plural, t, type Vars } from './translate';
export type { MessageKey, Messages, PluralKey } from './catalog';
export {
  formatDate,
  formatDateTime,
  formatDayTime,
  formatNumber,
  formatRelative,
  formatTime,
} from './format';
export {
  ACCOUNT_ROLE_MESSAGE_KEYS,
  APPEARANCE_MESSAGE_KEYS,
  APP_ROLE_MESSAGE_KEYS,
  COLLECTION_VIEW_MESSAGE_KEYS,
  DASHBOARD_WIDGET_MESSAGE_KEYS,
  PROJECT_FIELD_MESSAGE_KEYS,
  VIEW_FIELD_MESSAGE_KEYS,
  SHORT_ROLE_MESSAGE_KEYS,
} from './domain-labels';
