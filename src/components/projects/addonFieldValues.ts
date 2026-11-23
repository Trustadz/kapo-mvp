import type { I18nContextValue } from '@/i18n/client';
import type {
  AddonFieldDefinition,
  AddonFieldValue,
  ProjectAddonEditorItem,
} from '@/lib/addons';

/**
 * Generic value helpers for add-on inline editors.
 *
 * All conversions are driven by `AddonFieldDefinition.type`; no UI code
 * branches on a concrete add-on identifier. The helpers are exported so the
 * conversion/dirty rules can be unit tested without a DOM.
 */

/** Local draft value used by the text/number/date editors. */
export type AddonDraft = string | boolean | null;

/** Raw editor draft for a stored value. */
export function draftFromValue(
  field: AddonFieldDefinition,
  value: AddonFieldValue | undefined,
): AddonDraft {
  if (field.type === 'boolean') return value === true;
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Converts a draft to the API value. An invalid number is passed through as a
 * string so the server returns its field error instead of the client silently
 * dropping the change.
 */
export function toAddonFieldValue(
  field: AddonFieldDefinition,
  draft: AddonDraft,
): AddonFieldValue {
  if (field.type === 'boolean') return draft === true;
  if (draft === null || draft === '') return null;
  if (field.type === 'number') {
    const parsed = Number(draft);
    return Number.isFinite(parsed) ? parsed : draft;
  }
  return draft;
}

/** True only when the converted draft differs from the stored value. */
export function isAddonValueDirty(
  field: AddonFieldDefinition,
  draft: AddonDraft,
  current: AddonFieldValue | undefined,
): boolean {
  const stored = current === undefined ? null : current;
  return toAddonFieldValue(field, draft) !== stored;
}

/** Locale-aware display for one add-on value; null when unset. */
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
