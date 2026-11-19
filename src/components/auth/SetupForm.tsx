'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { postJson } from '@/lib/api-client';
import {
  cleanTitle,
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateUsername,
} from '@/lib/validation';
import styles from './AuthForm.module.css';

export function SetupForm() {
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
    const usernameError = validateUsername(values.username);
    const emailError = validateEmail(values.email);
    const passwordError = validatePassword(values.password);
    const confirmationError = validatePasswordConfirmation(values.password, values.confirmation);
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
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.intro}>
        <h1 className={styles.heading}>Create account</h1>
        <p className={styles.subheading}>Set up your first Admin account</p>
        <p className={styles.description}>This account manages your Kapo installation.</p>
      </div>

      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <div className={styles.fields}>
        <Field label="Username" htmlFor="setup-username" error={fieldErrors.username} labelWidth={190}>
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
        <Field label="Email" htmlFor="setup-email" error={fieldErrors.email} labelWidth={190}>
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
        <Field label="Password" htmlFor="setup-password" error={fieldErrors.password} labelWidth={190}>
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
          label="Confirm password"
          htmlFor="setup-confirmation"
          error={fieldErrors.confirmation}
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

      <p className={styles.hint}>Your initials are used until you choose a profile picture.</p>

      <div className={styles.actions}>
        <Button type="submit" loading={submitting} className={styles.submit}>
          Create account
        </Button>
      </div>
    </form>
  );
}
