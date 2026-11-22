'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar, Icon } from '@/components/ui';
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
}

interface Option {
  value: string;
  label: string;
  avatar: string | null;
}

function UnassignedAvatar() {
  return (
    <span className={styles.unassignedAvatar} aria-hidden="true">
      <Icon name="person_off" size={16} />
    </span>
  );
}

/**
 * Inline Jira-style person picker for an add-on `user` field.
 *
 * The trigger shows the current avatar/name. Opening it gives a searchable
 * people list; choosing someone saves immediately — there is no second Save
 * step and no dialog. `optionsSource: 'users'` selects use the same picker.
 */
export function AddonUserPicker({
  projectId,
  item,
  field,
  canEdit,
  notify,
  onSaved,
}: AddonUserPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = item.values[field.key] ?? null;
  const selected = item.userOptions?.find((option) => option.value === current) ?? null;
  const options: Option[] = [
    { value: '', label: t('addons.unassigned'), avatar: null },
    ...(item.userOptions ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      avatar: option.avatar ?? null,
    })),
  ];
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const choose = async (value: string) => {
    if (saving) return;
    if (value === (current ?? '')) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveAddonValues(projectId, item.identifier, {
      [field.key]: (value || null) as AddonFieldValue,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    notify(t('addons.saved'));
    onSaved();
  };

  const trigger = (
    <span className={styles.value}>
      {selected ? (
        <Avatar name={selected.label} src={selected.avatar ?? undefined} size={24} decorative />
      ) : (
        <UnassignedAvatar />
      )}
      <span className={selected ? styles.name : styles.placeholder}>
        {selected?.label ?? t('addons.unassigned')}
      </span>
    </span>
  );

  if (!canEdit) return <span className={styles.readOnly}>{trigger}</span>;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={t('addons.assignField', { field: field.label })}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={saving}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
        <Icon name="expand_more" size={18} className={styles.chevron} />
      </button>
      {open ? (
        <div className={styles.popover}>
          <div className={styles.searchRow}>
            <Icon name="search" size={18} />
            <input
              ref={inputRef}
              className={styles.search}
              role="combobox"
              aria-expanded="true"
              aria-controls={`addon-${item.identifier}-${field.key}-people`}
              aria-autocomplete="list"
              aria-label={t('addons.searchPeople')}
              placeholder={t('addons.searchPeople')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, filtered.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const option = filtered[active];
                  if (option) void choose(option.value);
                }
              }}
            />
          </div>
          <ul
            id={`addon-${item.identifier}-${field.key}-people`}
            className={styles.list}
            role="listbox"
            aria-label={t('addons.people')}
          >
            {filtered.length === 0 ? (
              <li className={styles.empty}>{t('addons.noPeople')}</li>
            ) : (
              filtered.map((option, index) => (
                <li key={option.value || 'unassigned'}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === (current ?? '')}
                    className={styles.option}
                    data-active={index === active || undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => void choose(option.value)}
                  >
                    {option.avatar !== null || option.value ? (
                      <Avatar
                        name={option.label}
                        src={option.avatar ?? undefined}
                        size={24}
                        decorative
                      />
                    ) : (
                      <UnassignedAvatar />
                    )}
                    <span className={styles.optionLabel}>{option.label}</span>
                    {option.value === (current ?? '') ? (
                      <Icon name="check" size={18} className={styles.check} />
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
