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
  Icon,
  Input,
  Notice,
  Radio,
  Select,
  Toast,
} from '@/components/ui';
import type { CollectionView, ProjectRole } from '@/lib/types';
import { COLLECTION_VIEWS, COLLECTION_VIEW_LABELS } from '@/lib/types';
import type {
  ProjectFieldKey,
  ProjectPageData,
  WorkflowViewData,
  ProjectMemberView,
} from './types';
import { PROJECT_FIELD_KEYS, PROJECT_FIELD_LABELS } from './types';
import type { MemberCandidate } from './api';
import type { ProjectAccessMode, ViewFieldKey, ViewFields } from '@/lib/projects';
import { DEFAULT_VIEW_FIELDS, VIEW_FIELD_KEYS, VIEW_FIELD_LABELS } from '@/lib/projects';
import { formatPersonName } from '@/lib/format';
import { saveMembers, saveProjectSettings, saveWorkflow, updateProjectFields } from './api';
import styles from './ProjectSettings.module.css';

const ROLE_LABELS: Record<ProjectRole, string> = {
  admin: 'Admin',
  user: 'User',
  viewer: 'Viewer',
};

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, user: 2, admin: 3 };

function rank(role: ProjectRole | null | undefined): number {
  return role ? ROLE_RANK[role] : 0;
}

type TabId = 'general' | 'workflow' | 'members' | 'layout';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'members', label: 'Members' },
  { id: 'layout', label: 'Layout' },
];

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
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'info' } | null>(
    null,
  );
  const notify = (message: string, tone: 'success' | 'error' | 'info' = 'success') =>
    setToast({ message, tone });
  const refresh = () => router.refresh();
  const project = data.project;
  const activeTab = TABS.find((entry) => entry.id === tab) ?? TABS[0]!;

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href={`/p/${project.id}`} className={styles.breadcrumbLink}>
          {project.title}
        </Link>
        <span aria-hidden="true">/</span>
        <span>Project settings</span>
      </nav>

      <header>
        <h1 className={styles.title}>{activeTab.label}</h1>
      </header>

      <nav className={styles.tabs} aria-label="Project settings sections">
        {TABS.map((entry) => (
          <Link
            key={entry.id}
            href={`/p/${project.id}/settings?tab=${entry.id}`}
            className={styles.tab}
            data-active={entry.id === tab || undefined}
            aria-current={entry.id === tab ? 'page' : undefined}
          >
            {entry.label}
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

      <Toast open={toast !== null} message={toast?.message ?? ''} tone={toast?.tone ?? 'success'} onClose={() => setToast(null)} />
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
  const [title, setTitle] = useState(project.title);
  const [childPosition, setChildPosition] = useState(data.settings.child_position);
  const [defaultView, setDefaultView] = useState<CollectionView>(data.settings.default_view);
  const [inheritLayout, setInheritLayout] = useState(data.settings.inherit_layout);
  const [sendToInbox, setSendToInbox] = useState(!data.settings.skip_inbox);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
    if (project.canEdit && title.trim() !== project.title) {
      const titleResult = await updateProjectFields(project.id, { title });
      if (!titleResult.ok) {
        failed = true;
        setError(titleResult.message);
        if (titleResult.fields) setFieldErrors(titleResult.fields);
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
    }
    setSaving(false);
    if (!failed) {
      notify('Project settings saved.');
      refresh();
    }
  };

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>General</h2>
      <p className={styles.cardHint}>Core project details and how children behave.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className={styles.fields}>
        <Field label="Title" htmlFor="settings-title" required error={fieldErrors.title}>
          <Input
            id="settings-title"
            value={title}
            maxLength={200}
            disabled={!project.canEdit}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Reporter" htmlFor="settings-reporter">
          <Input id="settings-reporter" value={project.reporter.username} readOnly disabled />
        </Field>
        <Field label="Child projects appear" htmlFor="settings-child-position">
          <div className={styles.radios} id="settings-child-position">
            <Radio
              name="child-position"
              value="below"
              label="Below the project details"
              checked={childPosition === 'below'}
              onChange={() => setChildPosition('below')}
            />
            <Radio
              name="child-position"
              value="above"
              label="Above the project details"
              checked={childPosition === 'above'}
              onChange={() => setChildPosition('above')}
            />
          </div>
        </Field>
        <Field label="Default view" htmlFor="settings-default-view" error={fieldErrors.default_view}>
          <Select
            id="settings-default-view"
            value={defaultView}
            onChange={(event) => setDefaultView(event.target.value as CollectionView)}
          >
            {data.settings.enabled_views.map((view) => (
              <option key={view} value={view}>
                {COLLECTION_VIEW_LABELS[view]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Layout" htmlFor="settings-inherit-layout">
          <Checkbox
            id="settings-inherit-layout"
            label="Inherit layout from the parent project"
            checked={inheritLayout}
            onChange={(event) => setInheritLayout(event.target.checked)}
          />
        </Field>
        <Field label="New children" htmlFor="settings-send-inbox">
          <Checkbox
            id="settings-send-inbox"
            label="Send new children to the Inbox"
            description="When off, captured children are created directly in their start status."
            checked={sendToInbox}
            onChange={(event) => setSendToInbox(event.target.checked)}
          />
        </Field>
      </div>
      <div className={styles.footer}>
        <Button onClick={() => void save()} loading={saving} disabled={saving}>
          Save changes
        </Button>
        <Button variant="quiet" onClick={reset} disabled={saving}>
          Cancel
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

function WorkflowTab({
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
  const [rows, setRows] = useState<WorkflowRow[]>(() => workflowRows(workflow));
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(workflowRows(workflow));
    setMapping({});
    setShowMapping(false);
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
    setRows((current) => (current.length <= 1 ? current : current.filter((row) => row.key !== key)));
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

  const validate = (): string | null => {
    if (rows.length === 0) return 'A workflow needs at least one status.';
    if (rows.some((row) => !row.name.trim())) return 'Give every status a name.';
    const names = new Set<string>();
    for (const row of rows) {
      const normalized = row.name.trim().toLowerCase();
      if (names.has(normalized)) return 'Status names must be unique.';
      names.add(normalized);
    }
    if (rows.filter((row) => row.isStart).length !== 1) return 'Choose exactly one Start status.';
    if (rows.filter((row) => row.isFinish).length !== 1) return 'Choose exactly one Finish status.';
    return null;
  };

  const save = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (removedLive.length > 0) {
      const missing = removedLive.filter((status) => !mapping[status.id]);
      if (missing.length > 0) {
        setShowMapping(true);
        setError(
          `Choose where existing children of these statuses go: ${missing.map((status) => status.name).join(', ')}.`,
        );
        return;
      }
    }
    setError(null);
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
      setError(result.message);
      if (result.code === 'mapping_required') setShowMapping(true);
      return;
    }
    notify(
      result.data.remappedChildren > 0
        ? `Workflow saved. ${result.data.remappedChildren} child project${result.data.remappedChildren === 1 ? '' : 's'} remapped.`
        : 'Workflow saved.',
    );
    refresh();
  };

  const reset = () => {
    setRows(workflowRows(workflow));
    setMapping({});
    setShowMapping(false);
    setError(null);
  };

  const keptRows = rows.filter((row) => row.id !== null);

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>Workflow for child projects</h2>
      <p className={styles.cardHint}>This workflow controls children, not this project&apos;s own status.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ul className={styles.workflowList}>
        {rows.map((row, index) => {
          const usage = row.id ? workflow.usage[row.id] : undefined;
          return (
            <li key={row.key} className={styles.workflowRow}>
              <div className={styles.workflowName}>
                <Input
                  aria-label={`Status name ${index + 1}`}
                  value={row.name}
                  maxLength={60}
                  onChange={(event) => updateRow(row.key, { name: event.target.value })}
                />
                {usage && usage.live + usage.trashed > 0 ? (
                  <span className={styles.usage}>
                    {usage.live} child{usage.live === 1 ? '' : 'ren'}
                    {usage.trashed > 0 ? ` · ${usage.trashed} in Trash` : ''}
                  </span>
                ) : null}
              </div>
              <div className={styles.workflowFlags}>
                <Radio
                  name={`start-${row.key}`}
                  value="start"
                  label="Start"
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
                  label="Finish"
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
                  aria-label={`Move ${row.name || 'status'} up`}
                  disabled={index === 0}
                  onClick={() => moveRow(row.key, -1)}
                >
                  <Icon name="arrow_upward" size={18} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Move ${row.name || 'status'} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => moveRow(row.key, 1)}
                >
                  <Icon name="arrow_downward" size={18} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Remove ${row.name || 'status'}`}
                  disabled={rows.length <= 1}
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
        Add status
      </Button>

      {showMapping || removedLive.length > 0 ? (
        <div className={styles.mappingBlock}>
          <Notice tone="warning" title="Map removed statuses explicitly">
            Children in a removed status must be mapped to a kept status before saving. Identical
            names are not matched automatically.
          </Notice>
          <div className={styles.mappingRows}>
            {removedLive.map((status) => (
              <div key={status.id} className={styles.mappingRow}>
                <span>
                  {status.name} ({workflow.usage[status.id]?.live ?? 0} children)
                </span>
                <Select
                  aria-label={`Destination status for ${status.name}`}
                  value={mapping[status.id] ?? ''}
                  onChange={(event) =>
                    setMapping((current) => ({ ...current, [status.id]: event.target.value }))
                  }
                >
                  <option value="">Choose a status</option>
                  {keptRows.map((row) => (
                    <option key={row.key} value={row.id ?? ''}>
                      {row.name || 'Untitled status'}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          {removedTrashed.length > 0 ? (
            <p className={styles.cardHint}>
              {removedTrashed.length} removed status
              {removedTrashed.length === 1 ? ' is' : 'es are'} only used by trashed projects; those
              will be mapped when the projects are restored.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className={styles.cardHint}>Removing an in-use status opens explicit mapping before saving.</p>
      <div className={styles.footer}>
        <Button onClick={() => void save()} loading={saving} disabled={saving}>
          Save workflow
        </Button>
        <Button variant="quiet" onClick={reset} disabled={saving}>
          Cancel
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
  const project = data.project;
  const parentName = project.parent ? formatPersonName(project.parent.title) : 'parent';
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
      setError('Change at least one role or the access mode before saving.');
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
    notify('Permissions updated.');
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
    notify('Project is now private.');
    refresh();
  };

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>Members</h2>
      <p className={styles.cardHint}>
        Explicit grants only. Reducing or removing a role here also restricts descendants after
        confirmation; increasing access never propagates automatically.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className={styles.accessBlock}>
        <Field label="Access" htmlFor="members-access-mode">
          {project.isRoot ? (
            <p className={styles.cardHint}>
              Root always uses <strong>Custom access</strong>: its explicit grants plus the implicit
              Admin for application Admins.
            </p>
          ) : (
            <div className={styles.radios} id="members-access-mode">
              <Radio
                name="access-mode"
                value="inherit"
                label="Inherit parent permissions"
                description="Accounts with access to the parent can open this project too."
                checked={access === 'inherit'}
                onChange={() => setAccess('inherit')}
              />
              <Radio
                name="access-mode"
                value="custom"
                label="Custom access"
                description="Only the selected members below can open this project, even application Admins."
                checked={access === 'custom'}
                onChange={() => setAccess('custom')}
              />
            </div>
          )}
        </Field>
        {!project.isRoot && access === 'custom' ? (
          <p className={styles.privateState}>
            <Icon name="lock" size={18} />
            <span>Private — only selected members</span>
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
              Make private
            </Button>
            <span className={styles.cardHint}>
              Keeps you as Admin and removes every other explicit grant.
            </span>
          </div>
        ) : null}
      </div>

      <ul className={styles.memberList} aria-label="Project members">
        {visibleCandidates.map((candidate) => {
          const selected = roles[candidate.id] ?? null;
          const explicit = candidate.explicitRole;
          const inherited = candidate.inheritedRole;
          const meta =
            selected !== null
              ? `Explicit grant · ${ROLE_LABELS[selected]}`
              : access === 'inherit' && inherited
                ? `Inherited from ${parentName} · ${ROLE_LABELS[inherited]}`
                : project.isRoot && candidate.appRole === 'admin'
                  ? 'Application Admin · implicit'
                  : 'No access';
          return (
            <li key={candidate.id} className={styles.memberRow}>
              <div className={styles.memberIdentity}>
                <span className={styles.memberName}>{formatPersonName(candidate.username)}</span>
                <span className={styles.memberMeta}>{meta}</span>
              </div>
              <Select
                className={styles.memberSelect}
                aria-label={`Project role for ${formatPersonName(candidate.username)}`}
                value={selected ?? ''}
                onChange={(event) => onSelect(candidate)(event.target.value)}
              >
                <option value="">
                  {explicit !== null
                    ? 'No access'
                    : access === 'inherit' && inherited
                      ? `Inherited (${ROLE_LABELS[inherited]})`
                      : 'No access'}
                </option>
                {(['viewer', 'user', 'admin'] as ProjectRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </li>
          );
        })}
        {visibleCandidates.length === 0 ? (
          <li className={styles.cardHint}>No explicit members yet.</li>
        ) : null}
      </ul>

      <div className={styles.addMemberRow}>
          <span className={styles.addMemberLabel} id="members-add-label">
            Add member
          </span>
          <div className={styles.addMemberControls} role="group" aria-labelledby="members-add-label">
            <Select
              aria-label="Account to add"
              value={addUserId}
              disabled={addableCandidates.length === 0}
              onChange={(event) => setAddUserId(event.target.value)}
            >
              <option value="">
                {addableCandidates.length === 0 ? 'Everyone already has a grant' : 'Choose an account'}
              </option>
              {addableCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {formatPersonName(candidate.username)}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Role for the new member"
              value={addRole}
              onChange={(event) => setAddRole(event.target.value as ProjectRole)}
            >
              {(['viewer', 'user', 'admin'] as ProjectRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
            <Button
              variant="quiet"
              size="sm"
              onClick={addMember}
              disabled={!addUserId || saving || addableCandidates.length === 0}
            >
              Add member
            </Button>
          </div>
        </div>

      <div className={styles.footer}>
        <Button onClick={() => void submit(false)} loading={saving} disabled={saving}>
          Save permissions
        </Button>
        <Button variant="quiet" onClick={reset} disabled={saving}>
          Cancel
        </Button>
        <span className={styles.cardHint}>
          {members.length} explicit grant{members.length === 1 ? '' : 's'}
          {cascadeCandidates ? ' · reductions cascade over descendants' : ''}
        </span>
      </div>

      <Dialog
        open={confirmMessage !== null}
        onClose={() => setConfirmMessage(null)}
        title="Restrict descendant access?"
        dismissible={!saving}
        footer={
          <div className={styles.footer}>
            <Button variant="danger" onClick={() => void submit(true)} loading={saving}>
              Confirm and save
            </Button>
            <Button variant="quiet" onClick={() => setConfirmMessage(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
        }
      >
        <p className={styles.cardHint}>{confirmMessage}</p>
        <p className={styles.cardHint}>
          Descendant grants held by the affected accounts are overridden by the new role. Increases
          do not propagate.
        </p>
      </Dialog>

      <Dialog
        open={privateConfirm}
        onClose={() => setPrivateConfirm(false)}
        title="Make this project private?"
        dismissible={!saving}
        footer={
          <div className={styles.footer}>
            <Button variant="danger" loading={saving} onClick={() => void makePrivate()}>
              Make private
            </Button>
            <Button variant="quiet" onClick={() => setPrivateConfirm(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        }
      >
        <p className={styles.cardHint}>
          Switching to Custom access removes every other account&apos;s explicit grant to this
          project. Descendant grants held by those accounts are restricted too. Only you and accounts
          you re-add will have access.
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
  const available = VIEW_FIELD_KEYS.filter((key) => !fields.includes(key));
  return (
    <div className={styles.fieldListEditor}>
      <h4 className={styles.subheading}>{label}</h4>
      {fields.length === 0 ? <p className={styles.cardHint}>Title only.</p> : null}
      <ul className={styles.fieldList}>
        {fields.map((field, index) => (
          <li key={field} className={styles.fieldListRow}>
            <span>{VIEW_FIELD_LABELS[field]}</span>
            <span className={styles.fieldListActions}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Move ${VIEW_FIELD_LABELS[field]} up in ${label}`}
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
                aria-label={`Move ${VIEW_FIELD_LABELS[field]} down in ${label}`}
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
                aria-label={`Hide ${VIEW_FIELD_LABELS[field]} in ${label}`}
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
          aria-label={`Add a property to ${label}`}
          value=""
          onChange={(event) => {
            const value = event.target.value as ViewFieldKey;
            if (value) onChange([...fields, value]);
          }}
        >
          <option value="">Add a property…</option>
          {available.map((field) => (
            <option key={field} value={field}>
              {VIEW_FIELD_LABELS[field]}
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
  const available = PROJECT_FIELD_KEYS.filter((key) => !fields.includes(key));
  return (
    <div className={styles.fieldListEditor}>
      <h3 className={styles.subheading}>{label}</h3>
      {fields.length === 0 ? <p className={styles.cardHint}>No fields selected.</p> : null}
      <ul className={styles.fieldList}>
        {fields.map((field, index) => (
          <li key={field} className={styles.fieldListRow}>
            <span>{PROJECT_FIELD_LABELS[field]}</span>
            <span className={styles.fieldListActions}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Move ${PROJECT_FIELD_LABELS[field]} up in ${label}`}
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
                aria-label={`Move ${PROJECT_FIELD_LABELS[field]} down in ${label}`}
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
                aria-label={`Remove ${PROJECT_FIELD_LABELS[field]} from ${label}`}
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
          aria-label={`Add a field to ${label}`}
          value=""
          onChange={(event) => {
            const value = event.target.value as ProjectFieldKey;
            if (value) onChange([...fields, value]);
          }}
        >
          <option value="">Add a field…</option>
          {available.map((field) => (
            <option key={field} value={field}>
              {PROJECT_FIELD_LABELS[field]}
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
        setError('Keep at least one collection view enabled.');
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
      setError('Choose at least one field for the layout template.');
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
    notify('Layout settings saved.');
    refresh();
  };

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>Layout</h2>
      <p className={styles.cardHint}>
        Choose where project fields appear, which views are available and which statuses are hidden.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className={styles.fields}>
        <Field label="Inheritance" htmlFor="layout-inherit">
          <Checkbox
            id="layout-inherit"
            label="Inherit layout from the parent project"
            checked={inheritLayout}
            onChange={(event) => setInheritLayout(event.target.checked)}
          />
        </Field>
        <Field label="Use as child template" htmlFor="layout-template">
          <Checkbox
            id="layout-template"
            label="Use this layout as the template for child projects"
            checked={asTemplate}
            onChange={(event) => setAsTemplate(event.target.checked)}
          />
        </Field>
      </div>

      <div className={styles.layoutColumns}>
        <FieldListEditor label="Main area" fields={main} onChange={setMain} />
        <FieldListEditor label="Properties sidebar" fields={sidebar} onChange={setSidebar} />
      </div>

      <div className={styles.viewFieldsBlock}>
        <h3 className={styles.subheading}>View properties</h3>
        <p className={styles.cardHint}>
          Compact properties shown on cards and rows for each collection view. Only core fields are
          configurable in this iteration; add-on field slots are deferred with the add-on registry.
        </p>
        <div className={styles.viewFieldGroups}>
          {COLLECTION_VIEWS.map((view) => (
            <ViewFieldListEditor
              key={view}
              label={COLLECTION_VIEW_LABELS[view]}
              fields={viewFields[view] ?? []}
              onChange={(next) => setViewFields((current) => ({ ...current, [view]: next }))}
            />
          ))}
        </div>
      </div>

      <div className={styles.fields}>
        <Field label="Default view" htmlFor="layout-default-view">
          <Select
            id="layout-default-view"
            value={defaultView}
            onChange={(event) => setDefaultView(event.target.value as CollectionView)}
          >
            {enabledViews.map((view) => (
              <option key={view} value={view}>
                {COLLECTION_VIEW_LABELS[view]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Enabled views" htmlFor="layout-enabled-views">
          <div className={styles.checkList} id="layout-enabled-views">
            {COLLECTION_VIEWS.map((view) => (
              <Checkbox
                key={view}
                label={COLLECTION_VIEW_LABELS[view]}
                checked={enabledViews.includes(view)}
                onChange={() => toggleView(view)}
              />
            ))}
          </div>
        </Field>
        <Field label="Hidden statuses" htmlFor="layout-hidden-statuses">
          <div className={styles.checkList} id="layout-hidden-statuses">
            {workflow.statuses.length === 0 ? (
              <p className={styles.cardHint}>This project has no child workflow statuses yet.</p>
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
          </div>
        </Field>
      </div>

      <div className={styles.footer}>
        <Button onClick={() => void save()} loading={saving} disabled={saving}>
          Save changes
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
          Cancel
        </Button>
      </div>
    </Card>
  );
}
