'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Toast } from '@/components/ui/Toast';
import { useToastMessage } from '@/components/ui/use-live-announcer';
import { requestJson } from '@/lib/api-client';
import { formatPersonName } from '@/lib/format';
import { APP_ROLES, type AppRole } from '@/lib/types';
import { SHORT_ROLE_MESSAGE_KEYS } from '@/i18n/domain-labels';
import { useI18n } from '@/i18n/client';
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@/lib/validation';
import type { AccountUser } from '@/server/domain/users';
import { cn } from '@/lib/cn';
import styles from './UsersManager.module.css';

export interface UsersManagerProps {
  users: AccountUser[];
  defaultRole: AppRole;
  /** Render without the outer Card/padding when embedded in a settings tab. */
  embedded?: boolean;
}

function sortUsers(users: AccountUser[]): AccountUser[] {
  return [...users].sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
}

/**
 * Application user management (Admin only): account list with inline role
 * changes and add/edit dialogs. Every mutation is validated again server-side;
 * the last application Admin cannot be demoted.
 */
export function UsersManager({ users, defaultRole, embedded = false }: UsersManagerProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [list, setList] = useState<AccountUser[]>(() => sortUsers(users));
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; user: AccountUser } | null
  >(null);
  const { toast, notify, dismiss } = useToastMessage();

  const changeRole = async (account: AccountUser, appRole: AppRole) => {
    if (appRole === account.appRole) return;
    setRoleSavingId(account.id);
    setListError(null);
    try {
      const result = await requestJson<{ user: AccountUser }>('/api/users', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: account.id, appRole }),
      });
      if (!result.ok) {
        setListError(result.message);
        return;
      }
      setList((current) =>
        sortUsers(current.map((entry) => (entry.id === account.id ? result.data.user : entry))),
      );
      notify(
        t('users.roleChanged', {
          name: formatPersonName(account.username),
          role: t(SHORT_ROLE_MESSAGE_KEYS[appRole]),
        }),
      );
      router.refresh();
    } catch {
      setListError(t('common.networkError'));
    } finally {
      setRoleSavingId(null);
    }
  };

  const handleSaved = (user: AccountUser, mode: 'add' | 'edit') => {
    setList((current) => {
      const without = current.filter((entry) => entry.id !== user.id);
      return sortUsers([...without, user]);
    });
    setDialog(null);
    notify(
      mode === 'add'
        ? t('users.accountCreated', { name: formatPersonName(user.username) })
        : t('users.accountSaved'),
    );
    router.refresh();
  };

  return (
    <>
      <Card className={cn(styles.card, embedded && styles.embeddedCard)}>
        <CardHeader
          title={t('users.users')}
          description={t('users.description')}
        />

        {listError ? (
          <div className={styles.listError}>
            <Notice tone="error">{listError}</Notice>
          </div>
        ) : null}

        <ul className={styles.userList} aria-label={t('users.accountsAria')}>
          {list.map((account) => {
            const saving = roleSavingId === account.id;
            return (
              <li key={account.id} className={styles.userRow}>
                <div className={styles.identity}>
                  <Avatar
                    name={formatPersonName(account.username)}
                    src={account.avatar}
                    size={32}
                    decorative
                  />
                  <span className={styles.username}>{formatPersonName(account.username)}</span>
                </div>
                <Select
                  aria-label={t('users.roleFor', {
                    name: formatPersonName(account.username),
                  })}
                  value={account.appRole}
                  disabled={saving}
                  onChange={(event) => {
                    void changeRole(account, event.target.value as AppRole);
                  }}
                  className={styles.roleSelect}
                >
                  {APP_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(SHORT_ROLE_MESSAGE_KEYS[role])}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Icon name="edit" size={18} />}
                  aria-label={t('users.editName', {
                    name: formatPersonName(account.username),
                  })}
                  onClick={() => {
                    setListError(null);
                    setDialog({ mode: 'edit', user: account });
                  }}
                  className={styles.editButton}
                >
                  {t('common.edit')}
                </Button>
              </li>
            );
          })}
        </ul>

        <p className={styles.helper}>{t('users.helper')}</p>

        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => {
              setListError(null);
              setDialog({ mode: 'add' });
            }}
          >
            {t('users.addUser')}
          </Button>
          {embedded ? null : (
            <LinkButton href="/" variant="quiet">
              {t('common.cancel')}
            </LinkButton>
          )}
        </div>
      </Card>

      {dialog ? (
        <UserDialog
          key={dialog.mode === 'edit' ? dialog.user.id : 'add'}
          open
          mode={dialog.mode}
          user={dialog.mode === 'edit' ? dialog.user : null}
          defaultRole={defaultRole}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      ) : null}

      <Toast
        open={toast !== null}
        message={toast?.message ?? ''}
        tone={toast?.tone ?? 'success'}
        announcementKey={toast?.sequence}
        onClose={dismiss}
      />
    </>
  );
}

interface UserDialogProps {
  open: boolean;
  mode: 'add' | 'edit';
  user: AccountUser | null;
  defaultRole: AppRole;
  onClose: () => void;
  onSaved: (user: AccountUser, mode: 'add' | 'edit') => void;
}

interface UserValues {
  username: string;
  email: string;
  appRole: AppRole;
  password: string;
}

/** Add/edit dialog. Add requires an initial password; edit can reset it. */
function UserDialog({ open, mode, user, defaultRole, onClose, onSaved }: UserDialogProps) {
  const { locale, t } = useI18n();
  const [values, setValues] = useState<UserValues>(() => ({
    username: user?.username ?? '',
    email: user?.email ?? '',
    appRole: user?.appRole ?? defaultRole,
    password: '',
  }));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof UserValues>(key: K, value: UserValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const errors: Record<string, string> = {};
    const usernameError = validateUsername(values.username, locale);
    const emailError = validateEmail(values.email, locale);
    if (usernameError) errors.username = usernameError;
    if (emailError) errors.email = emailError;
    if (mode === 'add') {
      const passwordError = validatePassword(values.password, locale);
      if (passwordError) errors.password = passwordError;
    } else if (values.password.length > 0) {
      const passwordError = validatePassword(values.password, locale);
      if (passwordError) errors.password = passwordError;
    }
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        username: normalizeUsername(values.username),
        email: normalizeEmail(values.email),
        appRole: values.appRole,
      };
      if (values.password.length > 0) body.password = values.password;
      const result = await requestJson<{ user: AccountUser }>('/api/users', {
        method: mode === 'add' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'add' ? { ...body, password: values.password } : { ...body, id: user?.id }),
      });
      if (!result.ok) {
        if (result.fields) setFieldErrors(result.fields);
        setFormError(result.message);
        return;
      }
      onSaved(result.data.user, mode);
    } catch {
      setFormError(t('common.networkError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'add' ? t('users.addUser') : t('users.editUser')}
      dismissible={!saving}
      footer={
        <>
          <Button type="submit" form="user-dialog-form" loading={saving}>
            {mode === 'add' ? t('users.createUser') : t('users.saveAccount')}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </>
      }
    >
      <form
        id="user-dialog-form"
        className={styles.dialogForm}
        onSubmit={handleSubmit}
        noValidate
        aria-label={mode === 'add' ? t('users.addUser') : t('users.editUser')}
      >
        {formError ? <Notice tone="error">{formError}</Notice> : null}

        <Field
          label={t('auth.username')}
          htmlFor="user-dialog-username"
          error={fieldErrors.username}
          required
          labelWidth={160}
        >
          <Input
            id="user-dialog-username"
            name="username"
            autoComplete="off"
            autoCapitalize="none"
            value={values.username}
            onChange={(event) => update('username', event.target.value)}
            invalid={Boolean(fieldErrors.username)}
            className={styles.dialogInput}
          />
        </Field>

        <Field
          label={t('auth.email')}
          htmlFor="user-dialog-email"
          error={fieldErrors.email}
          required
          labelWidth={160}
        >
          <Input
            id="user-dialog-email"
            name="email"
            type="email"
            autoComplete="off"
            value={values.email}
            onChange={(event) => update('email', event.target.value)}
            invalid={Boolean(fieldErrors.email)}
            className={styles.dialogInput}
          />
        </Field>

        <Field
          label={t('users.applicationRole')}
          htmlFor="user-dialog-role"
          error={fieldErrors.appRole}
          required
          labelWidth={160}
        >
          <Select
            id="user-dialog-role"
            name="appRole"
            value={values.appRole}
            onChange={(event) => update('appRole', event.target.value as AppRole)}
            className={styles.dialogSelect}
          >
            {APP_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(SHORT_ROLE_MESSAGE_KEYS[role])}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('users.initialResetPassword')}
          htmlFor="user-dialog-password"
          error={fieldErrors.password}
          hint={mode === 'edit' ? t('users.leaveBlank') : undefined}
          required={mode === 'add'}
          labelWidth={160}
        >
          <Input
            id="user-dialog-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={(event) => update('password', event.target.value)}
            invalid={Boolean(fieldErrors.password)}
            className={styles.dialogInput}
          />
        </Field>

      </form>
    </Dialog>
  );
}
