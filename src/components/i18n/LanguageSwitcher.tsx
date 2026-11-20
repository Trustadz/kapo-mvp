'use client';

import { useId } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/ui/Select';
import { LOCALES, LOCALE_LABELS } from '@/i18n/config';
import { writeLocaleCookie } from '@/i18n/cookie';
import { useI18n } from '@/i18n/client';
import styles from './LanguageSwitcher.module.css';

export interface LanguageSwitcherProps {
  /** Prefer the caller's label (e.g. a Field) when true. */
  hideLabel?: boolean;
  id?: string;
  className?: string;
  /** Called after the cookie is written, before the reload. */
  onChange?: (locale: (typeof LOCALES)[number]) => void;
  /** Supplied by the shared Field so its hint is announced with the select. */
  'aria-describedby'?: string;
}

/**
 * Accessible language picker. Writing the cookie and reloading the current URL
 * keeps the server-rendered language, `<html lang>`, dates and every client
 * string in sync while preserving the page (and its query parameters).
 */
export function LanguageSwitcher({
  hideLabel = false,
  id,
  className,
  onChange,
  'aria-describedby': describedBy,
}: LanguageSwitcherProps) {
  const { locale, t } = useI18n();
  const generatedId = useId();
  const selectId = id ?? `language-${generatedId}`;

  return (
    <span className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      {hideLabel ? null : (
        <span className={styles.label} aria-hidden="true">
          <Icon name="translate" size={18} />
          {t('language.label')}
        </span>
      )}
      <Select
        id={selectId}
        className={styles.select}
        aria-label={t('language.label')}
        aria-describedby={describedBy}
        value={locale}
        onChange={(event) => {
          const next = event.target.value === 'nl' ? 'nl' : 'en';
          writeLocaleCookie(next);
          onChange?.(next);
          window.location.reload();
        }}
      >
        {LOCALES.map((option) => (
          <option key={option} value={option}>
            {LOCALE_LABELS[option]}
          </option>
        ))}
      </Select>
    </span>
  );
}
