'use client';

import type { ReactNode } from 'react';
import type {
  AddonApplicationConfig,
  AddonFieldDefinition,
  AddonFieldValue,
} from '@/lib/addons';
import {
  addonSettingOptions,
  addonSettingsFieldList,
  isEditableApplicationSetting,
} from '@/lib/addon-settings';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import styles from './ApplicationSettingsForm.module.css';

/**
 * Generic Application settings controls for one add-on.
 *
 * Supported types render normal controls; unsupported declarations (for
 * example a `user` field or a dynamic `optionsSource` select) render a quiet
 * explanation instead of a broken control, and their stored values are left
 * untouched by a save. A malformed declaration never crashes the panel.
 */

export interface AddonSettingsFieldsProps {
  addon: AddonApplicationConfig;
  values: Record<string, AddonFieldValue>;
  /** Server field errors keyed by field key (already stripped of the prefix). */
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (key: string, value: AddonFieldValue) => void;
}

function fieldId(addon: AddonApplicationConfig, field: AddonFieldDefinition): string {
  return `addon-setting-${addon.identifier}-${field.key}`;
}

export function AddonSettingsFields({
  addon,
  values,
  errors,
  disabled = false,
  onChange,
}: AddonSettingsFieldsProps) {
  const { t } = useI18n();
  const rawFields = Array.isArray(addon.settingsFields) ? addon.settingsFields : [];
  const fields = addonSettingsFieldList(addon.settingsFields);
  const malformed = rawFields.length !== fields.length;

  if (fields.length === 0 && !malformed) {
    return <p className={styles.emptySettings}>{t('addons.noSettings')}</p>;
  }

  return (
    <div className={styles.settingsFields}>
      {malformed ? (
        <p className={styles.settingsWarning} role="status">
          {t('addons.settingsMalformed')}
        </p>
      ) : null}

      {fields.map((field) => {
        const id = fieldId(addon, field);
        const error = errors[field.key];
        const label = field.label || field.key;

        if (!isEditableApplicationSetting(field)) {
          return (
            <div key={field.key} className={styles.unsupportedSetting}>
              <strong className={styles.unsupportedLabel}>{label}</strong>
              <p>{t('addons.settingsUnsupported')}</p>
            </div>
          );
        }

        if (field.type === 'boolean') {
          const errorId = `${id}-error`;
          return (
            <div key={field.key} className={styles.checkboxField}>
              <Checkbox
                id={id}
                label={label}
                description={field.description}
                checked={values[field.key] === true}
                disabled={disabled}
                invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => onChange(field.key, event.target.checked)}
              />
              {error ? (
                <p id={errorId} className={styles.fieldError} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }

        const common = {
          id,
          disabled,
          'aria-invalid': error ? true : undefined,
        } as const;

        let control: ReactNode;
        if (field.type === 'number') {
          control = (
            <Input
              {...common}
              type="number"
              min={typeof field.min === 'number' ? field.min : undefined}
              max={typeof field.max === 'number' ? field.max : undefined}
              step={1}
              value={typeof values[field.key] === 'number' ? (values[field.key] as number) : ''}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber;
                onChange(field.key, Number.isFinite(next) ? next : null);
              }}
              className={styles.numberInput}
            />
          );
        } else if (field.type === 'date') {
          control = (
            <Input
              {...common}
              type="date"
              value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
              onChange={(event) =>
                onChange(field.key, event.currentTarget.value || null)
              }
              className={styles.dateInput}
            />
          );
        } else if (field.type === 'longtext') {
          control = (
            <Textarea
              {...common}
              rows={4}
              maxLength={
                typeof field.maxLength === 'number' ? field.maxLength : undefined
              }
              value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
              onChange={(event) => onChange(field.key, event.currentTarget.value)}
            />
          );
        } else if (field.type === 'select') {
          control = (
            <Select
              {...common}
              value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
              onChange={(event) =>
                onChange(field.key, event.currentTarget.value || null)
              }
              className={styles.select}
            >
              <option value="">{t('addons.chooseOption')}</option>
              {addonSettingOptions(field).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          );
        } else {
          control = (
            <Input
              {...common}
              type="text"
              maxLength={
                typeof field.maxLength === 'number' ? field.maxLength : undefined
              }
              value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
              onChange={(event) => onChange(field.key, event.currentTarget.value)}
            />
          );
        }

        return (
          <Field
            key={field.key}
            label={label}
            htmlFor={id}
            labelWidth={190}
            hint={field.description}
            error={error}
            required={field.required}
          >
            {control}
          </Field>
        );
      })}
    </div>
  );
}
