'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type {
  AddonFieldDefinition,
  AddonFieldValue,
  ProjectAddonEditorData,
  ProjectAddonEditorItem,
} from '@/lib/addons';
import { saveAddonValues } from './api';
import styles from './AddonEditor.module.css';

/**
 * Generic project-page add-on editor.
 *
 * Everything is driven by `AddonDefinition.fields` delivered by the server;
 * there is no per-add-on branch or renderer lookup. Any registered add-on whose
 * resolved config is available for the project appears here. Read-only states
 * (Viewer, Trashed) render values without controls.
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

function displayValue(
  item: ProjectAddonEditorItem,
  field: AddonFieldDefinition,
  value: AddonFieldValue,
  notSet: string,
  yes: string,
  no: string,
): string {
  if (value === null || value === undefined || value === '') return notSet;
  if (field.type === 'boolean') return value === true ? yes : no;
  if (field.type === 'user') {
    return item.userOptions?.find((option) => option.value === value)?.label ?? String(value);
  }
  if (field.type === 'select') {
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
          {(field.type === 'user' ? (item.userOptions ?? []) : (field.options ?? [])).map(
            (option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ),
          )}
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

function AddonEditorItemCard({
  projectId,
  item,
  canEdit,
  notify,
  onSaved,
}: {
  projectId: string;
  item: ProjectAddonEditorItem;
  canEdit: boolean;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() => draftFromValues(item));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
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
  };

  return (
    <div className={styles.addon}>
      <div className={styles.addonHeader}>
        <h3 className={styles.addonTitle}>{item.name}</h3>
        {item.description ? <p className={styles.addonDescription}>{item.description}</p> : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {canEdit ? (
        <>
          <div className={styles.fields}>
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
          </div>
          <div className={styles.footer}>
            <Button onClick={() => void save()} loading={saving} disabled={saving}>
              {t('addons.save', { name: item.name })}
            </Button>
          </div>
        </>
      ) : (
        <dl className={styles.valueList}>
          {item.fields.map((field) => (
            <div className={styles.valueRow} key={field.key}>
              <dt>{field.label}</dt>
              <dd>
                {displayValue(
                  item,
                  field,
                  item.values[field.key] ?? null,
                  t('addons.notSet'),
                  t('addons.yes'),
                  t('addons.no'),
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export interface AddonEditorProps {
  projectId: string;
  data: ProjectAddonEditorData;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onSaved: () => void;
}

export function AddonEditor({ projectId, data, notify, onSaved }: AddonEditorProps) {
  const { t } = useI18n();
  if (data.items.length === 0) return null;
  const readOnlyReason =
    data.readOnlyReason === 'trashed'
      ? t('addons.readOnlyTrashed')
      : data.readOnlyReason === 'viewer'
        ? t('addons.readOnlyViewer')
        : null;
  return (
    <Card className={styles.card} as="section" aria-labelledby="addons-heading">
      <h2 id="addons-heading" className={styles.cardTitle}>
        {t('addons.title')}
      </h2>
      {!data.canEdit && readOnlyReason ? (
        <p className={styles.readOnlyNote}>{readOnlyReason}</p>
      ) : null}
      {data.items.map((item) => (
        <AddonEditorItemCard
          // Re-key on the server snapshot so a refresh resets the draft.
          key={`${item.identifier}-${JSON.stringify(item.values)}`}
          projectId={projectId}
          item={item}
          canEdit={data.canEdit}
          notify={notify}
          onSaved={onSaved}
        />
      ))}
    </Card>
  );
}
