'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { postJson } from '@/lib/api-client';
import { normalizeUsername } from '@/lib/validation';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n/catalog';
import styles from './AuthForm.module.css';

const SSO_ERROR_MESSAGE_KEYS = {
  sso_unavailable: 'auth.ssoUnavailable',
  sso_state_invalid: 'auth.ssoExpired',
  sso_denied: 'auth.ssoDenied',
  sso_failed: 'auth.ssoFailed',
  email_required: 'auth.ssoEmailRequired',
  email_invalid: 'auth.ssoEmailRequired',
  email_not_verified: 'auth.ssoEmailNotVerified',
  email_ambiguous: 'auth.ssoEmailAmbiguous',
  account_conflict: 'auth.ssoAccountConflict',
  account_not_found: 'auth.ssoAccountNotFound',
  invalid_claims: 'auth.ssoFailed',
} as const satisfies Record<string, MessageKey>;

function ssoErrorMessageKey(code: string | null): MessageKey | null {
  if (!code) return null;
  return (
    (SSO_ERROR_MESSAGE_KEYS as Record<string, MessageKey>)[code] ?? 'auth.ssoFailed'
  );
}

export interface LoginFormProps {
  ssoEnabled: boolean;
  ssoProviderName: string;
  passwordLoginEnabled: boolean;
  errorCode: string | null;
}

export function LoginForm({
  ssoEnabled,
  ssoProviderName,
  passwordLoginEnabled,
  errorCode,
}: LoginFormProps) {
  const { t } = useI18n();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const ssoErrorKey = ssoErrorMessageKey(errorCode);
  const ssoError = ssoErrorKey
    ? t(ssoErrorKey, { provider: ssoProviderName })
    : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const errors: Record<string, string> = {};
    if (!normalizeUsername(username)) errors.username = t('auth.usernameRequired');
    if (!password) errors.password = t('auth.passwordRequired');
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) {
      (errors.username ? usernameRef : null)?.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await postJson<{ user: { id: string }; landingHref?: string }>(
        '/api/auth/login',
        {
          username: normalizeUsername(username),
          password,
        },
      );
      if (!result.ok) {
        if (result.fields) setFieldErrors(result.fields);
        setFormError(
          result.status === 429 ? t('auth.tooManyAttempts') : result.message,
        );
        return;
      }
      window.location.assign(result.data.landingHref ?? '/');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.form}>
      <h1 className={styles.heading}>{t('auth.signIn')}</h1>

      {ssoError ? <Notice tone="error">{ssoError}</Notice> : null}

      {ssoEnabled ? (
        <a className={styles.ssoButton} href="/api/auth/pocketid/start">
          {t('auth.continueWith', { provider: ssoProviderName })}
        </a>
      ) : null}

      {!ssoEnabled && !passwordLoginEnabled ? (
        <Notice tone="info">{t('auth.passwordLoginDisabled')}</Notice>
      ) : null}

      {ssoEnabled && passwordLoginEnabled ? (
        <div className={styles.divider} aria-hidden="true">
          {t('auth.or')}
        </div>
      ) : null}

      {passwordLoginEnabled ? (
        <form
          className={styles.form}
          onSubmit={handleSubmit}
          noValidate
          aria-label={t('auth.signInForm')}
        >
          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <div className={styles.fields}>
            <Field
              label={t('auth.username')}
              htmlFor="login-username"
              error={fieldErrors.username}
              required
              labelWidth={190}
            >
              <Input
                ref={usernameRef}
                id="login-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                invalid={Boolean(fieldErrors.username)}
                className={styles.input}
              />
            </Field>
            <Field
              label={t('auth.password')}
              htmlFor="login-password"
              error={fieldErrors.password}
              required
              labelWidth={190}
            >
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                invalid={Boolean(fieldErrors.password)}
                className={styles.input}
              />
            </Field>
          </div>

          <div className={styles.actions}>
            <Button type="submit" loading={submitting} className={styles.submit}>
              {t('auth.signIn')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
