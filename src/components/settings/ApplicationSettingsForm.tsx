'use client';

import { useReducer, useState, type FormEvent } from 'react';
import { UsersManager } from '@/components/accounts/UsersManager';
import {
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
  Tabs,
  Toast,
  tabId,
  tabPanelId,
} from '@/components/ui';
import { useToastMessage } from '@/components/ui/use-live-announcer';
import { requestJson } from '@/lib/api-client';
import { APP_ROLES, COLLECTION_VIEWS, type AppRole, type CollectionView } from '@/lib/types';
import type { AddonApplicationConfig, AddonFieldValue, AddonMode } from '@/lib/addons';
import type { DescriptionCapabilitySettings } from '@/lib/description';
import { ADDON_MODE_OPTIONS } from '@/lib/addons';
import { addonSettingsFieldList } from '@/lib/addon-settings';
import { COLLECTION_VIEW_MESSAGE_KEYS, SHORT_ROLE_MESSAGE_KEYS } from '@/i18n/domain-labels';
import { useI18n } from '@/i18n/client';
import type { BackupStatus } from '@/server/backup';
import type { ApplicationSettings } from '@/server/domain/settings';
import type { AccountUser } from '@/server/domain/users';
import { AddonSettingsFields } from './AddonSettingsFields';
import { DescriptionProviderCard } from './DescriptionProviderCard';
import {
  addonsSaveBody,
  applicationSettingsReducer,
  applicationSettingsTabs,
  backupSaveBody,
  generalSaveBody,
  initialApplicationSettingsState,
  isBackupDirty,
  isGeneralDirty,
  tabIsDirty,
  type AddonDraft,
  type ApplicationSettingsTab,
  type BackupDraft,
  type GeneralDraft,
} from './application-settings-state';
import styles from './ApplicationSettingsForm.module.css';

export interface ApplicationSettingsFormProps {
  settings: ApplicationSettings;
  backupStatus: BackupStatus;
  addons: AddonApplicationConfig[];
  descriptionCapability: DescriptionCapabilitySettings;
  users: AccountUser[];
  defaultRole: AppRole;
}

const ID_PREFIX = 'application-settings';

const TAB_MESSAGE_KEYS = {
  general: 'settings.tabs.general',
  backups: 'settings.tabs.backups',
  addons: 'settings.tabs.addons',
  users: 'settings.tabs.users',
} as const satisfies Record<ApplicationSettingsTab, string>;

const TAB_ICONS: Record<ApplicationSettingsTab, string> = {
  general: 'tune',
  backups: 'backup',
  addons: 'extension',
  users: 'group',
};

const ADDON_MODE_MESSAGE_KEYS: Record<
  AddonMode,
  'addons.modeRequired' | 'addons.modeAlways' | 'addons.modeOptional' | 'addons.modeUnavailable'
> = {
  required: 'addons.modeRequired',
  always: 'addons.modeAlways',
  optional: 'addons.modeOptional',
  unavailable: 'addons.modeUnavailable',
};

const ADDON_MODE_NOTE_KEYS: Record<
  AddonMode,
  | 'addons.requiredNote'
  | 'addons.alwaysNote'
  | 'addons.optionalNote'
  | 'addons.unavailableNote'
> = {
  required: 'addons.requiredNote',
  always: 'addons.alwaysNote',
  optional: 'addons.optionalNote',
  unavailable: 'addons.unavailableNote',
};

type TabErrors = Partial<Record<ApplicationSettingsTab, Record<string, string>>>;
type TabFormErrors = Partial<Record<ApplicationSettingsTab, string | null>>;

interface SaveResponse {
  settings: ApplicationSettings;
  backupStatus?: BackupStatus;
  addons?: AddonApplicationConfig[];
}

function settingsErrorsForAddon(
  errors: Record<string, string>,
  identifier: string,
): Record<string, string> {
  const prefix = `addons.${identifier}.settings.`;
  const result: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = message;
  }
  return result;
}

/**
 * Application settings (Admin): General, Backups and one panel per registered
 * add-on. Each tab owns a draft and a Save/Cancel pair; switching tabs keeps
 * every draft intact and saving one tab only submits (and clears) that tab's
 * fields. The add-on tab renders a mode Select and the add-on's optional global
 * settings fields (issues #13, #21 and the add-on foundation).
 */
export function ApplicationSettingsForm({
  settings,
  backupStatus,
  addons,
  descriptionCapability,
  users,
  defaultRole,
}: ApplicationSettingsFormProps) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(
    applicationSettingsReducer,
    { settings, addons },
    ({ settings: initialSettings, addons: initialAddons }) =>
      initialApplicationSettingsState(initialSettings, initialAddons),
  );
  const [status, setStatus] = useState<BackupStatus>(backupStatus);
  const [fieldErrors, setFieldErrors] = useState<TabErrors>({});
  const [formErrors, setFormErrors] = useState<TabFormErrors>({});
  const [savingTab, setSavingTab] = useState<ApplicationSettingsTab | null>(null);
  const { toast, notify, dismiss } = useToastMessage();

  const tabs = applicationSettingsTabs(addons, descriptionCapability.providers.length > 0);
  const addonPatch = addonsSaveBody(state.addons, state.savedAddons, addons);
  const generalDirty = isGeneralDirty(state.general, state.savedGeneral);
  const backupDirty = isBackupDirty(state.backup, state.savedBackup);
  const addonsDirty = Object.keys(addonPatch).length > 0;
  const addonErrors = fieldErrors.addons ?? {};

  const clearFieldError = (tab: ApplicationSettingsTab, key: string) => {
    setFieldErrors((current) => {
      const currentErrors = current[tab];
      if (!currentErrors || !(key in currentErrors)) return current;
      const nextErrors = { ...currentErrors };
      delete nextErrors[key];
      return { ...current, [tab]: nextErrors };
    });
  };

  const setFieldError = (tab: ApplicationSettingsTab, key: string, message: string) => {
    setFieldErrors((current) => ({
      ...current,
      [tab]: { ...(current[tab] ?? {}), [key]: message },
    }));
  };

  const clearTabErrors = (tab: ApplicationSettingsTab) => {
    setFieldErrors((current) => {
      if (!current[tab]) return current;
      const next = { ...current };
      delete next[tab];
      return next;
    });
    setFormErrors((current) => {
      if (!current[tab]) return current;
      const next = { ...current };
      delete next[tab];
      return next;
    });
  };

  const setFormError = (tab: ApplicationSettingsTab, message: string | null) => {
    setFormErrors((current) => ({ ...current, [tab]: message }));
  };

  const save = async (
    tab: ApplicationSettingsTab,
    body: Record<string, unknown>,
    options: { expectAddons?: boolean } = {},
  ) => {
    if (savingTab) return;
    setSavingTab(tab);
    setFormError(tab, null);
    try {
      const result = await requestJson<SaveResponse>('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        if (result.fields) {
          setFieldErrors((current) => ({ ...current, [tab]: result.fields }));
        }
        setFormError(tab, result.message);
        return;
      }
      dispatch({
        type: 'saveSucceeded',
        tab,
        settings: result.data.settings,
        ...(options.expectAddons && result.data.addons
          ? { addons: result.data.addons }
          : {}),
      });
      setFieldErrors((current) => {
        if (!current[tab]) return current;
        const next = { ...current };
        delete next[tab];
        return next;
      });
      if (result.data.backupStatus) setStatus(result.data.backupStatus);
      notify(t('settings.saved'));
    } catch {
      setFormError(tab, t('common.networkError'));
    } finally {
      setSavingTab(null);
    }
  };

  const handleGeneralSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingTab || !generalDirty) return;
    if (state.general.enabledViews.length === 0) {
      setFieldError('general', 'enabledViews', t('settings.oneViewRequired'));
      return;
    }
    void save('general', generalSaveBody(state.general));
  };

  const handleBackupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingTab || !backupDirty) return;
    void save('backups', backupSaveBody(state.backup));
  };

  const handleAddonsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingTab || Object.keys(addonPatch).length === 0) return;
    void save('addons', { addons: addonPatch }, { expectAddons: true });
  };

  const cancelTab = (tab: ApplicationSettingsTab) => {
    dispatch({ type: 'resetTab', tab });
    clearTabErrors(tab);
  };

  const toggleView = (view: CollectionView, checked: boolean) => {
    if (!checked && state.general.enabledViews.length <= 1) {
      setFieldError('general', 'enabledViews', t('settings.oneViewRequired'));
      return;
    }
    clearFieldError('general', 'enabledViews');
    dispatch({ type: 'toggleView', view, checked });
  };

  const generalErrors = fieldErrors.general ?? {};
  const backupErrors = fieldErrors.backups ?? {};

  return (
    <>
      <Card className={styles.card}>
        <Tabs
          items={tabs.map((tab) => ({
            id: tab,
            label: t(TAB_MESSAGE_KEYS[tab]),
            icon: TAB_ICONS[tab],
            dirty: tabIsDirty(state, tab, addons),
          }))}
          value={state.activeTab}
          onChange={(tab) => dispatch({ type: 'selectTab', tab })}
          ariaLabel={t('settings.applicationSectionsAria')}
          idPrefix={ID_PREFIX}
        />

        <div
          role="tabpanel"
          id={tabPanelId(ID_PREFIX, 'general')}
          aria-labelledby={tabId(ID_PREFIX, 'general')}
          hidden={state.activeTab !== 'general'}
          tabIndex={state.activeTab === 'general' ? 0 : -1}
          className={styles.panel}
        >
          <GeneralPanel
            values={state.general}
            errors={generalErrors}
            formError={formErrors.general ?? null}
            dirty={generalDirty}
            saving={savingTab === 'general'}
            onChange={(patch) => {
              for (const key of Object.keys(patch)) clearFieldError('general', key);
              dispatch({ type: 'updateGeneral', patch });
            }}
            onToggleView={toggleView}
            onSubmit={handleGeneralSubmit}
            onCancel={() => cancelTab('general')}
          />
        </div>

        <div
          role="tabpanel"
          id={tabPanelId(ID_PREFIX, 'backups')}
          aria-labelledby={tabId(ID_PREFIX, 'backups')}
          hidden={state.activeTab !== 'backups'}
          tabIndex={state.activeTab === 'backups' ? 0 : -1}
          className={styles.panel}
        >
          <BackupsPanel
            values={state.backup}
            errors={backupErrors}
            formError={formErrors.backups ?? null}
            dirty={backupDirty}
            saving={savingTab === 'backups'}
            status={status}
            onChange={(patch) => {
              for (const key of Object.keys(patch)) clearFieldError('backups', key);
              dispatch({ type: 'updateBackup', patch });
            }}
            onSubmit={handleBackupSubmit}
            onCancel={() => cancelTab('backups')}
          />
        </div>

        {tabs.includes('addons') ? (
          <div
            role="tabpanel"
            id={tabPanelId(ID_PREFIX, 'addons')}
            aria-labelledby={tabId(ID_PREFIX, 'addons')}
            hidden={state.activeTab !== 'addons'}
            tabIndex={state.activeTab === 'addons' ? 0 : -1}
            className={styles.panel}
          >
            <AddonsPanel
              addons={addons}
              descriptionCapability={descriptionCapability}
              drafts={state.addons}
              errors={addonErrors}
              formError={formErrors.addons ?? null}
              dirty={addonsDirty}
              saving={savingTab === 'addons'}
              onModeChange={(identifier, mode) => {
                clearFieldError('addons', `addons.${identifier}.mode`);
                dispatch({ type: 'updateAddonMode', identifier, mode });
              }}
              onSettingChange={(identifier, key, value) => {
                clearFieldError('addons', `addons.${identifier}.settings.${key}`);
                dispatch({ type: 'updateAddonSetting', identifier, key, value });
              }}
              onSubmit={handleAddonsSubmit}
              onCancel={() => cancelTab('addons')}
            />
          </div>
        ) : null}

        <div
          role="tabpanel"
          id={tabPanelId(ID_PREFIX, 'users')}
          aria-labelledby={tabId(ID_PREFIX, 'users')}
          hidden={state.activeTab !== 'users'}
          tabIndex={state.activeTab === 'users' ? 0 : -1}
          className={styles.panel}
        >
          {/* UsersManager needs the app-router context; mount it only when
              this panel is active, but keep the tabpanel element present. */}
          {state.activeTab === 'users' ? (
            <UsersManager users={users} defaultRole={defaultRole} embedded />
          ) : null}
        </div>
      </Card>

      <Toast
        open={toast !== null}
        message={toast?.message ?? ''}
        tone={toast?.tone ?? 'success'}
        announcementKey={toast?.sequence}
        onClose={dismiss}
      />
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* General                                                                   */
/* ------------------------------------------------------------------------- */

interface GeneralPanelProps {
  values: GeneralDraft;
  errors: Record<string, string>;
  formError: string | null;
  dirty: boolean;
  saving: boolean;
  onChange: (patch: Partial<GeneralDraft>) => void;
  onToggleView: (view: CollectionView, checked: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function GeneralPanel({
  values,
  errors,
  formError,
  dirty,
  saving,
  onChange,
  onToggleView,
  onSubmit,
  onCancel,
}: GeneralPanelProps) {
  const { t } = useI18n();
  return (
    <form
      className={styles.form}
      onSubmit={onSubmit}
      noValidate
      aria-label={t('settings.generalFormAria')}
    >
      <h2 className={styles.panelTitle}>{t('settings.generalSettings')}</h2>
      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <Field
        label={t('settings.defaultRole')}
        htmlFor="settings-default-role"
        labelWidth={190}
        error={errors.defaultAccountRole}
      >
        <Select
          id="settings-default-role"
          name="defaultAccountRole"
          value={values.defaultAccountRole}
          onChange={(event) =>
            onChange({ defaultAccountRole: event.target.value as AppRole })
          }
          className={styles.select}
        >
          {APP_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(SHORT_ROLE_MESSAGE_KEYS[role])}
            </option>
          ))}
        </Select>
      </Field>

      <Checkbox
        id="settings-trash-purge-enabled"
        name="trashPurgeEnabled"
        label={t('settings.trashPurgeEnabled')}
        description={t('settings.trashPurgeEnabledDescription')}
        checked={values.trashPurgeEnabled}
        onChange={(event) => onChange({ trashPurgeEnabled: event.target.checked })}
      />

      <Field
        label={t('settings.trashRetention')}
        htmlFor="settings-trash-retention"
        labelWidth={190}
        hint={t('settings.trashRetentionHint')}
        error={errors.trashRetentionDays}
      >
        <Input
          id="settings-trash-retention"
          name="trashRetentionDays"
          type="number"
          min={1}
          max={365}
          step={1}
          value={values.trashRetentionDays}
          onChange={(event) =>
            onChange({ trashRetentionDays: Number(event.target.value) })
          }
          className={styles.numberInput}
        />
      </Field>

      <fieldset
        className={styles.viewsFieldset}
        aria-describedby={errors.enabledViews ? 'views-hint views-error' : 'views-hint'}
        aria-invalid={errors.enabledViews ? true : undefined}
      >
        <legend className={styles.viewsLegend}>{t('settings.viewsAvailable')}</legend>
        {errors.enabledViews ? (
          <p id="views-error" className={styles.fieldError} role="alert">
            {errors.enabledViews}
          </p>
        ) : null}
        <div className={styles.viewsList}>
          {COLLECTION_VIEWS.map((view) => (
            <Checkbox
              key={view}
              id={`settings-view-${view}`}
              name="enabledViews"
              value={view}
              label={t(COLLECTION_VIEW_MESSAGE_KEYS[view])}
              checked={values.enabledViews.includes(view)}
              onChange={(event) => onToggleView(view, event.target.checked)}
            />
          ))}
        </div>
      </fieldset>
      <p id="views-hint" className={styles.hint}>
        {t('settings.oneViewRequired')}
      </p>

      <fieldset className={styles.viewsFieldset}>
        <legend className={styles.viewsLegend}>{t('settings.mcp')}</legend>
        <Checkbox
          id="settings-mcp-enabled"
          name="mcpEnabled"
          label={t('settings.mcpEnabled')}
          description={t('settings.mcpEnabledDescription')}
          checked={values.mcpEnabled}
          onChange={(event) => onChange({ mcpEnabled: event.target.checked })}
        />
      </fieldset>

      <PanelActions
        saving={saving}
        dirty={dirty}
        saveLabel={t('common.saveChanges')}
        onCancel={onCancel}
      />
    </form>
  );
}

/* ------------------------------------------------------------------------- */
/* Backups                                                                   */
/* ------------------------------------------------------------------------- */

interface BackupsPanelProps {
  values: BackupDraft;
  errors: Record<string, string>;
  formError: string | null;
  dirty: boolean;
  saving: boolean;
  status: BackupStatus;
  onChange: (patch: Partial<BackupDraft>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function BackupsPanel({
  values,
  errors,
  formError,
  dirty,
  saving,
  status,
  onChange,
  onSubmit,
  onCancel,
}: BackupsPanelProps) {
  const { t, formatDateTime } = useI18n();
  return (
    <form
      className={styles.form}
      onSubmit={onSubmit}
      noValidate
      aria-label={t('settings.backupsFormAria')}
    >
      <h2 className={styles.panelTitle}>{t('settings.backups')}</h2>
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <p className={styles.note}>{t('settings.backupsNote')}</p>

      <Checkbox
        id="settings-backup-enabled"
        name="backupEnabled"
        label={t('settings.automaticBackups')}
        checked={values.backupEnabled}
        onChange={(event) => onChange({ backupEnabled: event.target.checked })}
      />

      <div className={styles.backupFields}>
        <Field
          label={t('settings.startTime')}
          htmlFor="settings-backup-start"
          labelWidth={190}
          hint={t('settings.startTimeHint')}
          error={errors.backupStartTime}
        >
          <Input
            id="settings-backup-start"
            name="backupStartTime"
            type="time"
            value={values.backupStartTime}
            onChange={(event) => onChange({ backupStartTime: event.target.value })}
            className={styles.timeInput}
          />
        </Field>
        <Field
          label={t('settings.keepBackups')}
          htmlFor="settings-backup-retention"
          labelWidth={190}
          hint={t('settings.keepBackupsHint')}
          error={errors.backupRetention}
        >
          <Input
            id="settings-backup-retention"
            name="backupRetention"
            type="number"
            min={1}
            max={30}
            step={1}
            value={values.backupRetention}
            onChange={(event) => onChange({ backupRetention: Number(event.target.value) })}
            className={styles.numberInput}
          />
        </Field>
      </div>

      <dl className={styles.backupStatus}>
        <div className={styles.backupStatusRow}>
          <dt>{t('settings.lastBackup')}</dt>
          <dd>
            {status.lastBackup ? (
              <>
                <span suppressHydrationWarning>
                  {formatDateTime(status.lastBackup.createdAt)}
                </span>{' '}
                <span className={styles.backupName}>{status.lastBackup.name}</span>
              </>
            ) : (
              t('settings.noBackups')
            )}
          </dd>
        </div>
        <div className={styles.backupStatusRow}>
          <dt>{t('settings.nextRun')}</dt>
          <dd suppressHydrationWarning>
            {status.nextRun
              ? formatDateTime(status.nextRun)
              : t('settings.backupsDisabled')}
          </dd>
        </div>
        <div className={styles.backupStatusRow}>
          <dt>{t('settings.destination')}</dt>
          <dd>
            <code className={styles.backupPath}>{status.destination}</code>
          </dd>
        </div>
      </dl>
      <p className={styles.hint}>{t('settings.restoreManual')}</p>

      <PanelActions
        saving={saving}
        dirty={dirty}
        saveLabel={t('common.saveChanges')}
        onCancel={onCancel}
      />
    </form>
  );
}

/* ------------------------------------------------------------------------- */
/* Add-ons                                                                   */
/* ------------------------------------------------------------------------- */

interface AddonsPanelProps {
  addons: AddonApplicationConfig[];
  descriptionCapability: DescriptionCapabilitySettings;
  drafts: Record<string, AddonDraft>;
  errors: Record<string, string>;
  formError: string | null;
  dirty: boolean;
  saving: boolean;
  onModeChange: (identifier: string, mode: AddonMode) => void;
  onSettingChange: (identifier: string, key: string, value: AddonFieldValue) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function AddonsPanel({
  addons,
  descriptionCapability,
  drafts,
  errors,
  formError,
  dirty,
  saving,
  onModeChange,
  onSettingChange,
  onSubmit,
  onCancel,
}: AddonsPanelProps) {
  const { t } = useI18n();
  return (
    <form
      className={styles.form}
      onSubmit={onSubmit}
      noValidate
      aria-label={t('addons.formAria')}
    >
      <h2 className={styles.panelTitle}>{t('addons.applicationHeading')}</h2>
      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <DescriptionProviderCard capability={descriptionCapability} />

      {addons.map((addon) => {
        const draft = drafts[addon.identifier];
        if (!draft) return null;
        const titleId = `addon-title-${addon.identifier}`;
        const modeId = `addon-mode-${addon.identifier}`;
        const settingsError = errors[`addons.${addon.identifier}.settings`];
        const settingFields = addonSettingsFieldList(addon.settingsFields);
        const malformedSettings =
          Array.isArray(addon.settingsFields) &&
          addon.settingsFields.length !== settingFields.length;
        const showSettings =
          settingFields.length > 0 || malformedSettings || Boolean(settingsError);
        return (
          <section
            key={addon.identifier}
            className={styles.addonCard}
            aria-labelledby={titleId}
          >
            <div className={styles.addonHeader}>
              <h3 id={titleId} className={styles.addonName}>
                {addon.name}{' '}
                <span className={styles.addonVersion}>v{addon.version}</span>
              </h3>
              {addon.description ? (
                <p className={styles.addonDescription}>{addon.description}</p>
              ) : null}
            </div>

            <Field
              label={t('addons.modeLabel')}
              htmlFor={modeId}
              labelWidth={190}
              error={errors[`addons.${addon.identifier}.mode`]}
              hint={t(ADDON_MODE_NOTE_KEYS[draft.mode])}
            >
              <Select
                id={modeId}
                value={draft.mode}
                disabled={saving}
                onChange={(event) => onModeChange(addon.identifier, event.target.value as AddonMode)}
                className={styles.select}
              >
                {ADDON_MODE_OPTIONS.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(ADDON_MODE_MESSAGE_KEYS[mode])}
                  </option>
                ))}
              </Select>
            </Field>

            {showSettings ? (
              <div className={styles.addonSettings}>
                <h4 className={styles.settingsHeading}>{t('addons.settingsHeading')}</h4>
                {settingsError ? <Notice tone="error">{settingsError}</Notice> : null}
                <AddonSettingsFields
                  addon={addon}
                  values={draft.settings}
                  errors={settingsErrorsForAddon(errors, addon.identifier)}
                  disabled={saving}
                  onChange={(key, value) =>
                    onSettingChange(addon.identifier, key, value)
                  }
                />
              </div>
            ) : null}
          </section>
        );
      })}

      <PanelActions
        saving={saving}
        dirty={dirty}
        saveLabel={t('addons.saveProject')}
        onCancel={onCancel}
      />
    </form>
  );
}

/* ------------------------------------------------------------------------- */
/* Shared footer                                                             */
/* ------------------------------------------------------------------------- */

function PanelActions({
  saving,
  dirty,
  saveLabel,
  onCancel,
}: {
  saving: boolean;
  dirty: boolean;
  saveLabel: string;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.actions}>
      <Button
        type="submit"
        loading={saving}
        disabled={!dirty || saving}
        className={styles.saveButton}
      >
        {saveLabel}
      </Button>
      <Button
        type="button"
        variant="quiet"
        onClick={onCancel}
        disabled={!dirty || saving}
        className={styles.cancelButton}
      >
        {t('common.cancel')}
      </Button>
      <span className={styles.dirtyHint} data-dirty={dirty || undefined}>
        {dirty ? t('settings.unsavedChanges') : ''}
      </span>
    </div>
  );
}
