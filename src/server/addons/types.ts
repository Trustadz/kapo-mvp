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

export type AddonMode = 'required' | 'always' | 'optional' | 'unavailable';
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
}

export interface AddonDefinition {
  identifier: string; // /^[a-z][a-z0-9-]*$/, stable, namespaces addon_data
  name: string;
  description?: string;
  version: string;
  fields: AddonFieldDefinition[];
  searchFields?: string[]; // field keys exposed to FTS
  compactRenderer?: string; // UI key resolved later; registry ships none
  dashboardWidgets?: AddonDashboardWidget[];
  hooks?: AddonHooks;
}
