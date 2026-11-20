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
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@/lib/validation';
import type { AccountUser } from '@/server/domain/users';
import styles from './UsersManager.module.css';

export interface UsersManagerProps {
  users: AccountUser[];
  defaultRole: AppRole;
}

const ROLE_SHORT_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  user: 'User',
  viewer: 'Viewer',
};

function sortUsers(users: AccountUser[]): AccountUser[] {
  return [...users].sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
}

/**
 * Application user management (Admin only): account list with inline role
 * changes and add/edit dialogs. Every mutation is validated again server-side;
 * the last application Admin cannot be demoted.
 */
export function UsersManager({ users, defaultRole }: UsersManagerProps) {
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
      notify(`${formatPersonName(account.username)} is now ${ROLE_SHORT_LABELS[appRole]}.`);
      router.refresh();
    } catch {
      setListError('Could not reach the server. Check your connection and try again.');
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
        ? `Account ${formatPersonName(user.username)} created.`
        : 'Account saved.',
    );
    router.refresh();
  };

  return (
    <>
      <Card className={styles.card}>
        <CardHeader
          title="Users"
          description="Application roles do not grant access to private projects."
        />

        {listError ? (
          <div className={styles.listError}>
            <Notice tone="error">{listError}</Notice>
          </div>
        ) : null}

        <ul className={styles.userList} aria-label="Accounts">
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
                  aria-label={`Application role for ${formatPersonName(account.username)}`}
                  value={account.appRole}
                  disabled={saving}
                  onChange={(event) => {
                    void changeRole(account, event.target.value as AppRole);
                  }}
                  className={styles.roleSelect}
                >
                  {APP_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_SHORT_LABELS[role]}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Icon name="edit" size={18} />}
                  aria-label={`Edit ${formatPersonName(account.username)}`}
                  onClick={() => {
                    setListError(null);
                    setDialog({ mode: 'edit', user: account });
                  }}
                  className={styles.editButton}
                >
                  Edit
                </Button>
              </li>
            );
          })}
        </ul>

        <p className={styles.helper}>At least one application Admin must remain.</p>

        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => {
              setListError(null);
              setDialog({ mode: 'add' });
            }}
          >
            Add user
          </Button>
          <LinkButton href="/" variant="quiet">
            Cancel
          </LinkButton>
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
    const usernameError = validateUsername(values.username);
    const emailError = validateEmail(values.email);
    if (usernameError) errors.username = usernameError;
    if (emailError) errors.email = emailError;
    if (mode === 'add') {
      const passwordError = validatePassword(values.password);
      if (passwordError) errors.password = passwordError;
    } else if (values.password.length > 0) {
      const passwordError = validatePassword(values.password);
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
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'add' ? 'Add user' : 'Edit user'}
      description="Application administration"
      dismissible={!saving}
      footer={
        <>
          <Button type="submit" form="user-dialog-form" loading={saving}>
            {mode === 'add' ? 'Create user' : 'Save account'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </>
      }
    >
      <form
        id="user-dialog-form"
        className={styles.dialogForm}
        onSubmit={handleSubmit}
        noValidate
        aria-label={mode === 'add' ? 'Add user' : 'Edit user'}
      >
        {formError ? <Notice tone="error">{formError}</Notice> : null}

        <Field
          label="Username"
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
          label="Email"
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
          label="Application role"
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
                {ROLE_SHORT_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Initial / reset password"
          htmlFor="user-dialog-password"
          error={fieldErrors.password}
          hint={mode === 'edit' ? 'Leave blank to keep the current password.' : undefined}
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

        <Notice tone="info" title="Roles do not grant private access">
          Changing an application role does not bypass project permissions. A change that removes
          the last effective Admin is rejected.
        </Notice>
      </form>
    </Dialog>
  );
}
