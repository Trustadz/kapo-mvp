'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Input, Notice, Select } from '@/components/ui';
import type { MoveInfo, ProjectCard, RestoreInfo } from './types';
import {
  bulkMoveProjects,
  bulkTrashProjects,
  createChildProject,
  fetchMoveInfo,
  fetchRestoreInfo,
  moveProjectRequest,
  restoreProjectRequest,
  setShowArchived,
  trashProjectRequest,
  updateProjectFields,
} from './api';
import { useI18n } from '@/i18n/client';
import styles from './ProjectPage.module.css';

function errorMessage(result: { message: string }): string {
  return result.message;
}

/* ------------------------------------------------------------------------- */
/* Add child project                                                         */
/* ------------------------------------------------------------------------- */

export interface AddProjectDialogProps {
  open: boolean;
  parentId: string;
  parentTitle: string;
  onClose: () => void;
  onCreated: (title: string) => void;
}

export function AddProjectDialog({
  open,
  parentId,
  parentTitle,
  onClose,
  onCreated,
}: AddProjectDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError(t('validation.projectTitleRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await createChildProject(parentId, title);
    setSaving(false);
    if (!result.ok) {
      setError(errorMessage(result));
      return;
    }
    onCreated(result.data.project.title);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('dialogs.addChildTitle')}
      description={t('dialogs.addChildDescription', { title: parentTitle })}
      dismissible={!saving}
      initialFocusRef={titleRef}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="submit" form="add-project-form" loading={saving}>
            {t('dialogs.addChildTitle')}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="add-project-form"
        className={styles.dialogForm}
        onSubmit={submit}
        noValidate
        aria-label={t('dialogs.addChildTitle')}
      >
        <Field
          label={t('dialogs.title')}
          htmlFor="add-project-title"
          required
          error={error ?? undefined}
        >
          <Input
            ref={titleRef}
            id="add-project-title"
            name="title"
            value={title}
            maxLength={200}
            autoComplete="off"
            invalid={Boolean(error)}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <p className={styles.dialogHint}>
          {t('dialogs.addChildHint')}
        </p>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Move + status mapping                                                     */
/* ------------------------------------------------------------------------- */

export interface MoveDialogProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  initialDestinationId?: string;
  onClose: () => void;
  onMoved: () => void;
}

export function MoveDialog({
  open,
  projectId,
  projectTitle,
  initialDestinationId,
  onClose,
  onMoved,
}: MoveDialogProps) {
  const { t } = useI18n();
  const [info, setInfo] = useState<MoveInfo | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setInfo(null);
    setDestinationId('');
    setMapping({});
    void fetchMoveInfo(projectId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setInfo(result.data);
      const initial =
        initialDestinationId &&
        result.data.destinations.some((destination) => destination.id === initialDestinationId)
          ? initialDestinationId
          : (result.data.destinations[0]?.id ?? '');
      setDestinationId(initial);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, initialDestinationId]);

  const destination = info?.destinations.find((entry) => entry.id === destinationId) ?? null;
  const oldStatusId = info?.project.currentStatusId ?? '';
  const mappedStatusId = mapping[oldStatusId] ?? '';
  const canSubmit =
    Boolean(destination) && Boolean(mappedStatusId) && !saving && !loading && info !== null;

  const submit = async () => {
    if (!destination || !oldStatusId || !mappedStatusId) {
      setError(t('dialogs.chooseDestinationError'));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await moveProjectRequest(projectId, {
      destinationId: destination.id,
      mapping: { [oldStatusId]: mappedStatusId },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onMoved();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('dialogs.moveTitle')}
      description={t('dialogs.moveDescription', { title: projectTitle })}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} loading={saving}>
            {t('dialogs.confirmMove')}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {loading ? (
          <Notice tone="info">{t('dialogs.loadingDestinations')}</Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? (
          <>
            <Field label={t('dialogs.destination')} htmlFor="move-destination" required>
              <Select
                id="move-destination"
                value={destinationId}
                onChange={(event) => {
                  setDestinationId(event.target.value);
                  setMapping({});
                }}
              >
                <option value="">{t('dialogs.chooseProject')}</option>
                {info.destinations.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.path}
                  </option>
                ))}
              </Select>
            </Field>
            {destination ? (
              <div className={styles.mappingRows}>
                <div className={styles.mappingRow}>
                  <span className={styles.mappingLabel}>
                    {t('dialogs.mapsTo', {
                      status: info.project.currentStatusName ?? t('dialogs.currentStatus'),
                    })}
                  </span>
                  <Select
                    className={styles.mappingSelect}
                    aria-label={t('dialogs.destinationStatusAria')}
                    value={mappedStatusId}
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [oldStatusId]: event.target.value }))
                    }
                  >
                    <option value="">{t('dialogs.chooseStatus')}</option>
                    {destination.statuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ) : null}
            <Notice tone="info" title={t('dialogs.mapExplicitly')}>
              {t('dialogs.mapExplicitlyBody')}
            </Notice>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Trash confirmation                                                        */
/* ------------------------------------------------------------------------- */

export interface TrashDialogProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  onTrashed: () => void;
}

export function TrashDialog({
  open,
  projectId,
  projectTitle,
  onClose,
  onTrashed,
}: TrashDialogProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSaving(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = await trashProjectRequest(projectId);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onTrashed();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('dialogs.trashTitle')}
      description={t('dialogs.trashDescription', { title: projectTitle })}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" variant="danger" onClick={() => void submit()} loading={saving}>
            {t('dialogs.trashButton')}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <p className={styles.dialogHint}>
          {t('dialogs.trashHint')}
        </p>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Archive / unarchive                                                       */
/* ------------------------------------------------------------------------- */

export interface ArchiveDialogProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  mode: 'archive' | 'unarchive';
  onClose: () => void;
  onChanged: () => void;
}

export function ArchiveDialog({
  open,
  projectId,
  projectTitle,
  mode,
  onClose,
  onChanged,
}: ArchiveDialogProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSaving(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = await updateProjectFields(projectId, { archived: mode === 'archive' });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChanged();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'archive' ? t('dialogs.archiveTitle') : t('dialogs.unarchiveTitle')}
      description={projectTitle}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} loading={saving}>
            {mode === 'archive' ? t('dialogs.archiveButton') : t('dialogs.unarchiveButton')}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {mode === 'archive' ? (
          <p className={styles.dialogHint}>
            {t('dialogs.archiveHint')}
          </p>
        ) : (
          <p className={styles.dialogHint}>
            {t('dialogs.unarchiveHint')}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Hide archived (Show archived off on a project that would disappear)       */
/* ------------------------------------------------------------------------- */

export interface HideArchivedDialogProps {
  open: boolean;
  projectTitle: string;
  /** Human-readable name of the page the viewer will land on. */
  fallbackTitle: string;
  onClose: () => void;
  /** Called after the preference is persisted; the parent navigates away. */
  onConfirmed: () => void;
}

/**
 * Confirmation for turning Show archived off while viewing a project that the
 * setting would hide (the project itself or an ancestor is archived). Without
 * it the refreshed page would render the 404 "Project not available" dead end.
 */
export function HideArchivedDialog({
  open,
  projectTitle,
  fallbackTitle,
  onClose,
  onConfirmed,
}: HideArchivedDialogProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSaving(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = await setShowArchived(false);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onConfirmed();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('dialogs.hideArchivedTitle')}
      description={t('dialogs.hideArchivedDescription', { title: projectTitle })}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} loading={saving}>
            {t('dialogs.turnOffShowArchived')}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <p className={styles.dialogHint}>
          {t('dialogs.hideArchivedHint', { fallback: fallbackTitle })}
        </p>
      </div>
    </Dialog>
  );
}

export interface RestoreDialogProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  onRestored: () => void;
}

export function RestoreDialog({
  open,
  projectId,
  projectTitle,
  onClose,
  onRestored,
}: RestoreDialogProps) {
  const { t, plural } = useI18n();
  const [info, setInfo] = useState<RestoreInfo | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    setMapping({});
    setError(null);
    void fetchRestoreInfo(projectId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setInfo(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const invalid = info?.candidates.filter((candidate) => candidate.invalid) ?? [];
  const allMapped = invalid.every((candidate) => Boolean(mapping[candidate.projectId]));
  const canSubmit = !loading && !saving && info !== null && allMapped;

  const submit = async () => {
    if (!info) return;
    if (!allMapped) {
      setError(t('dialogs.chooseStatusForEvery'));
      return;
    }
    setSaving(true);
    setError(null);
    const payload = invalid.length > 0 ? mapping : undefined;
    const result = await restoreProjectRequest(projectId, payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onRestored();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('dialogs.restoreTitle')}
      description={projectTitle}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} loading={saving}>
            {t('dialogs.restoreButton')}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {loading ? <Notice tone="info">{t('dialogs.preparingRestore')}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? (
          <>
            <p className={styles.dialogHint}>
              {t('dialogs.restoreHint')}
            </p>
            {info.candidates.length > 0 ? (
              <div className={styles.restoreList}>
                <p className={styles.restoreListTitle}>
                  {plural('plurals.returning', info.candidates.length)}
                </p>
                <ul className={styles.restoreListItems}>
                  {info.candidates.map((candidate) => (
                    <li key={candidate.projectId}>
                      {candidate.title}
                      {candidate.statusName ? ` · ${candidate.statusName}` : ''}
                      {candidate.invalid ? ` · ${t('dialogs.needsNewStatus')}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {invalid.length > 0 ? (
              <div className={styles.mappingRows}>
                <Notice tone="warning" title={t('dialogs.statusUnavailable')}>
                  {t('dialogs.statusUnavailableBody')}
                </Notice>
                {invalid.map((candidate) => (
                  <div key={candidate.projectId} className={styles.mappingRow}>
                    <span className={styles.mappingLabel}>
                      {candidate.title}
                      <span className={styles.destinationPath}>
                        {' '}
                        — {candidate.statusName ?? t('dialogs.removedStatus')}
                      </span>
                    </span>
                    <Select
                      className={styles.mappingSelect}
                      aria-label={t('dialogs.restoreStatusAria', { title: candidate.title })}
                      value={mapping[candidate.projectId] ?? ''}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [candidate.projectId]: event.target.value,
                        }))
                      }
                    >
                      <option value="">{t('dialogs.chooseStatus')}</option>
                      {candidate.statuses.map((status) => (
                        <option key={status.id} value={status.id}>
                          {status.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Bulk trash (Tree multiselect)                                             */
/* ------------------------------------------------------------------------- */

export interface BulkTrashDialogProps {
  open: boolean;
  projects: ProjectCard[];
  onClose: () => void;
  onTrashed: (count: number) => void;
}

/** One trash operation (single action id) for a Tree selection. */
export function BulkTrashDialog({
  open,
  projects,
  onClose,
  onTrashed,
}: BulkTrashDialogProps) {
  const { t, plural } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = projects.length;

  useEffect(() => {
    if (!open) {
      setSaving(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    const first = projects[0];
    if (!first) return;
    setSaving(true);
    setError(null);
    const result = await bulkTrashProjects(first.id, projects.map((project) => project.id));
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onTrashed(result.data.trashed.length);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={plural('plurals.bulkTrashTitle', count)}
      description={t('dialogs.bulkTrashDescription')}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" variant="danger" onClick={() => void submit()} loading={saving}>
            {t('dialogs.bulkTrashButton', { count })}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <p className={styles.dialogHint}>
          {t('dialogs.bulkTrashHint')}
        </p>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Bulk move (Tree multiselect)                                              */
/* ------------------------------------------------------------------------- */

export interface BulkMoveDialogProps {
  open: boolean;
  projects: ProjectCard[];
  onClose: () => void;
  onMoved: (moved: ProjectCard[]) => void;
}

interface BulkStatusRow {
  id: string;
  name: string;
  count: number;
}

/**
 * Bulk reparent with explicit mapping for every distinct old status in use.
 * All projects sharing an old status receive the same destination status.
 */
export function BulkMoveDialog({ open, projects, onClose, onMoved }: BulkMoveDialogProps) {
  const { t, plural } = useI18n();
  const [infos, setInfos] = useState<MoveInfo[] | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(() => new Set(projects.map((project) => project.id)), [projects]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setInfos(null);
    setDestinationId('');
    setMapping({});
    void Promise.all(projects.map((project) => fetchMoveInfo(project.id))).then((results) => {
      if (cancelled) return;
      setLoading(false);
      const failure = results.find((result) => !result.ok);
      if (failure && !failure.ok) {
        setError(failure.message);
        return;
      }
      setInfos(results.filter((result) => result.ok).map((result) => (result as { ok: true; data: MoveInfo }).data));
    });
    return () => {
      cancelled = true;
    };
  }, [open, projects]);

  const destinationOptions = useMemo(() => {
    if (!infos || infos.length === 0) return [];
    const first = infos[0];
    if (!first) return [];
    const common = new Set(first.destinations.map((destination) => destination.id));
    for (const info of infos.slice(1)) {
      const ids = new Set(info.destinations.map((destination) => destination.id));
      for (const id of [...common]) {
        if (!ids.has(id)) common.delete(id);
      }
    }
    return first.destinations
      .filter((destination) => common.has(destination.id) && !selectedIds.has(destination.id))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [infos, selectedIds]);

  const destination = destinationOptions.find((entry) => entry.id === destinationId) ?? null;

  const statusRows: BulkStatusRow[] = useMemo(() => {
    const rows = new Map<string, BulkStatusRow>();
    for (const project of projects) {
      if (!project.statusId) continue;
      const row = rows.get(project.statusId) ?? {
        id: project.statusId,
        name: project.statusName ?? t('dialogs.unknownStatus'),
        count: 0,
      };
      row.count += 1;
      rows.set(project.statusId, row);
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const allMapped = statusRows.every((row) => Boolean(mapping[row.id]));
  const canSubmit = Boolean(destination) && allMapped && !saving && !loading;

  const submit = async () => {
    if (!destination) {
      setError(t('dialogs.chooseDestination'));
      return;
    }
    if (!allMapped) {
      setError(t('dialogs.mapEveryStatus'));
      return;
    }
    const first = projects[0];
    if (!first) return;
    setSaving(true);
    setError(null);
    const result = await bulkMoveProjects(
      first.id,
      projects.map((project) => project.id),
      destination.id,
      mapping,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onMoved(result.data.moved);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={plural('plurals.bulkMoveTitle', projects.length)}
      description={t('dialogs.bulkMoveDescription')}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} loading={saving}>
            {t('dialogs.confirmMove')}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {loading ? (
          <Notice tone="info">{t('dialogs.loadingDestinations')}</Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!loading && infos && destinationOptions.length === 0 ? (
          <Notice tone="info">{t('dialogs.noSharedDestination')}</Notice>
        ) : null}
        {destinationOptions.length > 0 ? (
          <>
            <Field label={t('dialogs.destination')} htmlFor="bulk-move-destination" required>
              <Select
                id="bulk-move-destination"
                value={destinationId}
                onChange={(event) => {
                  setDestinationId(event.target.value);
                  setMapping({});
                }}
              >
                <option value="">{t('dialogs.chooseProject')}</option>
                {destinationOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.path}
                  </option>
                ))}
              </Select>
            </Field>
            {destination ? (
              <div className={styles.mappingRows}>
                {statusRows.map((row) => (
                  <div key={row.id} className={styles.mappingRow}>
                    <span className={styles.mappingLabel}>
                      {t('dialogs.mapsToBulk', {
                        status:
                          row.count > 1
                            ? `${row.name}${plural('plurals.statusProjectCount', row.count)}`
                            : row.name,
                      })}
                    </span>
                    <Select
                      className={styles.mappingSelect}
                      aria-label={t('dialogs.destinationStatusFor', { status: row.name })}
                      value={mapping[row.id] ?? ''}
                      onChange={(event) =>
                        setMapping((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    >
                      <option value="">{t('dialogs.chooseStatus')}</option>
                      {destination.statuses.map((status) => (
                        <option key={status.id} value={status.id}>
                          {status.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            ) : null}
            <Notice tone="info" title={t('dialogs.mapExplicitly')}>
              {t('dialogs.mapExplicitlyBulkBody')}
            </Notice>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Shared hook: router.refresh + dialogs live in the page shell. */
export function useRefresh(): () => void {
  const router = useRouter();
  return () => router.refresh();
}
