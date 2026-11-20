'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from './config';
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

/** Locale-bound API returned by `useI18n()`. */
export interface I18nContextValue {
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

export function createI18n(locale: Locale): I18nContextValue {
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

/**
 * English fallback so isolated component renders (unit tests, storybook-style
 * snapshots) work without a provider while the real app always provides one.
 */
const I18nContext = createContext<I18nContextValue>(createI18n(DEFAULT_LOCALE));

export interface I18nProviderProps {
  locale: Locale;
  children: ReactNode;
}

export function I18nProvider({ locale, children }: I18nProviderProps) {
  const value = useMemo(() => createI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
