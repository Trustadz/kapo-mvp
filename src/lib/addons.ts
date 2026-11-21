import type {
  AddonFieldDefinition,
  AddonFieldType,
  AddonFieldValue,
  AddonMode,
} from '@/server/addons/types';

export type {
  AddonFieldDefinition,
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
  settings: Record<string, AddonFieldValue>;
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
