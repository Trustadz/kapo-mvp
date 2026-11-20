'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { InlineError } from '@/components/ui/InlineError';
import { LiveRegion } from '@/components/ui/LiveRegion';
import { useAnnouncer } from '@/components/ui/use-live-announcer';
import { cleanTitle, validateProjectTitle } from '@/lib/validation';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n/client';
import styles from './CaptureForm.module.css';

export interface CaptureFormProps {
  rootProjectId: string | null;
  variant?: 'desktop' | 'mobile';
  autoFocus?: boolean;
  onSuccess?: (title: string) => void;
  onCancel?: () => void;
  className?: string;
  /**
   * Set false when the form lives in a dialog that closes on success: the
   * parent then owns a persistent live region instead of this unmounting one.
   */
  announceSuccess?: boolean;
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
    ) {
      return (payload as { error: { message: string } }).error.message;
    }
  } catch {
    /* fall through to the generic message */
  }
  return fallback;
}

/**
 * Global capture. The only API dependency is the documented contract
 * `POST /api/projects { parentId, title }` (build-spec §7); the projects
 * builder owns that route.
 */
export function CaptureForm({
  rootProjectId,
  variant = 'desktop',
  autoFocus = false,
  onSuccess,
  onCancel,
  className,
  announceSuccess = true,
}: CaptureFormProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const { announcement, announce } = useAnnouncer();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const validationError = validateProjectTitle(title, locale);
    if (validationError) {
      setError(validationError);
      inputRef.current?.focus();
      return;
    }
    if (!rootProjectId) {
      setError(t('shell.rootUnavailable'));
      return;
    }

    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentId: rootProjectId, title: cleanTitle(title) }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, t('shell.captureFailed')));
        return;
      }
      const createdTitle = cleanTitle(title);
      const message = t('shell.captureSuccess', { title: createdTitle });
      setTitle('');
      setStatus(message);
      if (announceSuccess) announce(message);
      onSuccess?.(createdTitle);
      router.refresh();
      inputRef.current?.focus();
    } catch {
      setError(t('common.networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (variant === 'mobile') {
    return (
      <form
        className={cn(styles.form, styles.mobile, className)}
        onSubmit={handleSubmit}
        noValidate
        aria-label={t('shell.captureForm')}
      >
        <LiveRegion message={announcement.message} sequence={announcement.sequence} />
        <label className={styles.mobileLabel} htmlFor="capture-title-mobile">
          {t('shell.projectTitleLabel')}
        </label>
        <input
          ref={inputRef}
          id="capture-title-mobile"
          className={`${styles.input} ${styles.mobileInput}`}
          type="text"
          name="title"
          placeholder={t('shell.capturePlaceholder')}
          value={title}
          autoFocus={autoFocus}
          autoComplete="off"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'capture-error-mobile' : undefined}
        />
        {error ? (
          <div id="capture-error-mobile">
            <InlineError>{error}</InlineError>
          </div>
        ) : null}
        {status ? (
          <p className={styles.status}>{status}</p>
        ) : null}
        <div className={styles.mobileActions}>
          <Button type="submit" loading={submitting} disabled={!title.trim()}>
            {t('shell.createProject')}
          </Button>
          {onCancel ? (
            <Button type="button" variant="quiet" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <form
      className={cn(styles.form, className)}
      onSubmit={handleSubmit}
      noValidate
      aria-label={t('shell.captureForm')}
    >
      <LiveRegion message={announcement.message} sequence={announcement.sequence} />
      <div className={styles.field}>
        <label className="visually-hidden" htmlFor="capture-title">
          {t('shell.captureTitleLabel')}
        </label>
        <Icon name="add" size={20} className={styles.plus} />
        <input
          ref={inputRef}
          id="capture-title"
          className={styles.input}
          type="text"
          name="title"
          placeholder={t('shell.capturePlaceholder')}
          value={title}
          autoFocus={autoFocus}
          autoComplete="off"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'capture-error' : undefined}
          disabled={!rootProjectId}
        />
      </div>
      {error ? (
        <div className={styles.error} id="capture-error">
          <InlineError>{error}</InlineError>
        </div>
      ) : null}
      {status ? <p className={styles.status}>{status}</p> : null}
    </form>
  );
}
