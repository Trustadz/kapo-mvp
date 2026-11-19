'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Toast } from '@/components/ui/Toast';
import { requestJson } from '@/lib/api-client';
import {
  APP_ROLES,
  COLLECTION_VIEWS,
  COLLECTION_VIEW_LABELS,
  type AppRole,
  type CollectionView,
} from '@/lib/types';
import type { ApplicationSettings } from '@/server/domain/settings';
import styles from './ApplicationSettingsForm.module.css';

export interface ApplicationSettingsFormProps {
  settings: ApplicationSettings;
}

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  user: 'User',
  viewer: 'Viewer',
};

interface SettingsValues {
  defaultAccountRole: AppRole;
  enabledViews: CollectionView[];
}

function valuesFromSettings(settings: ApplicationSettings): SettingsValues {
  return {
    defaultAccountRole: settings.defaultAccountRole,
    enabledViews: settings.enabledViews,
  };
}

/**
 * Application settings (Admin): default account role, fixed trash retention and
 * the collection views available to projects. At least one view must remain.
 */
export function ApplicationSettingsForm({ settings }: ApplicationSettingsFormProps) {
  const [saved, setSaved] = useState<SettingsValues>(() => valuesFromSettings(settings));
  const [values, setValues] = useState<SettingsValues>(() => valuesFromSettings(settings));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dirty =
    values.defaultAccountRole !== saved.defaultAccountRole ||
    values.enabledViews.length !== saved.enabledViews.length ||
    values.enabledViews.some((view, index) => view !== saved.enabledViews[index]);

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
      const result = await requestJson<{ settings: ApplicationSettings }>('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          defaultAccountRole: values.defaultAccountRole,
          enabledViews: values.enabledViews,
          trashRetentionDays: settings.trashRetentionDays,
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
      setToast('Application settings saved.');
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
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
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

          <fieldset className={styles.viewsFieldset} aria-describedby="views-hint">
            <legend className={styles.viewsLegend}>Views available to projects</legend>
            {fieldErrors.enabledViews ? (
              <p className={styles.fieldError} role="alert">
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

      <Toast open={toast !== null} message={toast ?? ''} onClose={() => setToast(null)} />
    </>
  );
}
