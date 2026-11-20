import { cookies } from 'next/headers';
import { LOCALE_COOKIE, parseLocale, type Locale } from './config';
import {
  formatDate,
  formatDateTime,
  formatDayTime,
  formatNumber,
  formatRelative,
  formatTime,
} from './format';
import { plural as translatePlural, t as translate, type Vars } from './translate';
import type { MessageKey, PluralKey } from './catalog';

/**
 * Server-only i18n helper. It reads the locale cookie through `next/headers`
 * (async in Next 16) and returns locale-bound translation and formatting
 * functions. Never import this module from a client component.
 */

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

export interface ServerI18n {
  locale: Locale;
  t(key: MessageKey, vars?: Vars): string;
  plural(key: PluralKey, count: number, vars?: Vars): string;
  formatDate(iso: string | Date): string;
  formatTime(iso: string | Date): string;
  formatDateTime(iso: string | Date): string;
  formatDayTime(iso: string | Date, now?: Date): string;
  formatNumber(value: number): string;
  formatRelative(value: string | Date, now?: Date): string;
}

export function createServerI18n(locale: Locale): ServerI18n {
  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    plural: (key, count, vars) => translatePlural(locale, key, count, vars),
    formatDate: (iso) => formatDate(locale, iso),
    formatTime: (iso) => formatTime(locale, iso),
    formatDateTime: (iso) => formatDateTime(locale, iso),
    formatDayTime: (iso, now) => formatDayTime(locale, iso, now),
    formatNumber: (value) => formatNumber(locale, value),
    formatRelative: (value, now) => formatRelative(locale, value, now),
  };
}

export async function getI18n(): Promise<ServerI18n> {
  return createServerI18n(await getLocale());
}
