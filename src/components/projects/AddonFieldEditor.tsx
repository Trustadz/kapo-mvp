'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Icon,
  Input,
  Markdown,
  MarkdownTextarea,
  Select,
} from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type {
  AddonFieldDefinition,
  AddonFieldValue,
  ProjectAddonEditorItem,
} from '@/lib/addons';
import { cn } from '@/lib/cn';
import { saveAddonValues } from './api';
import {
  draftFromValue,
  formatAddonFieldValue,
  isAddonValueDirty,
  toAddonFieldValue,
  type AddonDraft,
} from './addonFieldValues';
import { AddonUserPicker } from './AddonUserPicker';
import styles from './AddonFieldEditor.module.css';

export interface AddonFieldEditorProps {
  projectId: string;
  item: ProjectAddonEditorItem;
  field: AddonFieldDefinition;
  canEdit: boolean;
  variant: 'detail' | 'property';
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onSaved: () => void;
}

interface CommonProps extends AddonFieldEditorProps {
  current: AddonFieldValue | null;
  formatted: string | null;
  errorId: string;
}

function FieldError({ id, error }: { id: string; error: string | null }) {
  if (!error) return null;
  return (
    <span id={id} className={styles.error} role="alert">
      {error}
    </span>
  );
}

function fieldError(
  result: { fields?: Record<string, string>; message: string },
  field: AddonFieldDefinition,
): string {
  return result.fields?.[field.key] ?? result.message;
}

function EmptyValue() {
  return <span className={styles.empty}>—</span>;
}

/** Shared save path: PATCH only this field, then refresh the page data. */
async function saveFieldValue(
  projectId: string,
  item: ProjectAddonEditorItem,
  field: AddonFieldDefinition,
  value: AddonFieldValue,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await saveAddonValues(projectId, item.identifier, { [field.key]: value });
  if (!result.ok) return { ok: false, message: fieldError(result, field) };
  return { ok: true };
}

function ScalarField({
  projectId,
  item,
  field,
  canEdit,
  current,
  formatted,
  errorId,
  notify,
  onSaved,
}: CommonProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AddonDraft>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const finishingRef = useRef(false);
  const skipBlurRef = useRef(false);
  const focusOnCloseRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      if (focusOnCloseRef.current) {
        focusOnCloseRef.current = false;
        triggerRef.current?.focus();
      }
      return;
    }
    const input = inputRef.current;
    input?.focus();
    if (input && field.type === 'text') input.select();
  }, [editing, field.type]);

  if (!canEdit) {
    return formatted ? (
      <span className={styles.staticValue}>{formatted}</span>
    ) : (
      <EmptyValue />
    );
  }

  const begin = () => {
    if (saving) return;
    skipBlurRef.current = false;
    focusOnCloseRef.current = false;
    setDraft(draftFromValue(field, current));
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    skipBlurRef.current = true;
    setEditing(false);
    setError(null);
    focusOnCloseRef.current = true;
  };

  const commit = async (restoreFocus: boolean) => {
    if (finishingRef.current) return;
    if (!isAddonValueDirty(field, draft, current)) {
      finishingRef.current = false;
      skipBlurRef.current = true;
      setEditing(false);
      if (restoreFocus) focusOnCloseRef.current = true;
      return;
    }
    finishingRef.current = true;
    setSaving(true);
    const next = toAddonFieldValue(field, draft);
    const result = await saveFieldValue(projectId, item, field, next);
    setSaving(false);
    finishingRef.current = false;
    skipBlurRef.current = true;
    setEditing(false);
    focusOnCloseRef.current = restoreFocus;
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    notify(t('addons.saved'));
    onSaved();
  };

  if (editing) {
    const inputType =
      field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
    return (
      <span className={styles.editor}>
        <Input
          ref={inputRef}
          className={styles.inlineInput}
          type={inputType}
          value={typeof draft === 'string' ? draft : ''}
          min={field.min}
          max={field.max}
          maxLength={field.maxLength}
          disabled={saving}
          invalid={Boolean(error)}
          aria-label={field.label}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit(true);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false;
              return;
            }
            void commit(false);
          }}
        />
        <FieldError id={errorId} error={error} />
      </span>
    );
  }

  return (
    <span className={styles.wrapper}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.editTrigger}
        aria-label={
          formatted
            ? t('addons.editField', { field: field.label })
            : t('addons.setField', { field: field.label })
        }
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error) || undefined}
        onClick={begin}
      >
        {formatted ? (
          <span className={styles.valueText}>{formatted}</span>
        ) : (
          <span className={styles.valueTextEmpty}>—</span>
        )}
        <Icon name="edit" size={16} className={styles.editIcon} />
      </button>
      <FieldError id={errorId} error={error} />
    </span>
  );
}

function BooleanField({
  projectId,
  item,
  field,
  canEdit,
  current,
  formatted,
  errorId,
  notify,
  onSaved,
}: CommonProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = current === true;

  if (!canEdit) {
    return formatted ? (
      <span className={styles.staticValue}>{formatted}</span>
    ) : (
      <EmptyValue />
    );
  }

  const toggle = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await saveFieldValue(projectId, item, field, next);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    notify(t('addons.saved'));
    onSaved();
  };

  return (
    <span className={styles.booleanField}>
      <Checkbox
        label={checked ? t('addons.yes') : t('addons.no')}
        aria-label={field.label}
        checked={checked}
        disabled={saving}
        invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => void toggle(event.currentTarget.checked)}
      />
      <FieldError id={errorId} error={error} />
    </span>
  );
}

function StaticSelectField({
  projectId,
  item,
  field,
  canEdit,
  current,
  formatted,
  errorId,
  notify,
  onSaved,
}: CommonProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = field.options ?? [];

  if (!canEdit) {
    return formatted ? (
      <span className={styles.staticValue}>{formatted}</span>
    ) : (
      <EmptyValue />
    );
  }

  const save = async (next: string) => {
    if (saving) return;
    const value: AddonFieldValue = next === '' ? null : next;
    if (value === (current ?? null)) return;
    setSaving(true);
    setError(null);
    const result = await saveFieldValue(projectId, item, field, value);
    setSaving(false);
    if (!result.ok) {
      // The select is controlled by the saved value, so a failed write simply
      // re-renders the previous option.
      setError(result.message);
      return;
    }
    notify(t('addons.saved'));
    onSaved();
  };

  return (
    <span className={styles.selectField}>
      <Select
        className={styles.inlineSelect}
        aria-label={field.label}
        value={typeof current === 'string' ? current : ''}
        disabled={saving}
        invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => void save(event.currentTarget.value)}
      >
        <option value="">{t('addons.notSet')}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <FieldError id={errorId} error={error} />
    </span>
  );
}

function LongtextField({
  projectId,
  item,
  field,
  canEdit,
  variant,
  current,
  notify,
  onSaved,
}: CommonProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusOnCloseRef = useRef(false);
  const raw = typeof current === 'string' ? current : '';

  useEffect(() => {
    if (!editing && focusOnCloseRef.current) {
      focusOnCloseRef.current = false;
      triggerRef.current?.focus();
    }
  }, [editing]);

  if (!canEdit && !raw) return <EmptyValue />;
  if (!canEdit) {
    return (
      <span className={styles.longtextValue}>
        <Markdown value={raw} />
      </span>
    );
  }

  const begin = () => {
    if (saving) return;
    focusOnCloseRef.current = false;
    setDraft(raw);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setDraft('');
    focusOnCloseRef.current = true;
  };

  const save = async () => {
    if (saving) return;
    if (!isAddonValueDirty(field, draft, current)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveFieldValue(projectId, item, field, toAddonFieldValue(field, draft));
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEditing(false);
    focusOnCloseRef.current = true;
    notify(t('addons.saved'));
    onSaved();
  };

  if (editing) {
    return (
      <div
        className={cn(styles.longtextPanel, variant === 'property' && styles.propertyPanel)}
        role="group"
        aria-label={field.label}
      >
        <MarkdownTextarea
          label={field.label}
          value={draft}
          onChange={setDraft}
          rows={5}
          maxLength={field.maxLength}
          autoFocus
          disabled={saving}
          invalid={Boolean(error)}
          error={error ?? undefined}
        />
        <div className={styles.panelActions}>
          <Button size="sm" loading={saving} disabled={saving} onClick={() => void save()}>
            {t('common.saveChanges')}
          </Button>
          <Button size="sm" variant="quiet" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <span className={styles.longtextValue}>
      {raw ? <Markdown value={raw} /> : <EmptyValue />}
      <button
        ref={triggerRef}
        type="button"
        className={styles.longtextEdit}
        aria-label={
          raw
            ? t('addons.editField', { field: field.label })
            : t('addons.setField', { field: field.label })
        }
        onClick={begin}
      >
        <Icon name="edit" size={16} />
      </button>
    </span>
  );
}

/**
 * One add-on field row value/editor. The field definition alone selects the
 * control type, so every registered add-on (including future ones) gets the
 * same inline editing without UI code knowing its identifier.
 */
export function AddonFieldEditor(props: AddonFieldEditorProps) {
  const { t, formatDate, formatNumber } = useI18n();
  const { item, field } = props;
  const current = item.values[field.key] ?? null;
  const formatted = formatAddonFieldValue(item, field, t, formatDate, formatNumber);
  const errorId = `addon-field-${props.variant}-${item.identifier}-${field.key}-error`;
  const common: CommonProps = {
    ...props,
    current,
    formatted,
    errorId,
  };

  if (field.type === 'user' || (field.type === 'select' && field.optionsSource === 'users')) {
    return (
      <AddonUserPicker
        projectId={props.projectId}
        item={item}
        field={field}
        canEdit={props.canEdit}
        notify={props.notify}
        onSaved={props.onSaved}
        emptyLabel={field.type === 'user' ? t('addons.unassigned') : t('addons.notSet')}
        align={props.variant === 'property' ? 'end' : 'start'}
      />
    );
  }

  switch (field.type) {
    case 'boolean':
      return <BooleanField {...common} />;
    case 'longtext':
      return <LongtextField {...common} />;
    case 'select':
      return <StaticSelectField {...common} />;
    case 'text':
    case 'number':
    case 'date':
      return <ScalarField {...common} />;
    default:
      return formatted ? (
        <span className={styles.staticValue}>{formatted}</span>
      ) : (
        <EmptyValue />
      );
  }
}
