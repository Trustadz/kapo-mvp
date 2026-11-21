import type {
  AddonApplicationConfig,
  AddonFieldValue,
  AddonMode,
} from '@/lib/addons';
import {
  applicationAddonSettingsPayload,
  initialAddonSettings,
  sameAddonSettings,
} from '@/lib/addon-settings';
import { COLLECTION_VIEWS, type CollectionView } from '@/lib/types';
import type { ApplicationSettings } from '@/server/domain/settings';

/**
 * Draft/saved state for Application settings.
 *
 * The form is tabbed, but every tab keeps its own draft until that tab is
 * saved or cancelled. Keeping this out of the component makes the two tricky
 * guarantees directly testable:
 *
 *  - selecting another tab never rewrites any draft;
 *  - saving one tab only replaces that section's saved + draft values.
 */

export type ApplicationSettingsTab = 'general' | 'backups' | 'addons' | 'users';

export interface GeneralDraft {
  defaultAccountRole: ApplicationSettings['defaultAccountRole'];
  enabledViews: CollectionView[];
  trashPurgeEnabled: boolean;
  trashRetentionDays: number;
  mcpEnabled: boolean;
}

export interface BackupDraft {
  backupEnabled: boolean;
  backupStartTime: string;
  backupRetention: number;
}

export interface AddonDraft {
  mode: AddonMode;
  settings: Record<string, AddonFieldValue>;
}

export interface ApplicationSettingsState {
  activeTab: ApplicationSettingsTab;
  savedGeneral: GeneralDraft;
  general: GeneralDraft;
  savedBackup: BackupDraft;
  backup: BackupDraft;
  savedAddons: Record<string, AddonDraft>;
  addons: Record<string, AddonDraft>;
}

export function generalDraftFromSettings(settings: ApplicationSettings): GeneralDraft {
  return {
    defaultAccountRole: settings.defaultAccountRole,
    enabledViews: [...settings.enabledViews],
    trashPurgeEnabled: settings.trashPurgeEnabled,
    trashRetentionDays: settings.trashRetentionDays,
    mcpEnabled: settings.mcpEnabled,
  };
}

export function backupDraftFromSettings(settings: ApplicationSettings): BackupDraft {
  return {
    backupEnabled: settings.backupEnabled,
    backupStartTime: settings.backupStartTime,
    backupRetention: settings.backupRetention,
  };
}

export function addonDraftFromConfig(config: AddonApplicationConfig): AddonDraft {
  return {
    mode: config.mode,
    settings: initialAddonSettings(config),
  };
}

export function addonDraftsFromConfigs(
  configs: readonly AddonApplicationConfig[],
): Record<string, AddonDraft> {
  const drafts: Record<string, AddonDraft> = {};
  for (const config of configs) drafts[config.identifier] = addonDraftFromConfig(config);
  return drafts;
}

export function applicationSettingsTabs(
  addons: readonly AddonApplicationConfig[],
): ApplicationSettingsTab[] {
  return [
    'general',
    'backups',
    ...(addons.length > 0 ? (['addons'] as const) : []),
    'users',
  ];
}

export function initialApplicationSettingsState(
  settings: ApplicationSettings,
  addons: readonly AddonApplicationConfig[],
): ApplicationSettingsState {
  const general = generalDraftFromSettings(settings);
  const backup = backupDraftFromSettings(settings);
  const addonDrafts = addonDraftsFromConfigs(addons);
  return {
    activeTab: 'general',
    savedGeneral: { ...general, enabledViews: [...general.enabledViews] },
    general,
    savedBackup: { ...backup },
    backup,
    savedAddons: addonDraftsFromConfigs(addons),
    addons: addonDrafts,
  };
}

export type ApplicationSettingsAction =
  | { type: 'selectTab'; tab: ApplicationSettingsTab }
  | { type: 'updateGeneral'; patch: Partial<GeneralDraft> }
  | { type: 'toggleView'; view: CollectionView; checked: boolean }
  | { type: 'updateBackup'; patch: Partial<BackupDraft> }
  | { type: 'updateAddonMode'; identifier: string; mode: AddonMode }
  | {
      type: 'updateAddonSetting';
      identifier: string;
      key: string;
      value: AddonFieldValue;
    }
  | { type: 'resetTab'; tab: ApplicationSettingsTab }
  | {
      type: 'saveSucceeded';
      tab: ApplicationSettingsTab;
      settings?: ApplicationSettings;
      addons?: readonly AddonApplicationConfig[];
    };

export function applicationSettingsReducer(
  state: ApplicationSettingsState,
  action: ApplicationSettingsAction,
): ApplicationSettingsState {
  switch (action.type) {
    case 'selectTab':
      // Drafts deliberately stay untouched across tab switches.
      return { ...state, activeTab: action.tab };

    case 'updateGeneral':
      return { ...state, general: { ...state.general, ...action.patch } };

    case 'toggleView': {
      if (action.checked) {
        return {
          ...state,
          general: {
            ...state.general,
            enabledViews: COLLECTION_VIEWS.filter(
              (view) => view === action.view || state.general.enabledViews.includes(view),
            ),
          },
        };
      }
      // At least one view must remain (product.md §5). The component surfaces
      // the validation message; the reducer refuses to create an invalid state.
      if (state.general.enabledViews.length <= 1) return state;
      return {
        ...state,
        general: {
          ...state.general,
          enabledViews: state.general.enabledViews.filter((view) => view !== action.view),
        },
      };
    }

    case 'updateBackup':
      return { ...state, backup: { ...state.backup, ...action.patch } };

    case 'updateAddonMode': {
      const draft = state.addons[action.identifier];
      if (!draft) return state;
      return {
        ...state,
        addons: {
          ...state.addons,
          [action.identifier]: { ...draft, mode: action.mode },
        },
      };
    }

    case 'updateAddonSetting': {
      const draft = state.addons[action.identifier];
      if (!draft) return state;
      return {
        ...state,
        addons: {
          ...state.addons,
          [action.identifier]: {
            ...draft,
            settings: { ...draft.settings, [action.key]: action.value },
          },
        },
      };
    }

    case 'resetTab': {
      if (action.tab === 'users') return state;
      if (action.tab === 'general') {
        return {
          ...state,
          general: {
            ...state.savedGeneral,
            enabledViews: [...state.savedGeneral.enabledViews],
          },
        };
      }
      if (action.tab === 'backups') {
        return { ...state, backup: { ...state.savedBackup } };
      }
      return { ...state, addons: cloneAddonDrafts(state.savedAddons) };
    }

    case 'saveSucceeded': {
      if (action.tab === 'general' && action.settings) {
        const next = generalDraftFromSettings(action.settings);
        return {
          ...state,
          savedGeneral: { ...next, enabledViews: [...next.enabledViews] },
          general: next,
        };
      }
      if (action.tab === 'backups' && action.settings) {
        const next = backupDraftFromSettings(action.settings);
        return { ...state, savedBackup: { ...next }, backup: next };
      }
      if (action.tab === 'addons' && action.addons) {
        const savedAddons = { ...state.savedAddons };
        const addons = { ...state.addons };
        for (const config of action.addons) {
          const draft = addonDraftFromConfig(config);
          savedAddons[config.identifier] = draft;
          addons[config.identifier] = draft;
        }
        return { ...state, savedAddons, addons };
      }
      return state;
    }

    default:
      return state;
  }
}

function cloneAddonDrafts(
  source: Record<string, AddonDraft>,
): Record<string, AddonDraft> {
  const drafts: Record<string, AddonDraft> = {};
  for (const [identifier, draft] of Object.entries(source)) {
    drafts[identifier] = { mode: draft.mode, settings: { ...draft.settings } };
  }
  return drafts;
}

export function isGeneralDirty(general: GeneralDraft, saved: GeneralDraft): boolean {
  return (
    general.defaultAccountRole !== saved.defaultAccountRole ||
    general.trashPurgeEnabled !== saved.trashPurgeEnabled ||
    general.trashRetentionDays !== saved.trashRetentionDays ||
    general.mcpEnabled !== saved.mcpEnabled ||
    general.enabledViews.length !== saved.enabledViews.length ||
    general.enabledViews.some((view, index) => view !== saved.enabledViews[index])
  );
}

export function isBackupDirty(backup: BackupDraft, saved: BackupDraft): boolean {
  return (
    backup.backupEnabled !== saved.backupEnabled ||
    backup.backupStartTime !== saved.backupStartTime ||
    backup.backupRetention !== saved.backupRetention
  );
}

/** Unsaved add-on identifiers, in registry order. */
export function dirtyAddonIdentifiers(
  drafts: Record<string, AddonDraft>,
  saved: Record<string, AddonDraft>,
  configs: readonly AddonApplicationConfig[],
): string[] {
  return Object.keys(addonsSaveBody(drafts, saved, configs));
}

export function tabIsDirty(
  state: ApplicationSettingsState,
  tab: ApplicationSettingsTab,
  addons: readonly AddonApplicationConfig[],
): boolean {
  if (tab === 'general') return isGeneralDirty(state.general, state.savedGeneral);
  if (tab === 'backups') return isBackupDirty(state.backup, state.savedBackup);
  if (tab === 'users') return false;
  return dirtyAddonIdentifiers(state.addons, state.savedAddons, addons).length > 0;
}

/** Only the General section's fields; backups/add-ons are never included. */
export function generalSaveBody(general: GeneralDraft) {
  return {
    defaultAccountRole: general.defaultAccountRole,
    enabledViews: [...general.enabledViews],
    trashPurgeEnabled: general.trashPurgeEnabled,
    trashRetentionDays: general.trashRetentionDays,
    mcpEnabled: general.mcpEnabled,
  };
}

/** Only the Backups section's fields. */
export function backupSaveBody(backup: BackupDraft) {
  return {
    backupEnabled: backup.backupEnabled,
    backupStartTime: backup.backupStartTime,
    backupRetention: backup.backupRetention,
  };
}

/**
 * Only add-ons whose mode or settings changed. Settings are included only
 * when they changed so a mode-only update keeps the existing API semantics
 * (no surprising required-field validation).
 */
export function addonsSaveBody(
  drafts: Record<string, AddonDraft>,
  saved: Record<string, AddonDraft>,
  configs: readonly AddonApplicationConfig[],
): Record<string, { mode: AddonMode; settings?: Record<string, AddonFieldValue> }> {
  const body: Record<
    string,
    { mode: AddonMode; settings?: Record<string, AddonFieldValue> }
  > = {};
  for (const config of configs) {
    const draft = drafts[config.identifier];
    const savedDraft = saved[config.identifier];
    if (!draft || !savedDraft) continue;
    const modeDirty = draft.mode !== savedDraft.mode;
    const settingsDirty = !sameAddonSettings(draft.settings, savedDraft.settings);
    if (!modeDirty && !settingsDirty) continue;
    body[config.identifier] = {
      mode: draft.mode,
      ...(settingsDirty
        ? { settings: applicationAddonSettingsPayload(config, draft.settings) }
        : {}),
    };
  }
  return body;
}
