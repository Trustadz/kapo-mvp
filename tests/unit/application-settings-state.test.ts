import { describe, expect, it } from 'vitest';
import type { AddonApplicationConfig } from '@/lib/addons';
import type { ApplicationSettings } from '@/server/domain/settings';
import {
  addonDraftsFromConfigs,
  addonsSaveBody,
  applicationSettingsReducer,
  applicationSettingsTabs,
  backupSaveBody,
  generalSaveBody,
  initialApplicationSettingsState,
  isBackupDirty,
  isGeneralDirty,
  tabIsDirty,
  type ApplicationSettingsState,
} from '@/components/settings/application-settings-state';

/**
 * Application settings tabs (draft contract):
 *
 * - switching tabs never discards a draft;
 * - each tab has an independent dirty state and save body;
 * - a successful save resets only that tab's saved/draft pair.
 *
 * These are the guarantees the DOM interaction (Playwright) relies on.
 */

const settings: ApplicationSettings = {
  defaultAccountRole: 'user',
  enabledViews: ['kanban', 'card', 'tree', 'list'],
  trashPurgeEnabled: true,
  trashRetentionDays: 30,
  mcpEnabled: false,
  installationName: 'Kapo',
  backupEnabled: true,
  backupStartTime: '03:00',
  backupRetention: 7,
};

const addons: AddonApplicationConfig[] = [
  {
    identifier: 'assignee',
    name: 'Assignee',
    description: 'Assign a project to one household member.',
    version: '1.0.0',
    mode: 'optional',
    settings: {},
    settingsFields: [],
  },
  {
    identifier: 'digest',
    name: 'Digest',
    version: '2.0.0',
    mode: 'always',
    settings: { frequency: 'weekly', legacy: 'keep' },
    settingsFields: [
      {
        key: 'frequency',
        label: 'Frequency',
        type: 'select',
        options: [
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
        ],
      },
      { key: 'paused', label: 'Paused', type: 'boolean', defaultValue: false },
    ],
  },
];

function initial(): ApplicationSettingsState {
  return initialApplicationSettingsState(settings, addons);
}

describe('application settings tabs', () => {
  it('offers General and Backups, adding Add-ons only when the registry is non-empty', () => {
    expect(applicationSettingsTabs([])).toEqual(['general', 'backups', 'users']);
    expect(applicationSettingsTabs(addons)).toEqual([
      'general',
      'backups',
      'addons',
      'users',
    ]);
  });

  it('keeps every tab draft alive across tab switches', () => {
    let state = initial();
    state = applicationSettingsReducer(state, {
      type: 'updateGeneral',
      patch: { trashRetentionDays: 29 },
    });
    state = applicationSettingsReducer(state, {
      type: 'updateBackup',
      patch: { backupStartTime: '04:45' },
    });
    state = applicationSettingsReducer(state, {
      type: 'updateAddonMode',
      identifier: 'assignee',
      mode: 'required',
    });

    state = applicationSettingsReducer(state, { type: 'selectTab', tab: 'backups' });
    expect(state.activeTab).toBe('backups');
    expect(state.general.trashRetentionDays).toBe(29);
    expect(state.addons.assignee?.mode).toBe('required');

    state = applicationSettingsReducer(state, { type: 'selectTab', tab: 'general' });
    expect(state.backup.backupStartTime).toBe('04:45');
    expect(state.general.trashRetentionDays).toBe(29);

    state = applicationSettingsReducer(state, { type: 'selectTab', tab: 'addons' });
    expect(state.addons.assignee?.mode).toBe('required');
    expect(state.backup.backupStartTime).toBe('04:45');
  });

  it('tracks dirty state per tab', () => {
    let state = initial();
    expect(tabIsDirty(state, 'general', addons)).toBe(false);
    expect(tabIsDirty(state, 'backups', addons)).toBe(false);
    expect(tabIsDirty(state, 'addons', addons)).toBe(false);

    state = applicationSettingsReducer(state, {
      type: 'updateGeneral',
      patch: { trashRetentionDays: 29 },
    });
    expect(tabIsDirty(state, 'general', addons)).toBe(true);
    expect(tabIsDirty(state, 'backups', addons)).toBe(false);
    expect(tabIsDirty(state, 'addons', addons)).toBe(false);

    state = applicationSettingsReducer(state, {
      type: 'updateBackup',
      patch: { backupRetention: 5 },
    });
    expect(tabIsDirty(state, 'backups', addons)).toBe(true);

    state = applicationSettingsReducer(state, {
      type: 'updateAddonMode',
      identifier: 'assignee',
      mode: 'required',
    });
    expect(tabIsDirty(state, 'addons', addons)).toBe(true);
  });

  it('builds a save body containing only the active tab fields', () => {
    let state = initial();
    state = applicationSettingsReducer(state, {
      type: 'updateGeneral',
      patch: { trashRetentionDays: 29, enabledViews: ['card', 'list'] },
    });
    state = applicationSettingsReducer(state, {
      type: 'updateBackup',
      patch: { backupStartTime: '04:45' },
    });

    expect(generalSaveBody(state.general)).toEqual({
      defaultAccountRole: 'user',
      enabledViews: ['card', 'list'],
      trashPurgeEnabled: true,
      trashRetentionDays: 29,
      mcpEnabled: false,
    });
    expect(backupSaveBody(state.backup)).toEqual({
      backupEnabled: true,
      backupStartTime: '04:45',
      backupRetention: 7,
    });
    expect(isGeneralDirty(state.general, state.savedGeneral)).toBe(true);
    expect(isBackupDirty(state.backup, state.savedBackup)).toBe(true);
  });

  it('submits only changed add-ons and omits settings for a mode-only change', () => {
    let state = initial();
    expect(addonsSaveBody(state.addons, state.savedAddons, addons)).toEqual({});

    state = applicationSettingsReducer(state, {
      type: 'updateAddonMode',
      identifier: 'assignee',
      mode: 'required',
    });
    expect(addonsSaveBody(state.addons, state.savedAddons, addons)).toEqual({
      assignee: { mode: 'required' },
    });

    state = applicationSettingsReducer(state, {
      type: 'updateAddonSetting',
      identifier: 'digest',
      key: 'frequency',
      value: 'daily',
    });
    expect(addonsSaveBody(state.addons, state.savedAddons, addons)).toEqual({
      assignee: { mode: 'required' },
      digest: {
        mode: 'always',
        // Unknown stored keys (legacy) are merged server-side, not sent here.
        settings: { frequency: 'daily', paused: false },
      },
    });
  });

  it('rejects removing the last enabled view and keeps canonical order', () => {
    let state = initial();
    state = applicationSettingsReducer(state, {
      type: 'updateGeneral',
      patch: { enabledViews: ['list'] },
    });
    const before = state;
    state = applicationSettingsReducer(state, {
      type: 'toggleView',
      view: 'list',
      checked: false,
    });
    expect(state).toBe(before);

    state = applicationSettingsReducer(state, {
      type: 'toggleView',
      view: 'kanban',
      checked: true,
    });
    expect(state.general.enabledViews).toEqual(['kanban', 'list']);
  });

  it('adds declared defaults without overwriting stored or unknown values', () => {
    const drafts = addonDraftsFromConfigs(addons);
    expect(drafts.digest?.settings).toEqual({
      frequency: 'weekly',
      legacy: 'keep',
      paused: false,
    });
  });
});

describe('per-tab save success', () => {
  it('clears only the General tab after a General save', () => {
    let state = initial();
    state = applicationSettingsReducer(state, {
      type: 'updateGeneral',
      patch: { trashRetentionDays: 29 },
    });
    state = applicationSettingsReducer(state, {
      type: 'updateBackup',
      patch: { backupStartTime: '04:45' },
    });
    state = applicationSettingsReducer(state, {
      type: 'updateAddonMode',
      identifier: 'assignee',
      mode: 'required',
    });

    state = applicationSettingsReducer(state, {
      type: 'saveSucceeded',
      tab: 'general',
      settings: { ...settings, trashRetentionDays: 29 },
    });

    expect(isGeneralDirty(state.general, state.savedGeneral)).toBe(false);
    expect(state.general.trashRetentionDays).toBe(29);
    // Other tab drafts survive untouched.
    expect(state.backup.backupStartTime).toBe('04:45');
    expect(isBackupDirty(state.backup, state.savedBackup)).toBe(true);
    expect(state.addons.assignee?.mode).toBe('required');
    expect(tabIsDirty(state, 'addons', addons)).toBe(true);
  });

  it('clears only the Backups tab after a Backups save', () => {
    let state = initial();
    state = applicationSettingsReducer(state, {
      type: 'updateGeneral',
      patch: { trashRetentionDays: 29 },
    });
    state = applicationSettingsReducer(state, {
      type: 'updateBackup',
      patch: { backupStartTime: '04:45' },
    });

    state = applicationSettingsReducer(state, {
      type: 'saveSucceeded',
      tab: 'backups',
      settings: { ...settings, backupStartTime: '04:45' },
    });

    expect(isBackupDirty(state.backup, state.savedBackup)).toBe(false);
    expect(state.backup.backupStartTime).toBe('04:45');
    expect(isGeneralDirty(state.general, state.savedGeneral)).toBe(true);
  });

  it('refreshes every submitted add-on from the response and clears their drafts', () => {
    let state = initial();
    state = applicationSettingsReducer(state, {
      type: 'updateAddonMode',
      identifier: 'assignee',
      mode: 'required',
    });
    state = applicationSettingsReducer(state, {
      type: 'updateAddonSetting',
      identifier: 'digest',
      key: 'frequency',
      value: 'daily',
    });

    const response: AddonApplicationConfig[] = addons.map((addon) =>
      addon.identifier === 'assignee'
        ? { ...addon, mode: 'required' }
        : addon.identifier === 'digest'
          ? {
              ...addon,
              settings: { ...addon.settings, frequency: 'daily' },
            }
          : addon,
    );

    state = applicationSettingsReducer(state, {
      type: 'saveSucceeded',
      tab: 'addons',
      settings,
      addons: response,
    });

    expect(tabIsDirty(state, 'addons', addons)).toBe(false);
    expect(state.savedAddons.assignee?.mode).toBe('required');
    expect(state.savedAddons.digest?.settings.frequency).toBe('daily');
    // Defaults are re-applied consistently after the response.
    expect(state.addons.digest?.settings.paused).toBe(false);
  });

  it('resetTab restores only that tab and keeps other drafts', () => {
    let state = initial();
    state = applicationSettingsReducer(state, {
      type: 'updateGeneral',
      patch: { trashRetentionDays: 29 },
    });
    state = applicationSettingsReducer(state, {
      type: 'updateBackup',
      patch: { backupStartTime: '04:45' },
    });
    state = applicationSettingsReducer(state, {
      type: 'updateAddonMode',
      identifier: 'assignee',
      mode: 'required',
    });

    state = applicationSettingsReducer(state, { type: 'resetTab', tab: 'general' });
    expect(state.general.trashRetentionDays).toBe(30);
    expect(state.backup.backupStartTime).toBe('04:45');
    expect(state.addons.assignee?.mode).toBe('required');

    state = applicationSettingsReducer(state, { type: 'resetTab', tab: 'addons' });
    expect(state.addons.assignee?.mode).toBe('optional');
    expect(state.backup.backupStartTime).toBe('04:45');
  });
});
