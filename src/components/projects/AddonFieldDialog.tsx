'use client';

import { useState, type FormEvent } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import { useI18n, type I18nContextValue } from '@/i18n/client';
import type {
  AddonFieldDefinition,
  AddonFieldValue,
  ProjectAddonEditorItem,
} from '@/lib/addons';
import { saveAddonValues } from './api';
import styles from './AddonFieldDialog.module.css';

/**
 * Generic add-on field form (formerly the project-page AddonEditor card).
 *
 * It is now only mounted inside a small dialog opened from an add-on field row
 * in Details/Properties. Everything is driven by
 * `AddonDefinition.fields` delivered by the server; no code branches on a
 * concrete add-on identifier.
 */

type DraftValue = string | boolean | null;

function draftFromValues(item: ProjectAddonEditorItem): Record<string, DraftValue> {
  const draft: Record<string, DraftValue> = {};
  for (const field of item.fields) {
    const value = item.values[field.key] ?? null;
    draft[field.key] = typeof value === 'boolean' ? value : value === null ? '' : String(value);
  }
  return draft;
}

function toFieldValue(field: AddonFieldDefinition, raw: DraftValue): AddonFieldValue {
  if (field.type === 'boolean') return raw === true;
  if (raw === null || raw === '') return null;
  if (field.type === 'number') {
    const parsed = Number(raw);
    // An invalid number is sent through as a string so the core validator
    // returns the inline field error instead of the client silently dropping it.
    return Number.isFinite(parsed) ? parsed : (raw as string);
  }
  return raw as string;
}

/**
 * Locale-aware display for one add-on value. Returns null when the value is
 * unset so callers can render their own muted placeholder.
 */
export function formatAddonFieldValue(
  item: ProjectAddonEditorItem,
  field: AddonFieldDefinition,
  t: I18nContextValue['t'],
  formatDate: I18nContextValue['formatDate'],
  formatNumber: I18nContextValue['formatNumber'],
): string | null {
  const value = item.values[field.key] ?? null;
  if (value === null || value === undefined || value === '') return null;
  if (field.type === 'boolean') return value === true ? t('addons.yes') : t('addons.no');
  if (field.type === 'date' && typeof value === 'string') return formatDate(value);
  if (field.type === 'number' && typeof value === 'number') return formatNumber(value);
  if (field.type === 'user') {
    return item.userOptions?.find((option) => option.value === value)?.label ?? String(value);
  }
  if (field.type === 'select') {
    if (field.optionsSource === 'users') {
      return item.userOptions?.find((option) => option.value === value)?.label ?? String(value);
    }
    return field.options?.find((option) => option.value === value)?.label ?? String(value);
  }
  return String(value);
}

function AddonFieldControl({
  item,
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  item: ProjectAddonEditorItem;
  field: AddonFieldDefinition;
  value: DraftValue;
  error?: string;
  disabled: boolean;
  onChange: (next: DraftValue) => void;
}) {
  const { t } = useI18n();
  const id = `addon-${item.identifier}-${field.key}`;
  const textValue = typeof value === 'string' ? value : '';
  return (
    <Field
      label={field.label}
      htmlFor={id}
      hint={field.description}
      error={error}
      required={field.required}
    >
      {field.type === 'boolean' ? (
        <Checkbox
          id={id}
          label={value === true ? t('addons.yes') : t('addons.no')}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : field.type === 'longtext' ? (
        <Textarea
          id={id}
          value={textValue}
          maxLength={field.maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.type === 'select' || field.type === 'user' ? (
        <Select
          id={id}
          value={textValue}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {field.type === 'user' ? t('addons.unassigned') : t('addons.notSet')}
          </option>
          {(field.type === 'user' || field.optionsSource === 'users'
            ? (item.userOptions ?? [])
            : (field.options ?? [])
          ).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={id}
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={textValue}
          min={field.min}
          max={field.max}
          maxLength={field.maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export interface AddonFieldDialogProps {
  open: boolean;
  projectId: string;
  item: ProjectAddonEditorItem;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Small per-add-on dialog reused by every add-on field row. Saving writes the
 * whole add-on value object through the generic value endpoint, then refreshes
 * the page so every layout slot shows the new value.
 */
export function AddonFieldDialog({
  open,
  projectId,
  item,
  notify,
  onClose,
  onSaved,
}: AddonFieldDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() => draftFromValues(item));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = `addon-field-form-${item.identifier}`;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const values: Record<string, AddonFieldValue> = {};
    for (const field of item.fields) {
      values[field.key] = toFieldValue(field, draft[field.key] ?? null);
    }
    const result = await saveAddonValues(projectId, item.identifier, values);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      if (result.fields) setFieldErrors(result.fields);
      return;
    }
    notify(t('addons.saved'));
    onSaved();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item.name}
      description={item.description}
      dismissible={!saving}
      size="sm"
      footer={
        <div className={styles.dialogFooter}>
          <Button type="submit" form={formId} loading={saving} disabled={saving}>
            {t('addons.save', { name: item.name })}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form id={formId} className={styles.form} onSubmit={save} noValidate>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {item.fields.map((field) => (
          <AddonFieldControl
            key={field.key}
            item={item}
            field={field}
            value={draft[field.key] ?? null}
            error={fieldErrors[field.key]}
            disabled={saving}
            onChange={(next) =>
              setDraft((current) => ({ ...current, [field.key]: next }))
            }
          />
        ))}
      </form>
    </Dialog>
  );
}
