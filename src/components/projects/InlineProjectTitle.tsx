'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon, Input } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { ToastTone } from '@/components/ui';
import { cn } from '@/lib/cn';
import { updateProjectFields } from './api';
import styles from './InlineProjectTitle.module.css';

export interface InlineProjectTitleProps {
  projectId: string;
  title: string;
  canEdit: boolean;
  notify: (message: string, tone?: ToastTone) => void;
  /** Re-fetches the project page after a successful rename. */
  onSaved: () => void;
  className?: string;
}

/**
 * In-place project title editor.
 *
 * A Viewer or trashed project keeps a plain `<h1>`. Editors get a button that
 * looks like the title (with a subtle edit affordance) and opens an input on
 * click, Enter or Space (native button activation). Enter or blur saves,
 * Escape cancels, and an unchanged draft never sends a request. The heading
 * keeps the project title as its accessible name; the editing hint is exposed
 * through `aria-describedby`.
 */
export function InlineProjectTitle({
  projectId,
  title,
  canEdit,
  notify,
  onSaved,
  className,
}: InlineProjectTitleProps) {
  const { t } = useI18n();
  const hintId = useId();
  const errorId = useId();
  const [displayTitle, setDisplayTitle] = useState(title);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const committingRef = useRef(false);
  const skipBlurRef = useRef(false);
  const focusOnCloseRef = useRef(false);

  useEffect(() => {
    setDisplayTitle(title);
  }, [title]);

  useEffect(() => {
    if (!editing) {
      if (focusOnCloseRef.current) {
        focusOnCloseRef.current = false;
        triggerRef.current?.focus();
      }
      return;
    }
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editing]);

  if (!canEdit) {
    return <h1 className={className}>{displayTitle}</h1>;
  }

  const begin = () => {
    if (saving) return;
    skipBlurRef.current = false;
    focusOnCloseRef.current = false;
    setDraft(displayTitle);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    skipBlurRef.current = true;
    setEditing(false);
    setError(null);
    focusOnCloseRef.current = true;
  };

  const commit = async (restoreFocus: boolean) => {
    if (committingRef.current) return;
    if (draft === displayTitle) {
      skipBlurRef.current = true;
      setEditing(false);
      if (restoreFocus) focusOnCloseRef.current = true;
      return;
    }
    committingRef.current = true;
    setSaving(true);
    setError(null);
    const result = await updateProjectFields(projectId, { title: draft });
    committingRef.current = false;
    setSaving(false);
    if (!result.ok) {
      setError(result.fields?.title ?? result.message);
      // Keep the draft open so the error can be corrected; a failed blur save
      // does not steal focus back from wherever the user clicked.
      if (restoreFocus) requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    skipBlurRef.current = true;
    setDisplayTitle(result.data.project.title);
    setEditing(false);
    focusOnCloseRef.current = restoreFocus;
    notify(t('project.titleSaved'));
    onSaved();
  };

  return (
    <>
      <h1 className={cn(className, styles.root)}>
        {editing ? (
          <>
            <Input
              ref={inputRef}
              className={styles.input}
              value={draft}
              disabled={saving}
              invalid={Boolean(error)}
              aria-label={t('project.titleInput')}
              aria-describedby={error ? errorId : hintId}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commit(true);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  cancel();
                }
              }}
              onBlur={() => {
                if (skipBlurRef.current) {
                  skipBlurRef.current = false;
                  return;
                }
                void commit(false);
              }}
            />
            {error ? (
              <span id={errorId} className={styles.error} role="alert">
                {error}
              </span>
            ) : null}
          </>
        ) : (
          <button
            ref={triggerRef}
            type="button"
            className={styles.button}
            aria-describedby={hintId}
            title={t('project.editTitleHint')}
            onClick={begin}
          >
            <span className={styles.text}>{displayTitle}</span>
            <Icon name="edit" size={20} className={styles.icon} />
          </button>
        )}
      </h1>
      <span id={hintId} className="visually-hidden">
        {t('project.editTitleHint')}
      </span>
    </>
  );
}
