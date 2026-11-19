'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FieldGroup } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Radio } from '@/components/ui/Radio';
import { Select } from '@/components/ui/Select';
import { Toast } from '@/components/ui/Toast';
import { patchJson } from '@/lib/api-client';
import { formatPersonName } from '@/lib/format';
import { applyAppearance } from '@/lib/theme';
import {
  APPEARANCES,
  APPEARANCE_LABELS,
  APP_ROLE_LABELS,
  type Appearance,
  type AuthUser,
} from '@/lib/types';
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validateUsername,
} from '@/lib/validation';
import type { LandingPageOption } from '@/server/domain/users';
import styles from './ProfileForm.module.css';

export interface ProfileFormProps {
  user: AuthUser;
  landingOptions: LandingPageOption[];
}

const AVATAR_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

interface ProfileValues {
  username: string;
  email: string;
  landingPage: string;
  appearance: Appearance;
}

function valuesFromUser(user: AuthUser): ProfileValues {
  return {
    username: user.username,
    email: user.email,
    landingPage: user.landingPage || 'home',
    appearance: user.appearance,
  };
}

/**
 * Profile: account fields, profile picture, landing page, appearance and the
 * change-password dialog. Viewers may use everything on this screen; it never
 * touches project data (build-spec §1).
 */
export function ProfileForm({ user, landingOptions }: ProfileFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<ProfileValues>(() => valuesFromUser(user));
  const [values, setValues] = useState<ProfileValues>(() => valuesFromUser(user));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(user.avatar);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(
    null,
  );
  const usernameId = useId();
  const emailId = useId();
  const landingId = useId();

  const dirty =
    values.username !== saved.username ||
    values.email !== saved.email ||
    values.landingPage !== saved.landingPage ||
    values.appearance !== saved.appearance;

  const update = <K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const categoryOptions =
    landingOptions.some((option) => option.value === values.landingPage) ||
    values.landingPage === 'home'
      ? landingOptions
      : [
          ...landingOptions,
          { value: values.landingPage, label: 'Current landing page' },
        ];

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !dirty) return;

    const errors: Record<string, string> = {};
    const usernameError = validateUsername(values.username);
    const emailError = validateEmail(values.email);
    if (usernameError) errors.username = usernameError;
    if (emailError) errors.email = emailError;
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) {
      if (errors.username) usernameRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      const result = await patchJson<{ user: AuthUser }>('/api/me', {
        username: normalizeUsername(values.username),
        email: normalizeEmail(values.email),
        landingPage: values.landingPage,
        appearance: values.appearance,
      });
      if (!result.ok) {
        if (result.fields) setFieldErrors(result.fields);
        setFormError(result.message);
        return;
      }
      const next = valuesFromUser(result.data.user);
      setSaved(next);
      setValues(next);
      applyAppearance(next.appearance);
      setToast({ message: 'Profile saved.', tone: 'success' });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setValues(saved);
    setFieldErrors({});
    setFormError(null);
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!AVATAR_MIME.includes(file.type)) {
      setAvatarError('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('Choose an image up to 2 MB.');
      return;
    }

    setAvatarError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const response = await fetch('/api/me/avatar', { method: 'POST', body: formData });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const message =
          typeof payload === 'object' &&
          payload !== null &&
          typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
            ? (payload as { error: { message: string } }).error.message
            : 'Could not upload the picture. Try again.';
        setAvatarError(message);
        return;
      }
      const nextAvatar =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { avatar?: unknown }).avatar === 'string'
          ? (payload as { avatar: string }).avatar
          : null;
      if (nextAvatar) setAvatar(nextAvatar);
      setToast({ message: 'Profile picture updated.', tone: 'success' });
      router.refresh();
    } catch {
      setAvatarError('Could not reach the server. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader title="Account" />
        <div className={styles.identity}>
          <Avatar name={formatPersonName(user.username)} src={avatar} size={48} />
          <div className={styles.identityText}>
            <p className={styles.identityName}>{formatPersonName(user.username)}</p>
            <p className={styles.identityRole}>{APP_ROLE_LABELS[user.appRole]}</p>
          </div>
          <div className={styles.identityAction}>
            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_MIME.join(',')}
              className="visually-hidden"
              onChange={(event) => {
                void handleAvatarChange(event);
              }}
              aria-label="Choose a profile picture"
              tabIndex={-1}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon name="photo_camera" size={18} />}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
              className={styles.changePicture}
            >
              Change picture
            </Button>
          </div>
        </div>
        {avatarError ? (
          <div className={styles.avatarError}>
            <Notice tone="error">{avatarError}</Notice>
          </div>
        ) : null}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <Field label="Username" htmlFor={usernameId} error={fieldErrors.username} labelWidth={190}>
            <Input
              ref={usernameRef}
              id={usernameId}
              name="username"
              autoComplete="username"
              value={values.username}
              onChange={(event) => update('username', event.target.value)}
              invalid={Boolean(fieldErrors.username)}
              className={styles.usernameInput}
            />
          </Field>

          <Field label="Email" htmlFor={emailId} error={fieldErrors.email} labelWidth={190}>
            <Input
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={(event) => update('email', event.target.value)}
              invalid={Boolean(fieldErrors.email)}
              className={styles.emailInput}
            />
          </Field>

          <Field label="Landing page" htmlFor={landingId} labelWidth={190}>
            <Select
              id={landingId}
              name="landingPage"
              value={values.landingPage}
              onChange={(event) => update('landingPage', event.target.value)}
              className={styles.landingSelect}
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <FieldGroup legend="Appearance" className={styles.appearanceField}>
            <div className={styles.radioRow}>
              {APPEARANCES.map((appearance) => (
                <Radio
                  key={appearance}
                  name="appearance"
                  value={appearance}
                  label={APPEARANCE_LABELS[appearance]}
                  checked={values.appearance === appearance}
                  onChange={() => update('appearance', appearance)}
                />
              ))}
            </div>
          </FieldGroup>

          <Field label="Password" htmlFor="profile-password" labelWidth={190}>
            <Button
              id="profile-password"
              variant="ghost"
              className={styles.passwordButton}
              aria-label="Change password"
              onClick={() => setPasswordOpen(true)}
            >
              Change password
            </Button>
          </Field>

          <div className={styles.actions}>
            <Button
              type="submit"
              loading={saving}
              disabled={!dirty}
              className={styles.saveButton}
            >
              Save changes
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={handleCancel}
              disabled={!dirty || saving}
              className={styles.cancelButton}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>

      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onChanged={() => {
          setPasswordOpen(false);
          setToast({ message: 'Password changed.', tone: 'success' });
        }}
      />

      <Toast
        open={toast !== null}
        message={toast?.message ?? ''}
        tone={toast?.tone ?? 'success'}
        onClose={() => setToast(null)}
      />
    </>
  );
}

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

interface PasswordValues {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}

const EMPTY_PASSWORDS: PasswordValues = {
  currentPassword: '',
  newPassword: '',
  confirmation: '',
};

/** Change-password dialog: current password is required and verified server-side. */
export function ChangePasswordDialog({ open, onClose, onChanged }: ChangePasswordDialogProps) {
  const currentRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<PasswordValues>(EMPTY_PASSWORDS);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setValues(EMPTY_PASSWORDS);
      setFieldErrors({});
      setFormError(null);
      setSaving(false);
    }
  }, [open]);

  const update = (key: keyof PasswordValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const errors: Record<string, string> = {};
    if (!values.currentPassword) errors.currentPassword = 'Enter your current password.';
    if (!values.newPassword) errors.newPassword = 'Enter a new password.';
    else if (values.newPassword.length < 8) {
      errors.newPassword = 'Password must be at least 8 characters.';
    }
    if (values.confirmation !== values.newPassword) {
      errors.confirmation = 'Passwords do not match.';
    }
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) {
      currentRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const error =
          typeof payload === 'object' && payload !== null
            ? (payload as { error?: { message?: unknown; fields?: unknown } }).error
            : undefined;
        const fields =
          error && typeof error.fields === 'object' && error.fields !== null
            ? (error.fields as Record<string, unknown>)
            : null;
        if (fields) {
          const mapped: Record<string, string> = {};
          for (const [key, value] of Object.entries(fields)) {
            if (typeof value === 'string') mapped[key] = value;
          }
          setFieldErrors(mapped);
        }
        setFormError(
          typeof error?.message === 'string'
            ? error.message
            : 'Could not change the password. Try again.',
        );
        return;
      }
      onChanged();
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change password"
      dismissible={!saving}
      footer={
        <>
          <Button type="submit" form="change-password-form" loading={saving}>
            Save password
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </>
      }
    >
      <form id="change-password-form" className={styles.dialogForm} onSubmit={handleSubmit} noValidate>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Field
          label="Current password"
          htmlFor="password-current"
          error={fieldErrors.currentPassword}
          labelWidth={160}
        >
          <Input
            ref={currentRef}
            id="password-current"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={values.currentPassword}
            onChange={(event) => update('currentPassword', event.target.value)}
            invalid={Boolean(fieldErrors.currentPassword)}
            className={styles.dialogInput}
          />
        </Field>
        <Field
          label="New password"
          htmlFor="password-new"
          error={fieldErrors.newPassword}
          labelWidth={160}
        >
          <Input
            id="password-new"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={values.newPassword}
            onChange={(event) => update('newPassword', event.target.value)}
            invalid={Boolean(fieldErrors.newPassword)}
            className={styles.dialogInput}
          />
        </Field>
        <Field
          label="Confirm password"
          htmlFor="password-confirmation"
          error={fieldErrors.confirmation}
          labelWidth={160}
        >
          <Input
            id="password-confirmation"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            value={values.confirmation}
            onChange={(event) => update('confirmation', event.target.value)}
            invalid={Boolean(fieldErrors.confirmation)}
            className={styles.dialogInput}
          />
        </Field>
      </form>
    </Dialog>
  );
}
