'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  Field,
  FieldGroup,
  Icon,
  Input,
  Notice,
  Radio,
  Select,
  Toast,
} from '@/components/ui';
import type { CollectionView, ProjectRole } from '@/lib/types';
import { COLLECTION_VIEWS } from '@/lib/types';
import {
  COLLECTION_VIEW_MESSAGE_KEYS,
  PROJECT_FIELD_MESSAGE_KEYS,
  SHORT_ROLE_MESSAGE_KEYS,
  VIEW_FIELD_MESSAGE_KEYS,
} from '@/i18n/domain-labels';
import { useI18n } from '@/i18n/client';
import type {
  ProjectFieldKey,
  ProjectPageData,
  WorkflowViewData,
  ProjectMemberView,
} from './types';
import { PROJECT_FIELD_KEYS } from './types';
import type { MemberCandidate } from './api';
import type { ProjectAccessMode, ViewFieldKey, ViewFields } from '@/lib/projects';
import { DEFAULT_VIEW_FIELDS, VIEW_FIELD_KEYS } from '@/lib/projects';
import { formatPersonName } from '@/lib/format';
import { markFieldChanged } from '@/lib/changed-fields';
import { useFieldChanged } from '@/lib/use-field-changed';
import { useToastMessage } from '@/components/ui/use-live-announcer';
import { saveMembers, saveProjectSettings, saveWorkflow, updateProjectFields } from './api';
import styles from './ProjectSettings.module.css';

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, user: 2, admin: 3 };

function rank(role: ProjectRole | null | undefined): number {
  return role ? ROLE_RANK[role] : 0;
}

type TabId = 'general' | 'workflow' | 'members' | 'layout';

const TAB_MESSAGE_KEYS: Record<TabId, 'settings.tabs.general' | 'settings.tabs.workflow' | 'settings.tabs.members' | 'settings.tabs.layout'> = {
  general: 'settings.tabs.general',
  workflow: 'settings.tabs.workflow',
  members: 'settings.tabs.members',
  layout: 'settings.tabs.layout',
};

const TABS: TabId[] = ['general', 'workflow', 'members', 'layout'];

interface SettingsPageProps {
  data: ProjectPageData;
  workflow: WorkflowViewData;
  members: ProjectMemberView[];
  candidates: MemberCandidate[];
  viewerId: string;
  tab: TabId;
}

export function ProjectSettingsPage({
  data,
  workflow,
  members,
  candidates,
  viewerId,
  tab,
}: SettingsPageProps) {
  const router = useRouter();
  const { t } = useI18n();
  const { toast, notify, dismiss } = useToastMessage();
  const refresh = () => router.refresh();
  const project = data.project;
  const tabLabel = (id: TabId) => t(TAB_MESSAGE_KEYS[id]);
  const activeTab = TABS.includes(tab) ? tab : 'general';

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label={t('project.breadcrumb')}>
        <Link href={`/p/${project.id}`} className={styles.breadcrumbLink}>
          {project.title}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{t('settings.projectSettings')}</span>
      </nav>

      <header>
        <h1 className={styles.title}>{tabLabel(activeTab)}</h1>
      </header>

      <nav className={styles.tabs} aria-label={t('settings.sectionsAria')}>
        {TABS.map((entry) => (
          <Link
            key={entry}
            href={`/p/${project.id}/settings?tab=${entry}`}
            className={styles.tab}
            data-active={entry === tab || undefined}
            aria-current={entry === tab ? 'page' : undefined}
          >
            {tabLabel(entry)}
          </Link>
        ))}
      </nav>

      {tab === 'general' ? (
        <GeneralTab data={data} notify={notify} refresh={refresh} />
      ) : null}
      {tab === 'workflow' ? (
        <WorkflowTab data={data} workflow={workflow} notify={notify} refresh={refresh} />
      ) : null}
      {tab === 'members' ? (
        <MembersTab
          data={data}
          members={members}
          candidates={candidates}
          viewerId={viewerId}
          notify={notify}
          refresh={refresh}
        />
      ) : null}
      {tab === 'layout' ? (
        <LayoutTab data={data} workflow={workflow} notify={notify} refresh={refresh} />
      ) : null}

      <Toast
        open={toast !== null}
        message={toast?.message ?? ''}
        tone={toast?.tone ?? 'success'}
        announcementKey={toast?.sequence}
        onClose={dismiss}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* General                                                                   */
/* ------------------------------------------------------------------------- */

function GeneralTab({
  data,
  notify,
  refresh,
}: {
  data: ProjectPageData;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  refresh: () => void;
}) {
  const project = data.project;
  const { t } = useI18n();
  const [title, setTitle] = useState(project.title);
  const [childPosition, setChildPosition] = useState(data.settings.child_position);
  const [defaultView, setDefaultView] = useState<CollectionView>(data.settings.default_view);
  const [inheritLayout, setInheritLayout] = useState(data.settings.inherit_layout);
  const [sendToInbox, setSendToInbox] = useState(!data.settings.skip_inbox);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Issue #56: read back the session markers so the saved field stays tinted.
  const titleChanged = useFieldChanged(project.id, 'title');
  const childPositionChanged = useFieldChanged(project.id, 'child_position');
  const defaultViewChanged = useFieldChanged(project.id, 'default_view');
  const inheritLayoutChanged = useFieldChanged(project.id, 'inherit_layout');
  const skipInboxChanged = useFieldChanged(project.id, 'skip_inbox');

  useEffect(() => {
    setTitle(project.title);
    setChildPosition(data.settings.child_position);
    setDefaultView(data.settings.default_view);
    setInheritLayout(data.settings.inherit_layout);
    setSendToInbox(!data.settings.skip_inbox);
  }, [project.title, data.settings]);

  const reset = () => {
    setTitle(project.title);
    setChildPosition(data.settings.child_position);
    setDefaultView(data.settings.default_view);
    setInheritLayout(data.settings.inherit_layout);
    setSendToInbox(!data.settings.skip_inbox);
    setError(null);
    setFieldErrors({});
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    let failed = false;
    const titleWillChange = project.canEdit && title.trim() !== project.title;
    const settingsChanges = {
      child_position: childPosition !== data.settings.child_position,
      default_view: defaultView !== data.settings.default_view,
      inherit_layout: inheritLayout !== data.settings.inherit_layout,
      skip_inbox: !sendToInbox !== data.settings.skip_inbox,
    };
    let titleSaved = false;
    if (titleWillChange) {
      const titleResult = await updateProjectFields(project.id, { title });
      if (!titleResult.ok) {
        failed = true;
        setError(titleResult.message);
        if (titleResult.fields) setFieldErrors(titleResult.fields);
      } else {
        titleSaved = true;
      }
    }
    const settingsResult = await saveProjectSettings(project.id, {
      child_position: childPosition,
      default_view: defaultView,
      inherit_layout: inheritLayout,
      skip_inbox: !sendToInbox,
    });
    if (!settingsResult.ok) {
      failed = true;
      setError(settingsResult.message);
      if (settingsResult.fields) setFieldErrors(settingsResult.fields);
    } else {
      // Issue #56: mark only the values that actually changed, once the
      // server accepted them. The markers reset on a full page load.
      if (titleSaved) markFieldChanged(project.id, 'title');
      for (const [field, changed] of Object.entries(settingsChanges)) {
        if (changed) markFieldChanged(project.id, field);
      }
    }
    setSaving(false);
    if (!failed) {
      notify(t('settings.projectSaved'));
      refresh();
    }
  };

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>{t('settings.projectDefaults')}</h2>
      <p className={styles.cardHint}>{t('settings.projectDefaultsHint')}</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className={styles.fields}>
        <Field
          label={t('settings.title')}
          htmlFor="settings-title"
          required
          error={fieldErrors.title}
          changed={titleChanged}
        >
          <Input
            id="settings-title"
            value={title}
            maxLength={200}
            disabled={!project.canEdit}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t('settings.reporter')} htmlFor="settings-reporter">
          <Input id="settings-reporter" value={project.reporter.username} readOnly disabled />
        </Field>
        <FieldGroup
          legend={t('settings.childProjectsAppear')}
          changed={childPositionChanged}
          controlClassName={styles.radios}
        >
            <Radio
              name="child-position"
              value="below"
              label={t('settings.belowDetails')}
              checked={childPosition === 'below'}
              onChange={() => setChildPosition('below')}
            />
          <Radio
            name="child-position"
            value="above"
            label={t('settings.aboveDetails')}
            checked={childPosition === 'above'}
            onChange={() => setChildPosition('above')}
          />
        </FieldGroup>
        <Field
          label={t('settings.defaultView')}
          htmlFor="settings-default-view"
          error={fieldErrors.default_view}
          changed={defaultViewChanged}
        >
          <Select
            id="settings-default-view"
            value={defaultView}
            onChange={(event) => setDefaultView(event.target.value as CollectionView)}
          >
            {data.settings.enabled_views.map((view) => (
              <option key={view} value={view}>
                {t(COLLECTION_VIEW_MESSAGE_KEYS[view])}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('settings.layout')}
          htmlFor="settings-inherit-layout"
          changed={inheritLayoutChanged}
        >
          <Checkbox
            id="settings-inherit-layout"
            label={t('settings.inheritLayout')}
            checked={inheritLayout}
            onChange={(event) => setInheritLayout(event.target.checked)}
          />
        </Field>
        <Field
          label={t('settings.newChildren')}
          htmlFor="settings-send-inbox"
          changed={skipInboxChanged}
        >
          <Checkbox
            id="settings-send-inbox"
            label={t('settings.sendToInbox')}
            description={t('settings.sendToInboxDescription')}
            checked={sendToInbox}
            onChange={(event) => setSendToInbox(event.target.checked)}
          />
        </Field>
      </div>
      <div className={styles.footer}>
        <Button onClick={() => void save()} loading={saving} disabled={saving}>
          {t('common.saveChanges')}
        </Button>
        <Button variant="quiet" onClick={reset} disabled={saving}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Workflow                                                                  */
/* ------------------------------------------------------------------------- */

interface WorkflowRow {
  key: string;
  id: string | null;
  name: string;
  isStart: boolean;
  isFinish: boolean;
}

function workflowRows(workflow: WorkflowViewData): WorkflowRow[] {
  return workflow.statuses.map((status) => ({
    key: status.id,
    id: status.id,
    name: status.name,
    isStart: status.isStart,
    isFinish: status.isFinish,
  }));
}

export function WorkflowTab({
  data,
  workflow,
  notify,
  refresh,
}: {
  data: ProjectPageData;
  workflow: WorkflowViewData;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  refresh: () => void;
}) {
  const { t, plural } = useI18n();
  const [rows, setRows] = useState<WorkflowRow[]>(() => workflowRows(workflow));
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workflowChanged = useFieldChanged(data.project.id, 'workflow');

  useEffect(() => {
    setRows(workflowRows(workflow));
    setMapping({});
    setShowMapping(false);
    setMappingError(null);
    setError(null);
  }, [workflow]);

  const updateRow = (key: string, patch: Partial<WorkflowRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => {
    setRows((current) => {
      const key = `new-${Date.now()}-${current.length}`;
      return [...current, { key, id: null, name: '', isStart: false, isFinish: false }];
    });
  };

  const removeRow = (key: string) => {
    setRows((current) => {
      const row = current.find((entry) => entry.key === key);
      if (!row || current.length <= 1 || row.isStart || row.isFinish) return current;
      return current.filter((entry) => entry.key !== key);
    });
  };

  const moveRow = (key: string, direction: -1 | 1) => {
    setRows((current) => {
      const index = current.findIndex((row) => row.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (row) next.splice(target, 0, row);
      return next;
    });
  };

  const removed = workflow.statuses.filter(
    (status) => !rows.some((row) => row.id === status.id),
  );
  const removedLive = removed.filter((status) => (workflow.usage[status.id]?.live ?? 0) > 0);
  const removedTrashed = removed.filter((status) => (workflow.usage[status.id]?.trashed ?? 0) > 0);
  const keptRows = rows.filter((row) => row.id !== null);

  const validate = (): string | null => {
    if (rows.length === 0) return t('settings.needOneStatus');
    if (rows.some((row) => !row.name.trim())) return t('settings.nameEveryStatus');
    const names = new Set<string>();
    for (const row of rows) {
      const normalized = row.name.trim().toLowerCase();
      if (names.has(normalized)) return t('settings.uniqueStatusNames');
      names.add(normalized);
    }
    if (rows.filter((row) => row.isStart).length !== 1) return t('settings.oneStart');
    if (rows.filter((row) => row.isFinish).length !== 1) return t('settings.oneFinish');
    return null;
  };

  const submitSave = async () => {
    setError(null);
    setMappingError(null);
    setSaving(true);
    const statuses = rows.map((row) => ({
      id: row.id,
      name: row.name.trim(),
      isStart: row.isStart,
      isFinish: row.isFinish,
    }));
    const result = await saveWorkflow(data.project.id, { statuses, mapping });
    setSaving(false);
    if (!result.ok) {
      if (result.code === 'mapping_required') {
        // The server needs explicit destinations: reopen the mapping modal.
        setMappingError(result.message);
        setShowMapping(true);
        return;
      }
      setShowMapping(false);
      setMappingError(null);
      setError(result.message);
      return;
    }
    setShowMapping(false);
    setMappingError(null);
    markFieldChanged(data.project.id, 'workflow');
    notify(
      result.data.remappedChildren > 0
        ? plural('plurals.workflowSavedRemapped', result.data.remappedChildren)
        : t('settings.workflowSaved'),
    );
    refresh();
  };

  const missingMapping = () => {
    const keptIds = new Set(keptRows.map((row) => row.id));
    return removedLive.filter((status) => {
      const target = mapping[status.id];
      return !target || !keptIds.has(target);
    });
  };

  const save = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (removedLive.length > 0) {
      // Always show the mapping before saving, even when a previous attempt
      // retained choices. Cancelling the dialog must not turn the next Save
      // into a silent submission with an invisible mapping.
      setError(null);
      const missing = missingMapping();
      setMappingError(
        missing.length > 0
          ? `Choose where existing children of these statuses go: ${missing.map((status) => status.name).join(', ')}.`
          : null,
      );
      setShowMapping(true);
      return;
    }
    await submitSave();
  };

  const confirmMapping = () => {
    const missing = missingMapping();
    if (missing.length > 0) {
      setMappingError(
        t('settings.chooseWhere', {
          names: missing.map((status) => status.name).join(', '),
        }),
      );
      return;
    }
    void submitSave();
  };

  const closeMapping = () => {
    if (saving) return;
    setShowMapping(false);
    setMappingError(null);
  };

  const reset = () => {
    setRows(workflowRows(workflow));
    setMapping({});
    setShowMapping(false);
    setMappingError(null);
    setError(null);
  };

  return (
    <Card className={styles.card} data-changed={workflowChanged || undefined}>
      <h2 className={styles.cardTitle}>{t('settings.workflowTitle')}</h2>
      <p className={styles.cardHint}>{t('settings.workflowHint')}</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ul className={styles.workflowList}>
        {rows.map((row, index) => {
          const usage = row.id ? workflow.usage[row.id] : undefined;
          const removeLabel = row.name.trim() || t('common.thisStatus');
          const removeBlockReason =
            row.isStart && row.isFinish
              ? t('settings.removeBoth', { name: removeLabel })
              : row.isStart
                ? t('settings.removeStart', { name: removeLabel })
                : row.isFinish
                  ? t('settings.removeFinish', { name: removeLabel })
                  : rows.length <= 1
                    ? t('settings.removeLast', { name: removeLabel })
                    : null;
          return (
            <li key={row.key} className={styles.workflowRow}>
              <div className={styles.workflowName}>
                <Input
                  aria-label={t('settings.statusNameN', { n: index + 1 })}
                  value={row.name}
                  maxLength={60}
                  onChange={(event) => updateRow(row.key, { name: event.target.value })}
                />
                {usage && usage.live + usage.trashed > 0 ? (
                  <span className={styles.usage}>
                    {plural('plurals.childUsage', usage.live)}
                    {usage.trashed > 0
                      ? t('settings.inTrashCount', { count: usage.trashed })
                      : ''}
                  </span>
                ) : null}
              </div>
              <div className={styles.workflowFlags}>
                <Radio
                  name={`start-${row.key}`}
                  value="start"
                  label={t('settings.start')}
                  aria-label={t('settings.setStart', {
                    name: row.name || t('common.thisStatus'),
                  })}
                  checked={row.isStart}
                  onChange={() =>
                    setRows((current) =>
                      current.map((entry) => ({ ...entry, isStart: entry.key === row.key })),
                    )
                  }
                />
                <Radio
                  name={`finish-${row.key}`}
                  value="finish"
                  label={t('settings.finish')}
                  aria-label={t('settings.setFinish', {
                    name: row.name || t('common.thisStatus'),
                  })}
                  checked={row.isFinish}
                  onChange={() =>
                    setRows((current) =>
                      current.map((entry) => ({ ...entry, isFinish: entry.key === row.key })),
                    )
                  }
                />
              </div>
              <div className={styles.workflowActions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('common.moveNameUp', {
                    name: row.name || t('common.status'),
                  })}
                  disabled={index === 0}
                  onClick={() => moveRow(row.key, -1)}
                >
                  <Icon name="arrow_upward" size={18} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('common.moveNameDown', {
                    name: row.name || t('common.status'),
                  })}
                  disabled={index === rows.length - 1}
                  onClick={() => moveRow(row.key, 1)}
                >
                  <Icon name="arrow_downward" size={18} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={
                    removeBlockReason ??
                    t('common.removeName', { name: row.name || t('common.status') })
                  }
                  title={removeBlockReason ?? undefined}
                  disabled={removeBlockReason !== null}
                  onClick={() => removeRow(row.key)}
                >
                  <Icon name="delete" size={18} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        icon={<Icon name="add" size={18} />}
        onClick={addRow}
        className={styles.addStatus}
      >
        {t('settings.addStatus')}
      </Button>

      <Dialog
        open={showMapping}
        onClose={closeMapping}
        title={t('settings.mapRemovedTitle')}
        description={t('settings.mapRemovedDescription')}
        dismissible={!saving}
        footer={
          <div className={styles.footer}>
            <Button
              onClick={confirmMapping}
              loading={saving}
              disabled={saving || removedLive.length === 0}
            >
              {t('settings.confirmMapping')}
            </Button>
            <Button variant="quiet" onClick={closeMapping} disabled={saving}>
              {t('common.cancel')}
            </Button>
          </div>
        }
      >
        <div className={styles.mappingBlock}>
          {mappingError ? <Notice tone="error">{mappingError}</Notice> : null}
          {removedLive.length === 0 ? (
            <Notice tone="warning">{t('settings.noRemovedFound')}</Notice>
          ) : (
            <div className={styles.mappingRows}>
              {removedLive.map((status) => (
                <div key={status.id} className={styles.mappingRow}>
                  <span>
                    {status.name}{' '}
                    {plural('plurals.childUsage', workflow.usage[status.id]?.live ?? 0)}
                  </span>
                  <Select
                    aria-label={t('settings.destinationStatusFor', { name: status.name })}
                    value={mapping[status.id] ?? ''}
                    onChange={(event) => {
                      setMapping((current) => ({ ...current, [status.id]: event.target.value }));
                      setMappingError(null);
                    }}
                  >
                    <option value="">{t('common.chooseStatus')}</option>
                    {keptRows.map((row) => (
                      <option key={row.key} value={row.id ?? ''}>
                        {row.name || t('settings.untitledStatus')}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          )}
          {removedTrashed.length > 0 ? (
            <p className={styles.cardHint}>
              {plural('plurals.removedTrashedOnly', removedTrashed.length)}
            </p>
          ) : null}
        </div>
      </Dialog>

      <p className={styles.cardHint}>
        {t('settings.removedInUseHint')}
      </p>
      <div className={styles.footer}>
        <Button onClick={() => void save()} loading={saving} disabled={saving}>
          {t('settings.saveWorkflow')}
        </Button>
        <Button variant="quiet" onClick={reset} disabled={saving}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Members                                                                   */
/* ------------------------------------------------------------------------- */

function MembersTab({
  data,
  members,
  candidates,
  viewerId,
  notify,
  refresh,
}: {
  data: ProjectPageData;
  members: ProjectMemberView[];
  candidates: MemberCandidate[];
  viewerId: string;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  refresh: () => void;
}) {
  const { t, plural } = useI18n();
  const project = data.project;
  const parentName = project.parent
    ? formatPersonName(project.parent.title)
    : t('settings.parentFallback');
  const [roles, setRoles] = useState<Record<string, ProjectRole | null>>(() => {
    const next: Record<string, ProjectRole | null> = {};
    for (const candidate of candidates) next[candidate.id] = candidate.explicitRole;
    return next;
  });
  const [access, setAccess] = useState<ProjectAccessMode>(data.settings.access);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [privateConfirm, setPrivateConfirm] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<ProjectRole>('user');
  const accessFieldChanged = useFieldChanged(project.id, 'access');

  useEffect(() => {
    const next: Record<string, ProjectRole | null> = {};
    for (const candidate of candidates) next[candidate.id] = candidate.explicitRole;
    setRoles(next);
    setAccess(data.settings.access);
    setAddUserId('');
  }, [candidates, data.settings.access]);

  const changes = candidates
    .filter((candidate) => (roles[candidate.id] ?? null) !== candidate.explicitRole)
    .map((candidate) => ({ userId: candidate.id, role: roles[candidate.id] ?? null }));
  const accessChanged = access !== data.settings.access;
  const reductions = candidates.filter(
    (candidate) =>
      (roles[candidate.id] ?? null) !== candidate.explicitRole &&
      rank(roles[candidate.id]) < Math.max(rank(candidate.explicitRole), rank(candidate.inheritedRole)),
  );
  const cascadeCandidates = reductions.length > 0;

  // F03: a custom project lists only its selected (explicit) members; an
  // inherited project lists everyone with inherited context.
  const visibleCandidates =
    access === 'custom'
      ? candidates.filter(
          (candidate) => (roles[candidate.id] ?? null) !== null || candidate.explicitRole !== null,
        )
      : candidates;
  const addableCandidates = candidates.filter(
    (candidate) => (roles[candidate.id] ?? null) === null && candidate.explicitRole === null,
  );
  const isPrivate = access === 'custom' && members.length <= 1;

  const submit = async (acknowledged: boolean) => {
    if (changes.length === 0 && !accessChanged) {
      setError(t('settings.changeAtLeastOne'));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveMembers(project.id, { changes, acknowledged, access });
    setSaving(false);
    if (!result.ok) {
      if (result.code === 'acknowledgement_required') {
        setConfirmMessage(result.message);
        return;
      }
      setError(result.message);
      return;
    }
    setConfirmMessage(null);
    if (accessChanged) markFieldChanged(project.id, 'access');
    notify(t('settings.permissionsUpdated'));
    refresh();
  };

  const onSelect = (candidate: MemberCandidate) => (value: string) => {
    const role: ProjectRole | null =
      value === 'admin' || value === 'user' || value === 'viewer' ? value : null;
    setRoles((current) => ({ ...current, [candidate.id]: role }));
  };

  const addMember = () => {
    if (!addUserId) return;
    setRoles((current) => ({ ...current, [addUserId]: addRole }));
    setAddUserId('');
    setAddRole('user');
  };

  const reset = () => {
    const next: Record<string, ProjectRole | null> = {};
    for (const candidate of candidates) next[candidate.id] = candidate.explicitRole;
    setRoles(next);
    setAccess(data.settings.access);
    setAddUserId('');
    setError(null);
  };

  const makePrivate = async () => {
    const privateChanges = candidates.map((candidate) => ({
      userId: candidate.id,
      role: (candidate.id === viewerId ? 'admin' : null) as ProjectRole | null,
    }));
    setSaving(true);
    setError(null);
    const result = await saveMembers(project.id, {
      changes: privateChanges,
      access: 'custom',
      acknowledged: true,
    });
    setSaving(false);
    setPrivateConfirm(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    notify(t('settings.nowPrivate'));
    markFieldChanged(project.id, 'access');
    refresh();
  };

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>{t('settings.projectMembers')}</h2>
      <p className={styles.cardHint}>
        {t('settings.membersHint')}
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className={styles.accessBlock}>
        <FieldGroup legend={t('settings.access')} changed={accessFieldChanged}>
          {project.isRoot ? (
            <p className={styles.cardHint}>
              {t('settings.rootAccessBefore')}
              <strong>{t('settings.rootAccessCustom')}</strong>
              {t('settings.rootAccessAfter')}
            </p>
          ) : (
            <div className={styles.radios}>
              <Radio
                name="access-mode"
                value="inherit"
                label={t('settings.inheritPermissions')}
                description={t('settings.inheritPermissionsDescription')}
                checked={access === 'inherit'}
                onChange={() => setAccess('inherit')}
              />
              <Radio
                name="access-mode"
                value="custom"
                label={t('settings.customAccess')}
                description={t('settings.customAccessDescription')}
                checked={access === 'custom'}
                onChange={() => setAccess('custom')}
              />
            </div>
          )}
        </FieldGroup>
        {!project.isRoot && access === 'custom' ? (
          <p className={styles.privateState}>
            <Icon name="lock" size={18} />
            <span>{t('settings.privateState')}</span>
          </p>
        ) : null}
        {!project.isRoot && !isPrivate ? (
          <div className={styles.accessActions}>
            <Button
              variant="quiet"
              size="sm"
              icon={<Icon name="lock" size={18} />}
              onClick={() => setPrivateConfirm(true)}
              disabled={saving}
            >
              {t('settings.makePrivate')}
            </Button>
            <span className={styles.cardHint}>
              {t('settings.makePrivateHint')}
            </span>
          </div>
        ) : null}
      </div>

      <ul className={styles.memberList} aria-label={t('settings.membersAria')}>
        {visibleCandidates.map((candidate) => {
          const selected = roles[candidate.id] ?? null;
          const explicit = candidate.explicitRole;
          const inherited = candidate.inheritedRole;
          const meta =
            selected !== null
              ? t('settings.explicitGrant', {
                  role: t(SHORT_ROLE_MESSAGE_KEYS[selected]),
                })
              : access === 'inherit' && inherited
                ? t('settings.inheritedFrom', {
                    parent: parentName,
                    role: t(SHORT_ROLE_MESSAGE_KEYS[inherited]),
                  })
                : project.isRoot && candidate.appRole === 'admin'
                  ? t('settings.appAdminImplicit')
                  : t('common.noAccess');
          return (
            <li key={candidate.id} className={styles.memberRow}>
              <div className={styles.memberIdentity}>
                <span className={styles.memberName}>{formatPersonName(candidate.username)}</span>
                <span className={styles.memberMeta}>{meta}</span>
              </div>
              <Select
                className={styles.memberSelect}
                aria-label={t('users.roleFor', {
                  name: formatPersonName(candidate.username),
                })}
                value={selected ?? ''}
                onChange={(event) => onSelect(candidate)(event.target.value)}
              >
                <option value="">
                  {explicit !== null
                    ? t('common.noAccess')
                    : access === 'inherit' && inherited
                      ? t('settings.inheritedRole', {
                          role: t(SHORT_ROLE_MESSAGE_KEYS[inherited]),
                        })
                      : t('common.noAccess')}
                </option>
                {(['viewer', 'user', 'admin'] as ProjectRole[]).map((role) => (
                  <option key={role} value={role}>
                    {t(SHORT_ROLE_MESSAGE_KEYS[role])}
                  </option>
                ))}
              </Select>
            </li>
          );
        })}
        {visibleCandidates.length === 0 ? (
          <li className={styles.cardHint}>{t('settings.noExplicitMembers')}</li>
        ) : null}
      </ul>

      <div className={styles.addMemberRow}>
          <span className={styles.addMemberLabel} id="members-add-label">
            {t('settings.addMember')}
          </span>
          <div className={styles.addMemberControls} role="group" aria-labelledby="members-add-label">
            <Select
              aria-label={t('settings.accountToAdd')}
              value={addUserId}
              disabled={addableCandidates.length === 0}
              onChange={(event) => setAddUserId(event.target.value)}
            >
              <option value="">
                {addableCandidates.length === 0
                  ? t('settings.everyoneHasGrant')
                  : t('common.chooseAccount')}
              </option>
              {addableCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {formatPersonName(candidate.username)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('settings.roleForNewMember')}
              value={addRole}
              onChange={(event) => setAddRole(event.target.value as ProjectRole)}
            >
              {(['viewer', 'user', 'admin'] as ProjectRole[]).map((role) => (
                <option key={role} value={role}>
                  {t(SHORT_ROLE_MESSAGE_KEYS[role])}
                </option>
              ))}
            </Select>
            <Button
              variant="quiet"
              size="sm"
              onClick={addMember}
              disabled={!addUserId || saving || addableCandidates.length === 0}
            >
              {t('settings.addMember')}
            </Button>
          </div>
        </div>

      <div className={styles.footer}>
        <Button onClick={() => void submit(false)} loading={saving} disabled={saving}>
          {t('settings.savePermissions')}
        </Button>
        <Button variant="quiet" onClick={reset} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <span className={styles.cardHint}>
          {plural('plurals.explicitGrants', members.length)}
          {cascadeCandidates ? t('settings.reductionsCascade') : ''}
        </span>
      </div>

      <Dialog
        open={confirmMessage !== null}
        onClose={() => setConfirmMessage(null)}
        title={t('settings.restrictTitle')}
        dismissible={!saving}
        footer={
          <div className={styles.footer}>
            <Button variant="danger" onClick={() => void submit(true)} loading={saving}>
              {t('settings.confirmAndSave')}
            </Button>
            <Button variant="quiet" onClick={() => setConfirmMessage(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
          </div>
        }
      >
        <p className={styles.cardHint}>{confirmMessage}</p>
        <p className={styles.cardHint}>
          {t('settings.restrictHint')}
        </p>
      </Dialog>

      <Dialog
        open={privateConfirm}
        onClose={() => setPrivateConfirm(false)}
        title={t('settings.makePrivateTitle')}
        dismissible={!saving}
        footer={
          <div className={styles.footer}>
            <Button variant="danger" loading={saving} onClick={() => void makePrivate()}>
              {t('settings.makePrivate')}
            </Button>
            <Button variant="quiet" onClick={() => setPrivateConfirm(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
          </div>
        }
      >
        <p className={styles.cardHint}>
          {t('settings.makePrivateBody')}
        </p>
      </Dialog>
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Layout                                                                    */
/* ------------------------------------------------------------------------- */

function ViewFieldListEditor({
  label,
  fields,
  onChange,
}: {
  label: string;
  fields: ViewFieldKey[];
  onChange: (next: ViewFieldKey[]) => void;
}) {
  const { t } = useI18n();
  const available = VIEW_FIELD_KEYS.filter((key) => !fields.includes(key));
  return (
    <div className={styles.fieldListEditor}>
      <h4 className={styles.subheading}>{label}</h4>
      {fields.length === 0 ? (
        <p className={styles.cardHint}>{t('common.titleOnly')}</p>
      ) : null}
      <ul className={styles.fieldList}>
        {fields.map((field, index) => (
          <li key={field} className={styles.fieldListRow}>
            <span>{t(VIEW_FIELD_MESSAGE_KEYS[field])}</span>
            <span className={styles.fieldListActions}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('common.moveNameUpIn', {
                  name: t(VIEW_FIELD_MESSAGE_KEYS[field]),
                  context: label,
                })}
                disabled={index === 0}
                onClick={() => {
                  const next = [...fields];
                  const previous = next[index - 1];
                  if (!previous) return;
                  next[index - 1] = field;
                  next[index] = previous;
                  onChange(next);
                }}
              >
                <Icon name="arrow_upward" size={16} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('common.moveNameDownIn', {
                  name: t(VIEW_FIELD_MESSAGE_KEYS[field]),
                  context: label,
                })}
                disabled={index === fields.length - 1}
                onClick={() => {
                  const next = [...fields];
                  const following = next[index + 1];
                  if (!following) return;
                  next[index + 1] = field;
                  next[index] = following;
                  onChange(next);
                }}
              >
                <Icon name="arrow_downward" size={16} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('common.hideNameIn', {
                  name: t(VIEW_FIELD_MESSAGE_KEYS[field]),
                  context: label,
                })}
                onClick={() => onChange(fields.filter((entry) => entry !== field))}
              >
                <Icon name="close" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {available.length > 0 ? (
        <Select
          className={styles.addFieldSelect}
          aria-label={t('settings.addPropertyTo', { context: label })}
          value=""
          onChange={(event) => {
            const value = event.target.value as ViewFieldKey;
            if (value) onChange([...fields, value]);
          }}
        >
          <option value="">{t('settings.addProperty')}</option>
          {available.map((field) => (
            <option key={field} value={field}>
              {t(VIEW_FIELD_MESSAGE_KEYS[field])}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}

function FieldListEditor({
  label,
  fields,
  onChange,
}: {
  label: string;
  fields: ProjectFieldKey[];
  onChange: (next: ProjectFieldKey[]) => void;
}) {
  const { t } = useI18n();
  const available = PROJECT_FIELD_KEYS.filter((key) => !fields.includes(key));
  return (
    <div className={styles.fieldListEditor}>
      <h3 className={styles.subheading}>{label}</h3>
      {fields.length === 0 ? (
        <p className={styles.cardHint}>{t('common.noFieldsSelected')}</p>
      ) : null}
      <ul className={styles.fieldList}>
        {fields.map((field, index) => (
          <li key={field} className={styles.fieldListRow}>
            <span>{t(PROJECT_FIELD_MESSAGE_KEYS[field])}</span>
            <span className={styles.fieldListActions}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('common.moveNameUpIn', {
                  name: t(PROJECT_FIELD_MESSAGE_KEYS[field]),
                  context: label,
                })}
                disabled={index === 0}
                onClick={() => {
                  const next = [...fields];
                  const previous = next[index - 1];
                  if (!previous) return;
                  next[index - 1] = field;
                  next[index] = previous;
                  onChange(next);
                }}
              >
                <Icon name="arrow_upward" size={16} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('common.moveNameDownIn', {
                  name: t(PROJECT_FIELD_MESSAGE_KEYS[field]),
                  context: label,
                })}
                disabled={index === fields.length - 1}
                onClick={() => {
                  const next = [...fields];
                  const following = next[index + 1];
                  if (!following) return;
                  next[index + 1] = field;
                  next[index] = following;
                  onChange(next);
                }}
              >
                <Icon name="arrow_downward" size={16} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('common.removeNameFrom', {
                  name: t(PROJECT_FIELD_MESSAGE_KEYS[field]),
                  context: label,
                })}
                onClick={() => onChange(fields.filter((entry) => entry !== field))}
              >
                <Icon name="close" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {available.length > 0 ? (
        <Select
          className={styles.addFieldSelect}
          aria-label={t('settings.addFieldTo', { context: label })}
          value=""
          onChange={(event) => {
            const value = event.target.value as ProjectFieldKey;
            if (value) onChange([...fields, value]);
          }}
        >
          <option value="">{t('settings.addField')}</option>
          {available.map((field) => (
            <option key={field} value={field}>
              {t(PROJECT_FIELD_MESSAGE_KEYS[field])}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}

function LayoutTab({
  data,
  workflow,
  notify,
  refresh,
}: {
  data: ProjectPageData;
  workflow: WorkflowViewData;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  refresh: () => void;
}) {
  const { t } = useI18n();
  const project = data.project;
  const [inheritLayout, setInheritLayout] = useState(data.settings.inherit_layout);
  const [main, setMain] = useState<ProjectFieldKey[]>(data.layout.main);
  const [sidebar, setSidebar] = useState<ProjectFieldKey[]>(data.layout.sidebar);
  const [asTemplate, setAsTemplate] = useState(data.settings.layout_template !== null);
  const [defaultView, setDefaultView] = useState<CollectionView>(data.settings.default_view);
  const [enabledViews, setEnabledViews] = useState<CollectionView[]>(data.settings.enabled_views);
  const [hiddenStatuses, setHiddenStatuses] = useState<string[]>(data.settings.hidden_statuses);
  const [viewFields, setViewFields] = useState<ViewFields>(() => ({
    ...DEFAULT_VIEW_FIELDS,
    ...data.settings.view_fields,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInheritLayout(data.settings.inherit_layout);
    setMain(data.layout.main);
    setSidebar(data.layout.sidebar);
    setAsTemplate(data.settings.layout_template !== null);
    setDefaultView(data.settings.default_view);
    setEnabledViews(data.settings.enabled_views);
    setHiddenStatuses(data.settings.hidden_statuses);
    setViewFields({ ...DEFAULT_VIEW_FIELDS, ...data.settings.view_fields });
  }, [data.settings, data.layout]);

  const toggleView = (view: CollectionView) => {
    if (enabledViews.includes(view)) {
      if (enabledViews.length <= 1) {
        setError(t('settings.keepOneView'));
        return;
      }
      const next = enabledViews.filter((entry) => entry !== view);
      setEnabledViews(next);
      if (!next.includes(defaultView)) setDefaultView(next[0] ?? 'kanban');
    } else {
      setEnabledViews([...enabledViews, view]);
    }
    setError(null);
  };

  const save = async () => {
    if (asTemplate && main.length === 0 && sidebar.length === 0) {
      setError(t('settings.chooseOneField'));
      return;
    }
    setError(null);
    setSaving(true);
    const result = await saveProjectSettings(project.id, {
      inherit_layout: inheritLayout,
      default_view: defaultView,
      enabled_views: enabledViews,
      hidden_statuses: hiddenStatuses,
      view_fields: viewFields,
      layout_template: asTemplate ? { main, sidebar } : null,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    notify(t('settings.layoutSaved'));
    refresh();
  };

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>{t('settings.layoutTitle')}</h2>
      <p className={styles.cardHint}>
        {t('settings.layoutHint')}
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className={styles.fields}>
        <Field label={t('settings.inheritance')} htmlFor="layout-inherit">
          <Checkbox
            id="layout-inherit"
            label={t('settings.inheritLayout')}
            checked={inheritLayout}
            onChange={(event) => setInheritLayout(event.target.checked)}
          />
        </Field>
        <Field label={t('settings.useAsTemplate')} htmlFor="layout-template">
          <Checkbox
            id="layout-template"
            label={t('settings.useAsTemplateLabel')}
            checked={asTemplate}
            onChange={(event) => setAsTemplate(event.target.checked)}
          />
        </Field>
      </div>

      <div className={styles.layoutColumns}>
        <FieldListEditor
          label={t('settings.mainArea')}
          fields={main}
          onChange={setMain}
        />
        <FieldListEditor
          label={t('settings.propertiesSidebar')}
          fields={sidebar}
          onChange={setSidebar}
        />
      </div>

      <div className={styles.viewFieldsBlock}>
        <h3 className={styles.subheading}>{t('settings.viewProperties')}</h3>
        <p className={styles.cardHint}>
          {t('settings.viewPropertiesHint')}
        </p>
        <div className={styles.viewFieldGroups}>
          {COLLECTION_VIEWS.map((view) => (
            <ViewFieldListEditor
              key={view}
              label={t(COLLECTION_VIEW_MESSAGE_KEYS[view])}
              fields={viewFields[view] ?? []}
              onChange={(next) => setViewFields((current) => ({ ...current, [view]: next }))}
            />
          ))}
        </div>
      </div>

      <div className={styles.fields}>
        <Field label={t('settings.defaultView')} htmlFor="layout-default-view">
          <Select
            id="layout-default-view"
            value={defaultView}
            onChange={(event) => setDefaultView(event.target.value as CollectionView)}
          >
            {enabledViews.map((view) => (
              <option key={view} value={view}>
                {t(COLLECTION_VIEW_MESSAGE_KEYS[view])}
              </option>
            ))}
          </Select>
        </Field>
        <FieldGroup
          legend={t('settings.enabledViews')}
          controlClassName={styles.checkList}
        >
            {COLLECTION_VIEWS.map((view) => (
              <Checkbox
                key={view}
                label={t(COLLECTION_VIEW_MESSAGE_KEYS[view])}
                checked={enabledViews.includes(view)}
                onChange={() => toggleView(view)}
              />
            ))}
        </FieldGroup>
        <FieldGroup
          legend={t('settings.hiddenStatuses')}
          controlClassName={styles.checkList}
        >
            {workflow.statuses.length === 0 ? (
              <p className={styles.cardHint}>{t('settings.noStatuses')}</p>
            ) : (
              workflow.statuses.map((status) => (
                <Checkbox
                  key={status.id}
                  label={status.name}
                  checked={hiddenStatuses.includes(status.id)}
                  onChange={(event) =>
                    setHiddenStatuses((current) =>
                      event.target.checked
                        ? [...current, status.id]
                        : current.filter((entry) => entry !== status.id),
                    )
                  }
                />
              ))
            )}
        </FieldGroup>
      </div>

      <div className={styles.footer}>
        <Button onClick={() => void save()} loading={saving} disabled={saving}>
          {t('common.saveChanges')}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            setInheritLayout(data.settings.inherit_layout);
            setMain(data.layout.main);
            setSidebar(data.layout.sidebar);
            setAsTemplate(data.settings.layout_template !== null);
            setDefaultView(data.settings.default_view);
            setEnabledViews(data.settings.enabled_views);
            setHiddenStatuses(data.settings.hidden_statuses);
            setViewFields({ ...DEFAULT_VIEW_FIELDS, ...data.settings.view_fields });
            setError(null);
          }}
          disabled={saving}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}
