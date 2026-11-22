import type {
  AddonFieldDefinition,
  AddonFieldOption,
  AddonFieldType,
  AddonFieldValue,
  AddonMode,
} from '@/server/addons/types';

export type {
  AddonFieldDefinition,
  AddonFieldOption,
  AddonFieldType,
  AddonFieldValue,
  AddonMode,
};

/**
 * Serialisable add-on view models shared by the server pages and client
 * components. Only type imports cross into `src/server/addons/types.ts` (which
 * is framework-free), so no server code reaches the browser bundle.
 */

export const ADDON_MODE_OPTIONS: readonly AddonMode[] = [
  'required',
  'always',
  'optional',
  'unavailable',
];

export interface AddonApplicationConfig {
  identifier: string;
  name: string;
  description?: string;
  version: string;
  mode: AddonMode;
  /** Global add-on settings stored in the `addons.settings` column. */
  settings: Record<string, AddonFieldValue>;
  /** Declared global settings controls (empty when the add-on exposes none). */
  settingsFields: AddonFieldDefinition[];
}

export interface ProjectAddonConfigView {
  identifier: string;
  name: string;
  description?: string;
  version: string;
  mode: AddonMode;
  /** Raw per-project `enabled` flag, when one is stored. */
  enabled: boolean | null;
  /** Raw per-project `inheritFromParent` flag, when one is stored. */
  inheritFromParent: boolean | null;
  /** Effectively available for this project after mode + inheritance. */
  available: boolean;
  /** Effective configuration came from an ancestor. */
  inherited: boolean;
  /** Global `required` mode gates this project's Inbox exit. */
  required: boolean;
  settings: Record<string, AddonFieldValue>;
  effectiveSettings: Record<string, AddonFieldValue>;
  parentTitle: string | null;
}

export interface ProjectAddonUserOption {
  value: string;
  label: string;
  avatar: string | null;
}

export interface ProjectAddonEditorItem {
  identifier: string;
  name: string;
  description?: string;
  version: string;
  mode: AddonMode;
  required: boolean;
  fields: AddonFieldDefinition[];
  values: Record<string, AddonFieldValue>;
  /** Core-provided picker list for `user` fields (assignment never grants access). */
  userOptions?: ProjectAddonUserOption[];
}

export interface ProjectAddonEditorData {
  items: ProjectAddonEditorItem[];
  canEdit: boolean;
  readOnlyReason: 'viewer' | 'trashed' | null;
}

/* ------------------------------------------------------------------------- */
/* Opaque add-on field references                                            */
/* ------------------------------------------------------------------------- */

/**
 * Layout and view-property slots store an opaque reference for add-on fields:
 *
 *   addon:<identifier>:<fieldKey>
 *
 * The identifier is constrained by the registry (`/^[a-z][a-z0-9-]*$/`), so
 * the first colon after the prefix is an unambiguous separator. Field keys may
 * themselves contain colons, so everything after that separator is the key.
 *
 * Core field keys are stored as-is; these helpers only describe the add-on
 * shape. No UI or persistence code branches on a concrete add-on identifier.
 */
export const ADDON_FIELD_REF_PREFIX = 'addon:';

const ADDON_IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/;

export type AddonFieldRef = `${typeof ADDON_FIELD_REF_PREFIX}${string}`;

export interface AddonFieldRefParts {
  identifier: string;
  fieldKey: string;
}

/** Builds the opaque layout reference for one add-on field. */
export function serializeAddonFieldRef(identifier: string, fieldKey: string): AddonFieldRef {
  return `${ADDON_FIELD_REF_PREFIX}${identifier}:${fieldKey}`;
}

/** Parses an opaque layout reference, returning null for anything malformed. */
export function parseAddonFieldRef(ref: unknown): AddonFieldRefParts | null {
  if (typeof ref !== 'string' || !ref.startsWith(ADDON_FIELD_REF_PREFIX)) return null;
  const rest = ref.slice(ADDON_FIELD_REF_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;
  const identifier = rest.slice(0, separator);
  const fieldKey = rest.slice(separator + 1);
  if (!ADDON_IDENTIFIER_PATTERN.test(identifier) || fieldKey.length === 0) return null;
  return { identifier, fieldKey };
}

/** True for a syntactically valid add-on field reference. */
export function isAddonFieldRef(ref: unknown): ref is AddonFieldRef {
  return parseAddonFieldRef(ref) !== null;
}

/** Every selectable field reference for the add-ons in `items`. */
export function availableAddonFieldRefs(
  items: readonly ProjectAddonEditorItem[],
): Set<string> {
  const refs = new Set<string>();
  for (const item of items) {
    for (const field of item.fields) {
      refs.add(serializeAddonFieldRef(item.identifier, field.key));
    }
  }
  return refs;
}

/**
 * One add-on field value projected onto a project card for compact rendering
 * in the collection views. Only available add-ons are projected.
 */
export interface ProjectCardAddonField {
  /** Opaque `addon:<identifier>:<fieldKey>` reference. */
  ref: AddonFieldRef;
  identifier: string;
  fieldKey: string;
  addonName: string;
  label: string;
  type: AddonFieldType;
  /** Raw scalar value; null when unset. */
  value: AddonFieldValue;
  /**
   * Server-formatted value for user/select/boolean fields (account names and
   * option labels are resolved server-side). Text/number/date values keep their
   * raw form so the client can format them per locale.
   */
  displayValue: string | null;
  /** Avatar for user-backed fields, when one exists. */
  avatar?: string | null;
}
