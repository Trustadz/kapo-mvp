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
import { APP_ROLES, COLLECTION_VIEWS, type AppRole, type CollectionView } from '@/lib/types';
import { COLLECTION_VIEW_MESSAGE_KEYS, SHORT_ROLE_MESSAGE_KEYS } from '@/i18n/domain-labels';
import { useI18n } from '@/i18n/client';
import type { BackupStatus } from '@/server/backup';
import type { ApplicationSettings } from '@/server/domain/settings';
import styles from './ApplicationSettingsForm.module.css';

export interface ApplicationSettingsFormProps {
  settings: ApplicationSettings;
  backupStatus: BackupStatus;
}

interface SettingsValues {
  defaultAccountRole: AppRole;
  enabledViews: CollectionView[];
  trashPurgeEnabled: boolean;
  trashRetentionDays: number;
  backupEnabled: boolean;
  backupStartTime: string;
  backupRetention: number;
}

function valuesFromSettings(settings: ApplicationSettings): SettingsValues {
  return {
    defaultAccountRole: settings.defaultAccountRole,
    enabledViews: settings.enabledViews,
    trashPurgeEnabled: settings.trashPurgeEnabled,
    trashRetentionDays: settings.trashRetentionDays,
    backupEnabled: settings.backupEnabled,
    backupStartTime: settings.backupStartTime,
    backupRetention: settings.backupRetention,
  };
}

/**
 * Application settings (Admin): default account role, automatic trash
 * purge/retention, the collection views available to projects and the rolling
 * backup schedule (issues #13 and #21). At least one view must remain.
 */
export function ApplicationSettingsForm({
  settings,
  backupStatus,
}: ApplicationSettingsFormProps) {
  const { t, formatDateTime } = useI18n();
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
    values.trashPurgeEnabled !== saved.trashPurgeEnabled ||
    values.trashRetentionDays !== saved.trashRetentionDays ||
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
      setFieldErrors({ enabledViews: t('settings.oneViewRequired') });
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
      setFieldErrors({ enabledViews: t('settings.oneViewRequired') });
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
          trashPurgeEnabled: values.trashPurgeEnabled,
          trashRetentionDays: values.trashRetentionDays,
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
      notify(t('settings.saved'));
    } catch {
      setFormError(t('common.networkError'));
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
        <CardHeader title={t('settings.defaults')} />
        <form
          className={styles.form}
          onSubmit={handleSubmit}
          noValidate
          aria-label={t('settings.heading')}
        >
          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <Field
            label={t('settings.defaultRole')}
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
                  {t(SHORT_ROLE_MESSAGE_KEYS[role])}
                </option>
              ))}
            </Select>
          </Field>

          <Checkbox
            id="settings-trash-purge-enabled"
            name="trashPurgeEnabled"
            label={t('settings.trashPurgeEnabled')}
            description={t('settings.trashPurgeEnabledDescription')}
            checked={values.trashPurgeEnabled}
            onChange={(event) => {
              clearFieldError('trashPurgeEnabled');
              setValues((current) => ({
                ...current,
                trashPurgeEnabled: event.target.checked,
              }));
            }}
          />

          <Field
            label={t('settings.trashRetention')}
            htmlFor="settings-trash-retention"
            labelWidth={190}
            hint={t('settings.trashRetentionHint')}
            error={fieldErrors.trashRetentionDays}
          >
            <Input
              id="settings-trash-retention"
              name="trashRetentionDays"
              type="number"
              min={1}
              max={365}
              step={1}
              value={values.trashRetentionDays}
              onChange={(event) => {
                clearFieldError('trashRetentionDays');
                setValues((current) => ({
                  ...current,
                  trashRetentionDays: Number(event.target.value),
                }));
              }}
              className={styles.numberInput}
            />
          </Field>

          <p className={styles.note}>
            {t('settings.note')}
          </p>

          <fieldset
            className={styles.viewsFieldset}
            aria-describedby={
              fieldErrors.enabledViews ? 'views-hint views-error' : 'views-hint'
            }
            aria-invalid={fieldErrors.enabledViews ? true : undefined}
          >
            <legend className={styles.viewsLegend}>{t('settings.viewsAvailable')}</legend>
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
                  label={t(COLLECTION_VIEW_MESSAGE_KEYS[view])}
                  checked={values.enabledViews.includes(view)}
                  onChange={(event) => toggleView(view, event.target.checked)}
                />
              ))}
            </div>
          </fieldset>
          <p id="views-hint" className={styles.hint}>
            {t('settings.oneViewRequired')}
          </p>

          <fieldset className={styles.backupFieldset}>
            <legend className={styles.viewsLegend}>{t('settings.backups')}</legend>
            <p className={styles.note}>
              {t('settings.backupsNote')}
            </p>
            <Checkbox
              id="settings-backup-enabled"
              name="backupEnabled"
              label={t('settings.automaticBackups')}
              description={t('settings.automaticBackupsDescription')}
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
                label={t('settings.startTime')}
                htmlFor="settings-backup-start"
                labelWidth={190}
                hint={t('settings.startTimeHint')}
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
                label={t('settings.keepBackups')}
                htmlFor="settings-backup-retention"
                labelWidth={190}
                hint={t('settings.keepBackupsHint')}
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
                <dt>{t('settings.lastBackup')}</dt>
                <dd>
                  {status.lastBackup ? (
                    <>
                      <span suppressHydrationWarning>
                        {formatDateTime(status.lastBackup.createdAt)}
                      </span>{' '}
                      <span className={styles.backupName}>{status.lastBackup.name}</span>
                    </>
                  ) : (
                    t('settings.noBackups')
                  )}
                </dd>
              </div>
              <div className={styles.backupStatusRow}>
                <dt>{t('settings.nextRun')}</dt>
                <dd suppressHydrationWarning>
                  {status.nextRun
                    ? formatDateTime(status.nextRun)
                    : t('settings.backupsDisabled')}
                </dd>
              </div>
              <div className={styles.backupStatusRow}>
                <dt>{t('settings.destination')}</dt>
                <dd>
                  <code className={styles.backupPath}>{status.destination}</code>
                </dd>
              </div>
            </dl>
            <p className={styles.hint}>
              {t('settings.restoreManual')}
            </p>
          </fieldset>

          <div className={styles.actions}>
            <Button
              type="submit"
              loading={saving}
              disabled={!dirty}
              className={styles.saveButton}
            >
              {t('common.saveChanges')}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={handleCancel}
              disabled={!dirty || saving}
              className={styles.cancelButton}
            >
              {t('common.cancel')}
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
