import type {
  AddonApplicationConfig,
  AddonFieldDefinition,
  AddonFieldOption,
  AddonFieldValue,
} from '@/lib/addons';

/**
 * Generic application-wide add-on settings (Application settings → Add-ons).
 *
 * The same framework-free helpers are used by the server write path and the
 * client renderer so a field behaves identically before and after saving:
 *
 *  - only boolean/number/text/longtext/date/static-select controls are
 *    supported in Application settings;
 *  - `user` fields and `optionsSource` selects stay project-scoped (their
 *    stored values are preserved, never silently dropped);
 *  - malformed definitions never throw: unusable declarations are ignored and
 *    unsupported declared values are reported as field issues when a caller
 *    explicitly sends them.
 */

export const APPLICATION_ADDON_SETTING_TYPES = [
  'boolean',
  'number',
  'text',
  'longtext',
  'date',
  'select',
] as const;

export type ApplicationAddonSettingType = (typeof APPLICATION_ADDON_SETTING_TYPES)[number];

const SUPPORTED_TYPES: ReadonlySet<string> = new Set(APPLICATION_ADDON_SETTING_TYPES);

export function isApplicationAddonSettingType(
  type: unknown,
): type is ApplicationAddonSettingType {
  return typeof type === 'string' && SUPPORTED_TYPES.has(type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is AddonFieldValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function sanitiseOptions(raw: unknown): AddonFieldOption[] {
  if (!Array.isArray(raw)) return [];
  const options: AddonFieldOption[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    if (typeof entry.value !== 'string' || typeof entry.label !== 'string') continue;
    options.push({ value: entry.value, label: entry.label });
  }
  return options;
}

/**
 * Defensive, serialisable field list. A malformed definition (missing key,
 * non-string type, duplicate key, function-valued properties) is filtered out
 * instead of reaching the client or crashing a request.
 */
export function addonSettingsFieldList(raw: unknown): AddonFieldDefinition[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const fields: AddonFieldDefinition[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    if (typeof entry.key !== 'string' || entry.key.trim() === '') continue;
    if (typeof entry.type !== 'string' || entry.type.trim() === '') continue;
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);

    const field: AddonFieldDefinition = {
      key: entry.key,
      label:
        typeof entry.label === 'string' && entry.label.trim() !== ''
          ? entry.label
          : entry.key,
      type: entry.type as AddonFieldDefinition['type'],
    };
    if (entry.required === true) field.required = true;
    if (typeof entry.description === 'string') field.description = entry.description;
    const options = sanitiseOptions(entry.options);
    if (options.length > 0) field.options = options;
    if (entry.optionsSource === 'users') field.optionsSource = 'users';
    if (typeof entry.maxLength === 'number' && Number.isFinite(entry.maxLength)) {
      field.maxLength = entry.maxLength;
    }
    if (typeof entry.min === 'number' && Number.isFinite(entry.min)) field.min = entry.min;
    if (typeof entry.max === 'number' && Number.isFinite(entry.max)) field.max = entry.max;
    if (isScalar(entry.defaultValue)) field.defaultValue = entry.defaultValue;
    fields.push(field);
  }
  return fields;
}

/** Static options usable by Application settings (never a user picker). */
export function addonSettingOptions(field: AddonFieldDefinition): AddonFieldOption[] {
  return sanitiseOptions(field.options);
}

/** True when the field can be rendered and edited in Application settings. */
export function isEditableApplicationSetting(field: AddonFieldDefinition): boolean {
  if (!isApplicationAddonSettingType(field.type)) return false;
  if (field.type !== 'select') return true;
  return field.optionsSource === undefined && addonSettingOptions(field).length > 0;
}

/**
 * Initial draft values for one add-on: stored scalars plus any declared
 * defaults for keys that were never stored. Unknown stored keys are kept so a
 * later save never drops data owned by another add-on version.
 */
export function initialAddonSettings(
  config: Pick<AddonApplicationConfig, 'settings' | 'settingsFields'>,
): Record<string, AddonFieldValue> {
  const values: Record<string, AddonFieldValue> = isRecord(config.settings)
    ? { ...config.settings }
    : {};
  for (const field of addonSettingsFieldList(config.settingsFields)) {
    if (values[field.key] === undefined && isScalar(field.defaultValue)) {
      values[field.key] = field.defaultValue;
    }
  }
  return values;
}

/**
 * Payload for a settings save. Only editable declared fields are sent:
 * unsupported declarations and unknown keys are left for the server to merge
 * from its existing row, so their stored values are preserved.
 */
export function applicationAddonSettingsPayload(
  config: Pick<AddonApplicationConfig, 'settingsFields'>,
  values: Record<string, AddonFieldValue>,
): Record<string, AddonFieldValue> {
  const payload: Record<string, AddonFieldValue> = {};
  for (const field of addonSettingsFieldList(config.settingsFields)) {
    if (!isEditableApplicationSetting(field)) continue;
    const value = values[field.key];
    payload[field.key] = isScalar(value) ? value : null;
  }
  return payload;
}

export function sameAddonSettings(
  a: Record<string, AddonFieldValue>,
  b: Record<string, AddonFieldValue>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export interface AddonSettingIssue {
  field?: string;
  message: string;
}

export interface AddonSettingsValidationResult {
  /** Normalised values for the supported declared fields only. */
  values: Record<string, AddonFieldValue>;
  issues: AddonSettingIssue[];
}

export interface ValidateAddonSettingsOptions {
  /**
   * Keys supplied by the caller. Unsupported declarations are only rejected
   * when the caller tries to write them; preserved legacy values pass through.
   * Omitted means every key in `values` was supplied.
   */
  providedKeys?: ReadonlySet<string>;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Validates application add-on `settings` against the declared fields.
 *
 * The caller passes the effective (stored + incoming) values so `required`
 * checks work for partial patches. Unknown keys are ignored (the write path
 * preserves them), malformed definitions are skipped, and unsupported field
 * types are only rejected when explicitly supplied by the caller.
 */
export function validateAddonApplicationSettings(
  fields: unknown,
  values: Record<string, unknown>,
  options: ValidateAddonSettingsOptions = {},
): AddonSettingsValidationResult {
  const normalised: Record<string, AddonFieldValue> = {};
  const issues: AddonSettingIssue[] = [];
  const providedKeys = options.providedKeys;

  for (const field of addonSettingsFieldList(fields)) {
    const raw = values[field.key];
    const provided = providedKeys === undefined || providedKeys.has(field.key);
    const label = field.label || field.key;
    const unsupported =
      !isApplicationAddonSettingType(field.type) || !isEditableApplicationSetting(field);

    // Unsupported declarations are read-only in Application settings. Do not
    // rewrite their stored value, and only reject an explicit write attempt.
    if (unsupported) {
      const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
      if (provided && !empty) {
        issues.push({
          field: field.key,
          message:
            field.type === 'select'
              ? 'This setting is a dynamic select and cannot be edited in Application settings.'
              : 'This setting type is not supported in Application settings.',
        });
      }
      continue;
    }

    const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (empty) {
      if (field.required) {
        issues.push({ field: field.key, message: `${label} is required.` });
      } else {
        normalised[field.key] = null;
      }
      continue;
    }

    switch (field.type) {
      case 'boolean': {
        if (typeof raw !== 'boolean') {
          issues.push({ field: field.key, message: 'Choose yes or no.' });
        } else if (field.required && raw !== true) {
          issues.push({ field: field.key, message: `${label} must be checked.` });
        } else {
          normalised[field.key] = raw;
        }
        break;
      }
      case 'number': {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          issues.push({ field: field.key, message: 'Enter a number.' });
          break;
        }
        if (typeof field.min === 'number' && raw < field.min) {
          issues.push({
            field: field.key,
            message: `Enter a value of at least ${field.min}.`,
          });
          break;
        }
        if (typeof field.max === 'number' && raw > field.max) {
          issues.push({
            field: field.key,
            message: `Enter a value of at most ${field.max}.`,
          });
          break;
        }
        normalised[field.key] = raw;
        break;
      }
      case 'text':
      case 'longtext': {
        if (typeof raw !== 'string') {
          issues.push({ field: field.key, message: 'Enter text.' });
          break;
        }
        const value = raw.trim();
        if (value === '') {
          if (field.required) {
            issues.push({ field: field.key, message: `${label} is required.` });
          } else {
            normalised[field.key] = null;
          }
          break;
        }
        if (field.type === 'text' && /[\r\n]/.test(value)) {
          issues.push({ field: field.key, message: 'Use a single line of text.' });
          break;
        }
        if (typeof field.maxLength === 'number' && value.length > field.maxLength) {
          issues.push({
            field: field.key,
            message: `Keep this value to ${field.maxLength} characters.`,
          });
          break;
        }
        normalised[field.key] = value;
        break;
      }
      case 'date': {
        if (typeof raw !== 'string' || !isValidDate(raw)) {
          issues.push({ field: field.key, message: 'Choose a valid date.' });
          break;
        }
        normalised[field.key] = raw;
        break;
      }
      case 'select': {
        if (typeof raw !== 'string') {
          issues.push({ field: field.key, message: 'Choose an option.' });
          break;
        }
        const known = addonSettingOptions(field).some((option) => option.value === raw);
        if (!known) {
          issues.push({
            field: field.key,
            message: 'Choose one of the available options.',
          });
          break;
        }
        normalised[field.key] = raw;
        break;
      }
      default: {
        issues.push({ field: field.key, message: 'This setting type is not supported.' });
      }
    }
  }

  return { values: normalised, issues };
}
