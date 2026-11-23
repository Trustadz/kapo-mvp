'use client';

import { useId, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { cn } from '@/lib/cn';
import { Markdown } from './Markdown';
import { Tabs, tabId, tabPanelId } from './Tabs';
import { Textarea } from './Textarea';
import styles from './MarkdownTextarea.module.css';

type MarkdownTab = 'edit' | 'preview';

export interface MarkdownTextareaProps {
  /** Visible field label, associated with the textarea. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /** Extra helper text shown under the editor. */
  hint?: string;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
  invalid?: boolean;
  error?: string;
  placeholder?: string;
  name?: string;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Controlled textarea with Edit/Preview tabs for simple Markdown.
 *
 * The preview is rendered by the safe shared {@link Markdown} component; both
 * panels stay mounted (the inactive one is hidden) so switching tabs never
 * loses the draft or the cursor position. The primitive composes the normal
 * Textarea/Input styles, so it drops into existing forms unchanged.
 */
export function MarkdownTextarea({
  label,
  value,
  onChange,
  id,
  hint,
  maxLength,
  rows = 5,
  disabled = false,
  invalid = false,
  error,
  placeholder,
  name,
  className,
  autoFocus = false,
}: MarkdownTextareaProps) {
  const { t } = useI18n();
  const generatedId = useId();
  const textareaId = id ?? `markdown-textarea-${generatedId.replace(/:/g, '')}`;
  const tabsPrefix = `${textareaId}-tabs`;
  const hintId = `${textareaId}-hint`;
  const errorId = `${textareaId}-error`;
  const [tab, setTab] = useState<MarkdownTab>('edit');

  const describedBy = [hintId, error ? errorId : undefined].filter(Boolean).join(' ');

  return (
    <div className={cn(styles.root, className)}>
      <div className={styles.header}>
        <label className={styles.label} htmlFor={textareaId}>
          {label}
        </label>
        <Tabs<MarkdownTab>
          items={[
            { id: 'edit', label: t('markdown.edit') },
            { id: 'preview', label: t('markdown.preview') },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel={t('markdown.tabsAria')}
          idPrefix={tabsPrefix}
          className={styles.tabs}
        />
      </div>

      <div
        id={tabPanelId(tabsPrefix, 'edit')}
        role="tabpanel"
        aria-labelledby={tabId(tabsPrefix, 'edit')}
        hidden={tab !== 'edit'}
      >
        <Textarea
          id={textareaId}
          name={name}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          invalid={invalid || Boolean(error)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-describedby={describedBy}
        />
      </div>

      <div
        id={tabPanelId(tabsPrefix, 'preview')}
        role="tabpanel"
        aria-labelledby={tabId(tabsPrefix, 'preview')}
        hidden={tab !== 'preview'}
        className={styles.preview}
      >
        {value.trim() ? (
          <Markdown value={value} />
        ) : (
          <p className={styles.empty}>{t('markdown.emptyPreview')}</p>
        )}
      </div>

      <p id={hintId} className={styles.hint}>
        {hint ? `${hint} ` : ''}
        {t('markdown.hint')}
      </p>
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
