'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { postJson } from '@/lib/api-client';
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateUsername,
} from '@/lib/validation';
import { useI18n } from '@/i18n/client';
import styles from './AuthForm.module.css';

export function SetupForm() {
  const { locale, t } = useI18n();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState({
    username: '',
    email: '',
    password: '',
    confirmation: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const errors: Record<string, string> = {};
    const usernameError = validateUsername(values.username, locale);
    const emailError = validateEmail(values.email, locale);
    const passwordError = validatePassword(values.password, locale);
    const confirmationError = validatePasswordConfirmation(
      values.password,
      values.confirmation,
      locale,
    );
    if (usernameError) errors.username = usernameError;
    if (emailError) errors.email = emailError;
    if (passwordError) errors.password = passwordError;
    if (confirmationError) errors.confirmation = confirmationError;

    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) {
      if (errors.username) usernameRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await postJson<{ user: { id: string } }>('/api/setup', {
        username: normalizeUsername(values.username),
        email: normalizeEmail(values.email),
        password: values.password,
        confirmation: values.confirmation,
      });
      if (!result.ok) {
        if (result.fields) setFieldErrors(result.fields);
        setFormError(result.message);
        return;
      }
      window.location.assign('/');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-label={t('auth.createAccountForm')}>
      <div className={styles.intro}>
        <h1 className={styles.heading}>{t('auth.createAccount')}</h1>
        <p className={styles.subheading}>{t('auth.setupSubheading')}</p>
        <p className={styles.description}>{t('auth.setupDescription')}</p>
      </div>

      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <div className={styles.fields}>
        <Field
          label={t('auth.username')}
          htmlFor="setup-username"
          error={fieldErrors.username}
          required
          labelWidth={190}
        >
          <Input
            ref={usernameRef}
            id="setup-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            value={values.username}
            onChange={update('username')}
            invalid={Boolean(fieldErrors.username)}
            className={styles.input}
          />
        </Field>
        <Field
          label={t('auth.email')}
          htmlFor="setup-email"
          error={fieldErrors.email}
          required
          labelWidth={190}
        >
          <Input
            id="setup-email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={update('email')}
            invalid={Boolean(fieldErrors.email)}
            className={styles.input}
          />
        </Field>
        <Field
          label={t('auth.password')}
          htmlFor="setup-password"
          error={fieldErrors.password}
          required
          labelWidth={190}
        >
          <Input
            id="setup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={update('password')}
            invalid={Boolean(fieldErrors.password)}
            className={styles.input}
          />
        </Field>
        <Field
          label={t('auth.confirmPassword')}
          htmlFor="setup-confirmation"
          error={fieldErrors.confirmation}
          required
          labelWidth={190}
        >
          <Input
            id="setup-confirmation"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            value={values.confirmation}
            onChange={update('confirmation')}
            invalid={Boolean(fieldErrors.confirmation)}
            className={styles.input}
          />
        </Field>
      </div>

      <p className={styles.hint}>{t('auth.setupHint')}</p>

      <div className={styles.actions}>
        <Button type="submit" loading={submitting} className={styles.submit}>
          {t('auth.createAccount')}
        </Button>
      </div>
    </form>
  );
}
