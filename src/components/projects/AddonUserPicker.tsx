'use client';

import { useState } from 'react';
import { Avatar, Combobox, type ComboboxOption } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type {
  AddonFieldDefinition,
  AddonFieldValue,
  ProjectAddonEditorItem,
} from '@/lib/addons';
import { saveAddonValues } from './api';
import styles from './AddonUserPicker.module.css';

export interface AddonUserPickerProps {
  projectId: string;
  item: ProjectAddonEditorItem;
  field: AddonFieldDefinition;
  canEdit: boolean;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onSaved: () => void;
  /** Text for the empty choice (user fields say "Unassigned", selects "Not set"). */
  emptyLabel?: string;
  align?: 'start' | 'end';
}

/**
 * Inline person picker for add-on `user` fields and `optionsSource: 'users'`
 * selects. It is the generic searchable {@link Combobox} plus the domain save
 * call: choosing a person saves immediately, with no second Save step.
 */
export function AddonUserPicker({
  projectId,
  item,
  field,
  canEdit,
  notify,
  onSaved,
  emptyLabel,
  align = 'end',
}: AddonUserPickerProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = item.values[field.key] ?? null;
  const unassigned = emptyLabel ?? t('addons.unassigned');
  const selected = item.userOptions?.find((option) => option.value === current) ?? null;
  const options: ComboboxOption[] = [
    { value: '', label: unassigned, icon: 'person_off' },
    ...(item.userOptions ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      avatar: option.avatar,
    })),
  ];

  const choose = async (value: string) => {
    if (saving) return;
    if (value === (current ?? '')) return;
    setSaving(true);
    setError(null);
    const result = await saveAddonValues(projectId, item.identifier, {
      [field.key]: (value || null) as AddonFieldValue,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.fields?.[field.key] ?? result.message);
      return;
    }
    notify(t('addons.saved'));
    onSaved();
  };

  if (!canEdit) {
    return (
      <span className={styles.readOnly}>
        {selected ? (
          <>
            <Avatar name={selected.label} src={selected.avatar ?? undefined} size={24} decorative />
            <span>{selected.label}</span>
          </>
        ) : current ? (
          <span>{String(current)}</span>
        ) : (
          <span className={styles.placeholder}>{unassigned}</span>
        )}
      </span>
    );
  }

  return (
    <Combobox
      options={options}
      value={typeof current === 'string' ? current : ''}
      onChange={(value) => void choose(value)}
      label={t('addons.assignField', { field: field.label })}
      searchLabel={t('addons.searchPeople')}
      listLabel={t('addons.people')}
      emptyLabel={t('addons.noPeople')}
      placeholder={unassigned}
      disabled={saving}
      invalid={Boolean(error)}
      error={error ?? undefined}
      align={align}
    />
  );
}
