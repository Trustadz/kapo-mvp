'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { postJson } from '@/lib/api-client';
import { normalizeUsername } from '@/lib/validation';
import styles from './AuthForm.module.css';

export function LoginForm() {
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const errors: Record<string, string> = {};
    if (!normalizeUsername(username)) errors.username = 'Enter your username.';
    if (!password) errors.password = 'Enter your password.';
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
          result.status === 429
            ? 'Too many sign-in attempts. Wait a few minutes and try again.'
            : result.message,
        );
        return;
      }
      window.location.assign(result.data.landingHref ?? '/');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <h1 className={styles.heading}>Sign in</h1>

      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <div className={styles.fields}>
        <Field label="Username" htmlFor="login-username" error={fieldErrors.username} labelWidth={190}>
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
            aria-describedby={fieldErrors.username ? 'login-username-error' : undefined}
          />
        </Field>
        <Field label="Password" htmlFor="login-password" error={fieldErrors.password} labelWidth={190}>
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
          Sign in
        </Button>
      </div>
    </form>
  );
}
