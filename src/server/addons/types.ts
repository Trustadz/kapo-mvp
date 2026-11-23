/**
 * Add-on extension contracts (build-spec §5, §12; product.md §7).
 *
 * This module is framework-free: no React, no Next.js, no database imports.
 * The registry ships empty in the MVP; these types exist so a future add-on can
 * be introduced without touching the core lifecycle or permission model.
 *
 * STORAGE CONTRACT (also documented in docs/add-ons.md):
 *   - Values live at `projects.addon_data[identifier][fieldKey]`.
 *   - Project enablement lives at
 *     `projects.settings.addons[identifier] = { enabled, inheritFromParent, settings }`.
 *   - Storage is never deleted when an add-on becomes unavailable or
 *     inapplicable; it is only hidden from presentation, so re-enabling keeps
 *     the original values.
 *   - Write paths validate values through the add-on's hooks before persisting,
 *     and core invariants (permissions, workflow remapping, trash read-only)
 *     always win over add-on behaviour.
 */

export const ADDON_MODES = ['required', 'always', 'optional', 'unavailable'] as const;

export type AddonMode = (typeof ADDON_MODES)[number];

/**
 * Typed contributions an add-on can make to Kapo. A definition without an
 * explicit `capabilities` list is a property add-on, matching the original
 * field-only contract.
 *
 * This first slice implements `description`; the remaining values are reserved
 * so later work does not need to widen this union under pressure.
 */
export const ADDON_CAPABILITIES = [
  'property',
  'description',
  'comments',
  'project-icon',
  'filter',
  'dashboard-widget',
  'automation',
  'custom-fields',
] as const;

export type AddonCapability = (typeof ADDON_CAPABILITIES)[number];

/**
 * Format compatibility declared by an exclusive content provider. Format ids
 * are provider-owned and versioned (for example `markdown@1`). A provider must
 * be able to read every format it writes.
 */
export interface AddonFormats {
  readonly reads: readonly string[];
  readonly writes: readonly string[];
}

export type AddonFieldType = 'boolean' | 'number' | 'text' | 'longtext' | 'date' | 'select' | 'user';
export type AddonFieldValue = string | number | boolean | null;

export interface AddonFieldOption {
  value: string;
  label: string;
}

export interface AddonFieldDefinition {
  key: string;
  label: string;
  type: AddonFieldType;
  required?: boolean;
  description?: string;
  options?: AddonFieldOption[]; // select with static options
  optionsSource?: 'users'; // select populated from permission-filtered users
  maxLength?: number;
  min?: number;
  max?: number;
  defaultValue?: AddonFieldValue;
}

export interface AddonValidationIssue {
  field?: string;
  message: string;
}

/**
 * One notification an add-on asks the core to deliver. The core owns storage,
 * read state and presentation; the add-on owns the copy. `recipients` are
 * user ids and are filtered against the project's current access, so an add-on
 * cannot notify a non-member. `message` is the plain-text fallback;
 * `translations` can provide locale-specific templates such as `{ en, nl }`,
 * and `data` supplies `{placeholder}` values.
 */
export interface AddonNotificationInput {
  recipients: readonly string[];
  message: string;
  kind?: string;
  translations?: Record<string, string>;
  data?: Record<string, string | number | boolean | null>;
  /** Internal path; defaults to the linked project page. */
  href?: string | null;
  /** Optional audit event id, used to deduplicate a watch notification. */
  sourceEventId?: string | null;
}

/** The post-commit notification endpoint passed to add-on hooks. */
export type AddonNotify = (input: AddonNotificationInput) => void;

/** One add-on field that changed during a saved value write. */
export interface AddonValueChange {
  fieldKey: string;
  from: AddonFieldValue;
  to: AddonFieldValue;
  /** The audit event written for this change, for notification deduplication. */
  auditEventId: string;
}

export interface AddonWidgetItem {
  id: string;
  label: string;
  href: string;
  meta?: string;
}

export interface AddonWidgetContext {
  viewerId: string;
  visibleProjectIds: string[];
  query<T>(sql: string, params?: unknown[]): T[]; // read-only helper; no writes
}

export interface AddonDashboardWidget {
  id: string;
  label: string;
  description?: string;
  load(ctx: AddonWidgetContext): Promise<AddonWidgetItem[]> | AddonWidgetItem[];
}

export interface AddonHooks {
  validate?(ctx: {
    projectId: string;
    values: Record<string, AddonFieldValue>;
    mode: AddonMode;
  }): AddonValidationIssue[];
  beforeLeaveInbox?(ctx: {
    projectId: string;
    values: Record<string, AddonFieldValue>;
    mode: AddonMode;
  }): AddonValidationIssue[];
  /**
   * Runs inside the trash-purge transaction, before the project rows are
   * deleted. Add-on tables must reference `projects(id) ON DELETE CASCADE`;
   * this hook exists for any extra namespaced cleanup (docs/add-ons.md §3.3).
   * A throwing hook is logged and isolated: it never blocks the purge.
   */
  onProjectPurge?(ctx: {
    projectIds: readonly string[];
    exec(sql: string): void;
  }): void;
  /**
   * Runs after the add-on value transaction commits. Use `notify` to raise
   * notifications; the callback is synchronous and must stay fast and local
   * (no network, no long scans). A throw is logged and isolated, and the value
   * write still stands. Recipients who cannot read the project are skipped.
   *
   * This is post-commit work, not validation: it must never block the save or
   * assume its database writes roll back with it.
   */
  onValuesSaved?(ctx: {
    projectId: string;
    projectTitle: string;
    actorId: string;
    mode: AddonMode;
    before: Record<string, AddonFieldValue>;
    values: Record<string, AddonFieldValue>;
    changes: readonly AddonValueChange[];
    notify: AddonNotify;
  }): void;
}

export interface AddonProjectConfig {
  enabled?: boolean;
  inheritFromParent?: boolean;
  settings?: Record<string, AddonFieldValue>;
}

/** The per-project availability resolution documented in docs/add-ons.md §2.2. */
export interface ResolvedAddonConfig {
  readonly identifier: string;
  readonly mode: AddonMode;
  /** Effectively enabled for this project. */
  readonly available: boolean;
  /** Gates this project's Inbox exit (global `required` mode only in v1). */
  readonly required: boolean;
  /** True when the effective configuration came from an ancestor. */
  readonly inherited: boolean;
  readonly settings: Readonly<Record<string, AddonFieldValue>>;
}

export interface AddonDefinition {
  identifier: string; // /^[a-z][a-z0-9-]*$/, stable, namespaces addon_data
  name: string;
  description?: string;
  version: string;
  /** Product default stored by the registry→`addons` table sync (default `optional`). */
  defaultMode?: AddonMode;
  /**
   * Typed contributions. Omitted means `['property']`, preserving the shipped
   * field-only add-on contract.
   */
  capabilities?: readonly AddonCapability[];
  /**
   * Required for exclusive content providers (currently `description`). Core
   * stores the format id and plaintext; it never parses the rich body.
   */
  formats?: AddonFormats;
  fields: AddonFieldDefinition[];
  /**
   * Optional application-wide settings, rendered under
   * Application settings → Add-ons. Values live in the `addons.settings` JSON
   * column and are validated against these definitions on every write.
   *
   * Application settings support `boolean`, `number`, `text`, `longtext`,
   * `date` and static `select` fields. `user` fields and `optionsSource`
   * selects are project-scoped only; they are kept read-only here and their
   * stored values are preserved.
   */
  settingsFields?: AddonFieldDefinition[];
  searchFields?: string[]; // field keys exposed to FTS
  compactRenderer?: string; // UI key resolved later; registry ships none
  dashboardWidgets?: AddonDashboardWidget[];
  hooks?: AddonHooks;
}
