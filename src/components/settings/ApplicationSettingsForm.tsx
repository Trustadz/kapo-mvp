'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Toast } from '@/components/ui/Toast';
import { useToastMessage } from '@/components/ui/use-live-announcer';
import { requestJson } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import {
  APP_ROLES,
  COLLECTION_VIEWS,
  COLLECTION_VIEW_LABELS,
  type AppRole,
  type CollectionView,
} from '@/lib/types';
import type { BackupStatus } from '@/server/backup';
import type { ApplicationSettings } from '@/server/domain/settings';
import styles from './ApplicationSettingsForm.module.css';

export interface ApplicationSettingsFormProps {
  settings: ApplicationSettings;
  backupStatus: BackupStatus;
}

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  user: 'User',
  viewer: 'Viewer',
};

interface SettingsValues {
  defaultAccountRole: AppRole;
  enabledViews: CollectionView[];
  backupEnabled: boolean;
  backupStartTime: string;
  backupRetention: number;
}

function valuesFromSettings(settings: ApplicationSettings): SettingsValues {
  return {
    defaultAccountRole: settings.defaultAccountRole,
    enabledViews: settings.enabledViews,
    backupEnabled: settings.backupEnabled,
    backupStartTime: settings.backupStartTime,
    backupRetention: settings.backupRetention,
  };
}

/**
 * Application settings (Admin): default account role, fixed trash retention,
 * the collection views available to projects and the rolling backup schedule
 * (issue #13). At least one view must remain.
 */
export function ApplicationSettingsForm({
  settings,
  backupStatus,
}: ApplicationSettingsFormProps) {
  const [saved, setSaved] = useState<SettingsValues>(() => valuesFromSettings(settings));
  const [values, setValues] = useState<SettingsValues>(() => valuesFromSettings(settings));
  const [status, setStatus] = useState<BackupStatus>(backupStatus);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast, notify, dismiss } = useToastMessage();

  const dirty =
    values.defaultAccountRole !== saved.defaultAccountRole ||
    values.enabledViews.length !== saved.enabledViews.length ||
    values.enabledViews.some((view, index) => view !== saved.enabledViews[index]) ||
    values.backupEnabled !== saved.backupEnabled ||
    values.backupStartTime !== saved.backupStartTime ||
    values.backupRetention !== saved.backupRetention;

  const clearFieldError = (field: string) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const toggleView = (view: CollectionView, checked: boolean) => {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.enabledViews;
      return next;
    });
    if (!checked && values.enabledViews.length <= 1) {
      setFieldErrors({ enabledViews: 'At least one view must remain available.' });
      return;
    }
    setValues((current) => {
      if (checked) {
        return {
          ...current,
          enabledViews: COLLECTION_VIEWS.filter(
            (candidate) => candidate === view || current.enabledViews.includes(candidate),
          ),
        };
      }
      return {
        ...current,
        enabledViews: current.enabledViews.filter((candidate) => candidate !== view),
      };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !dirty) return;

    if (values.enabledViews.length === 0) {
      setFieldErrors({ enabledViews: 'At least one view must remain available.' });
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const result = await requestJson<{
        settings: ApplicationSettings;
        backupStatus?: BackupStatus;
      }>('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          defaultAccountRole: values.defaultAccountRole,
          enabledViews: values.enabledViews,
          trashRetentionDays: settings.trashRetentionDays,
          backupEnabled: values.backupEnabled,
          backupStartTime: values.backupStartTime,
          backupRetention: values.backupRetention,
        }),
      });
      if (!result.ok) {
        if (result.fields) setFieldErrors(result.fields);
        setFormError(result.message);
        return;
      }
      const next = valuesFromSettings(result.data.settings);
      setSaved(next);
      setValues(next);
      if (result.data.backupStatus) setStatus(result.data.backupStatus);
      notify('Application settings saved.');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setValues(saved);
    setFieldErrors({});
    setFormError(null);
  };

  return (
    <>
      <Card className={styles.card}>
        <CardHeader title="Application defaults" />
        <form
          className={styles.form}
          onSubmit={handleSubmit}
          noValidate
          aria-label="Application settings"
        >
          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <Field
            label="Default account role"
            htmlFor="settings-default-role"
            labelWidth={190}
          >
            <Select
              id="settings-default-role"
              name="defaultAccountRole"
              value={values.defaultAccountRole}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  defaultAccountRole: event.target.value as AppRole,
                }))
              }
              className={styles.select}
            >
              {APP_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Trash retention" htmlFor="settings-trash-retention" labelWidth={190}>
            <p id="settings-trash-retention" className={styles.fixedValue}>
              {settings.trashRetentionDays} days (fixed)
            </p>
          </Field>

          <p className={styles.note}>
            No add-on fields are required in this release; captures can be released straight from
            Inbox.
          </p>

          <fieldset
            className={styles.viewsFieldset}
            aria-describedby={
              fieldErrors.enabledViews ? 'views-hint views-error' : 'views-hint'
            }
            aria-invalid={fieldErrors.enabledViews ? true : undefined}
          >
            <legend className={styles.viewsLegend}>Views available to projects</legend>
            {fieldErrors.enabledViews ? (
              <p id="views-error" className={styles.fieldError} role="alert">
                {fieldErrors.enabledViews}
              </p>
            ) : null}
            <div className={styles.viewsList}>
              {COLLECTION_VIEWS.map((view) => (
                <Checkbox
                  key={view}
                  id={`settings-view-${view}`}
                  name="enabledViews"
                  value={view}
                  label={COLLECTION_VIEW_LABELS[view]}
                  checked={values.enabledViews.includes(view)}
                  onChange={(event) => toggleView(view, event.target.checked)}
                />
              ))}
            </div>
          </fieldset>
          <p id="views-hint" className={styles.hint}>
            At least one view must remain available.
          </p>

          <fieldset className={styles.backupFieldset}>
            <legend className={styles.viewsLegend}>Backups</legend>
            <p className={styles.note}>
              Every run stores a consistent copy of the database and the uploads folder on the
              server. The oldest backups are removed automatically after a successful run.
            </p>
            <Checkbox
              id="settings-backup-enabled"
              name="backupEnabled"
              label="Automatic daily backups"
              description="Runs inside the app at the configured local time."
              checked={values.backupEnabled}
              onChange={(event) => {
                clearFieldError('backupEnabled');
                setValues((current) => ({
                  ...current,
                  backupEnabled: event.target.checked,
                }));
              }}
            />
            <div className={styles.backupFields}>
              <Field
                label="Start time"
                htmlFor="settings-backup-start"
                labelWidth={190}
                hint="Server local time (set TZ for the container)."
                error={fieldErrors.backupStartTime}
              >
                <Input
                  id="settings-backup-start"
                  name="backupStartTime"
                  type="time"
                  value={values.backupStartTime}
                  onChange={(event) => {
                    clearFieldError('backupStartTime');
                    setValues((current) => ({
                      ...current,
                      backupStartTime: event.target.value,
                    }));
                  }}
                  className={styles.timeInput}
                />
              </Field>
              <Field
                label="Keep backups"
                htmlFor="settings-backup-retention"
                labelWidth={190}
                hint="Between 1 and 30; the oldest are pruned after each run."
                error={fieldErrors.backupRetention}
              >
                <Input
                  id="settings-backup-retention"
                  name="backupRetention"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={values.backupRetention}
                  onChange={(event) => {
                    clearFieldError('backupRetention');
                    setValues((current) => ({
                      ...current,
                      backupRetention: Number(event.target.value),
                    }));
                  }}
                  className={styles.numberInput}
                />
              </Field>
            </div>
            <dl className={styles.backupStatus}>
              <div className={styles.backupStatusRow}>
                <dt>Last backup</dt>
                <dd>
                  {status.lastBackup ? (
                    <>
                      <span suppressHydrationWarning>
                        {formatDateTime(status.lastBackup.createdAt)}
                      </span>{' '}
                      <span className={styles.backupName}>{status.lastBackup.name}</span>
                    </>
                  ) : (
                    'No backups yet'
                  )}
                </dd>
              </div>
              <div className={styles.backupStatusRow}>
                <dt>Next run</dt>
                <dd suppressHydrationWarning>
                  {status.nextRun
                    ? formatDateTime(status.nextRun)
                    : 'Automatic backups are disabled'}
                </dd>
              </div>
              <div className={styles.backupStatusRow}>
                <dt>Destination</dt>
                <dd>
                  <code className={styles.backupPath}>{status.destination}</code>
                </dd>
              </div>
            </dl>
            <p className={styles.hint}>
              Restore is manual: stop the container, replace the database and uploads from a
              chosen backup, then start it again. The README documents the exact steps.
            </p>
          </fieldset>

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
