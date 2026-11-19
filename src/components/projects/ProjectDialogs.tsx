'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
  trashProjectRequest,
  updateProjectFields,
} from './api';
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
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      setError('Enter a project title.');
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
      title="Add child project"
      description={`Create a project under ${parentTitle}.`}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="submit" form="add-project-form" loading={saving}>
            Add child project
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <form id="add-project-form" className={styles.dialogForm} onSubmit={submit} noValidate>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="Title" htmlFor="add-project-title" required error={undefined}>
          <Input
            id="add-project-title"
            name="title"
            value={title}
            autoFocus
            maxLength={200}
            autoComplete="off"
            invalid={Boolean(error)}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <p className={styles.dialogHint}>
          New projects start in the parent&apos;s start status and normally arrive in the Inbox.
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
      setError('Choose a destination and map the current status explicitly.');
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
      title="Move project"
      description={`Move ${projectTitle} to another parent.`}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} loading={saving}>
            Confirm move
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {loading ? <Notice tone="info">Loading destinations…</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? (
          <>
            <Field label="Destination" htmlFor="move-destination">
              <Select
                id="move-destination"
                value={destinationId}
                onChange={(event) => {
                  setDestinationId(event.target.value);
                  setMapping({});
                }}
              >
                <option value="">Choose a project</option>
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
                    {info.project.currentStatusName ?? 'Current status'} maps to
                  </span>
                  <Select
                    className={styles.mappingSelect}
                    aria-label="Destination status for the current status"
                    value={mappedStatusId}
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [oldStatusId]: event.target.value }))
                    }
                  >
                    <option value="">Choose a status</option>
                    {destination.statuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ) : null}
            <Notice tone="info" title="Map explicitly">
              Matching status names are not automatically equivalent. Descendants keep their own
              statuses because their immediate parents do not change.
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
      title="Move to Trash?"
      description={`${projectTitle} and its descendants will be moved to Trash.`}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" variant="danger" onClick={() => void submit()} loading={saving}>
            Move to Trash
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <p className={styles.dialogHint}>
          Trashed projects are read-only and are permanently deleted 30 days after they enter
          Trash. You can restore them before then.
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
      title={mode === 'archive' ? 'Archive project?' : 'Unarchive project?'}
      description={projectTitle}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} loading={saving}>
            {mode === 'archive' ? 'Archive project' : 'Unarchive project'}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {mode === 'archive' ? (
          <p className={styles.dialogHint}>
            Archiving hides this project and its descendants unless Show archived is turned on.
            Descendants keep their own archived state.
          </p>
        ) : (
          <p className={styles.dialogHint}>
            Unarchiving shows this project again according to the current Show archived setting.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Restore (+ deferred remapping)                                            */
/* ------------------------------------------------------------------------- */

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
      setError('Choose a status for every project that needs mapping.');
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
      title="Restore project"
      description={projectTitle}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} loading={saving}>
            Restore project
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {loading ? <Notice tone="info">Preparing restore…</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? (
          <>
            <p className={styles.dialogHint}>
              Restoring undoes this trash action. Only projects trashed together with it return;
              descendants trashed separately stay in Trash.
            </p>
            {info.candidates.length > 0 ? (
              <div className={styles.restoreList}>
                <p className={styles.restoreListTitle}>
                  Projects that will return ({info.candidates.length})
                </p>
                <ul className={styles.restoreListItems}>
                  {info.candidates.map((candidate) => (
                    <li key={candidate.projectId}>
                      {candidate.title}
                      {candidate.statusName ? ` · ${candidate.statusName}` : ''}
                      {candidate.invalid ? ' · needs a new status' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {invalid.length > 0 ? (
              <div className={styles.mappingRows}>
                <Notice tone="warning" title="Status no longer available">
                  These projects used a status that was removed from the parent workflow. Choose a
                  valid status before restoring.
                </Notice>
                {invalid.map((candidate) => (
                  <div key={candidate.projectId} className={styles.mappingRow}>
                    <span className={styles.mappingLabel}>
                      {candidate.title}
                      <span className={styles.destinationPath}>
                        {' '}
                        — {candidate.statusName ?? 'removed status'}
                      </span>
                    </span>
                    <Select
                      className={styles.mappingSelect}
                      aria-label={`Restore status for ${candidate.title}`}
                      value={mapping[candidate.projectId] ?? ''}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [candidate.projectId]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose a status</option>
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
      title={`Move ${count} project${count === 1 ? '' : 's'} to Trash?`}
      description="They will be grouped as one Trash action."
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" variant="danger" onClick={() => void submit()} loading={saving}>
            Move {count} to Trash
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <p className={styles.dialogHint}>
          Selected projects and their live descendants become read-only in Trash. Each newly trashed
          project gets its own 30-day deadline; projects already in Trash keep theirs.
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
        name: project.statusName ?? 'Unknown status',
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
      setError('Choose a destination project.');
      return;
    }
    if (!allMapped) {
      setError('Map every old status explicitly.');
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
      title={`Move ${projects.length} project${projects.length === 1 ? '' : 's'}`}
      description="They all move to one parent; descendants that are not selected keep their own statuses."
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} loading={saving}>
            Confirm move
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {loading ? <Notice tone="info">Loading destinations…</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!loading && infos && destinationOptions.length === 0 ? (
          <Notice tone="info">There is no shared destination available for this selection.</Notice>
        ) : null}
        {destinationOptions.length > 0 ? (
          <>
            <Field label="Destination" htmlFor="bulk-move-destination">
              <Select
                id="bulk-move-destination"
                value={destinationId}
                onChange={(event) => {
                  setDestinationId(event.target.value);
                  setMapping({});
                }}
              >
                <option value="">Choose a project</option>
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
                      {row.name}
                      {row.count > 1 ? ` (${row.count} projects)` : ''} maps to
                    </span>
                    <Select
                      className={styles.mappingSelect}
                      aria-label={`Destination status for ${row.name}`}
                      value={mapping[row.id] ?? ''}
                      onChange={(event) =>
                        setMapping((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    >
                      <option value="">Choose a status</option>
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
            <Notice tone="info" title="Map explicitly">
              Every distinct old status in the selection needs its own destination status, even when
              names match. Projects sharing an old status receive the same new status.
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
