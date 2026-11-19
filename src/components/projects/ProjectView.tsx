'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, Badge, Button, Card, Icon, Menu, Notice, Select, Toast } from '@/components/ui';
import type { MenuItem } from '@/components/ui';
import { formatDate, formatPersonName } from '@/lib/format';
import { ActivityPanel } from './ActivityPanel';
import { ChildProjects } from './ChildProjects';
import {
  ArchiveDialog,
  AddProjectDialog,
  MoveDialog,
  RestoreDialog,
  TrashDialog,
} from './ProjectDialogs';
import {
  setShowArchived,
  toggleProjectFavorite,
  updateProjectFields,
} from './api';
import type {
  ProjectFieldKey,
  ProjectLink,
  ProjectPageData,
} from './types';
import { PROJECT_FIELD_LABELS } from './types';
import styles from './ProjectPage.module.css';

type DialogState =
  | { kind: 'add' }
  | { kind: 'move'; projectId: string; projectTitle: string; destinationId?: string }
  | { kind: 'trash'; projectId: string; projectTitle: string }
  | { kind: 'archive'; projectId: string; projectTitle: string; mode: 'archive' | 'unarchive' }
  | { kind: 'restore'; projectId: string; projectTitle: string }
  | null;

interface ToastState {
  message: string;
  tone: 'success' | 'error' | 'info';
}

function LinkValue({ link }: { link: ProjectLink }) {
  return (
    <Link href={`/p/${link.id}`} className={styles.breadcrumbLink}>
      {link.title}
    </Link>
  );
}

function FieldValue({ field, data }: { field: ProjectFieldKey; data: ProjectPageData }) {
  const project = data.project;
  switch (field) {
    case 'projectId':
      return <span className={styles.detailValue}>{project.displayId}</span>;
    case 'parent':
      return project.parent ? (
        <span className={styles.detailValue}>
          <LinkValue link={project.parent} />
        </span>
      ) : (
        <span className={styles.detailValueMuted}>—</span>
      );
    case 'reporter':
      return (
        <span className={`${styles.detailValue} ${styles.reporter}`}>
          <Avatar name={formatPersonName(project.reporter.username)} src={project.reporter.avatar ?? undefined} size={24} decorative />
          {formatPersonName(project.reporter.username)}
        </span>
      );
    case 'status':
      if (project.isRoot) return <span className={styles.detailValueMuted}>—</span>;
      return <span className={styles.detailValue}>{project.statusName ?? '—'}</span>;
    case 'created':
      return <span className={styles.detailValue}>{formatDate(project.createdAt)}</span>;
    case 'updated':
      return <span className={styles.detailValue}>{formatDate(project.updatedAt)}</span>;
    default:
      return null;
  }
}
function StatusControlInternal({
  data,
  onStatusChanged,
}: {
  data: ProjectPageData;
  onStatusChanged: (message: string, tone: 'success' | 'error') => void;
}) {
  const [saving, setSaving] = useState(false);
  const project = data.project;
  const options = [...data.parentStatuses].sort((a, b) => a.position - b.position);
  return (
    <span className={styles.propertyValue}>
      <Select
        className={styles.propertySelect}
        aria-label="Project status"
        value={project.statusId ?? ''}
        disabled={saving}
        onChange={(event) => {
          const statusId = event.target.value;
          const status = options.find((entry) => entry.id === statusId);
          if (!status || status.id === project.statusId) return;
          setSaving(true);
          void updateProjectFields(project.id, { statusId }).then((result) => {
            setSaving(false);
            if (!result.ok) {
              onStatusChanged(result.message, 'error');
              return;
            }
            onStatusChanged(`Status changed to ${status.name}.`, 'success');
          });
        }}
      >
        {options.map((status) => (
          <option key={status.id} value={status.id}>
            {status.name}
          </option>
        ))}
      </Select>
    </span>
  );
}

export function ProjectView({ data }: { data: ProjectPageData }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showArchivedSaving, setShowArchivedSaving] = useState(false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);

  const project = data.project;
  const refresh = () => router.refresh();
  const notify = (message: string, tone: 'success' | 'error' | 'info' = 'success') =>
    setToast({ message, tone });

  const canAdmin = project.canAdmin;
  const canEdit = project.canEdit;

  const openMove = (projectId: string, destinationId?: string) => {
    const known =
      data.children.find((child) => child.id === projectId) ??
      data.descendants.find((child) => child.id === projectId);
    const title =
      projectId === project.id ? project.title : known?.title ?? 'this project';
    setDialog({ kind: 'move', projectId, projectTitle: title, destinationId });
  };

  const toggleFavorite = async () => {
    setFavoriteSaving(true);
    const result = await toggleProjectFavorite(project.id);
    setFavoriteSaving(false);
    if (!result.ok) {
      notify(result.message, 'error');
      return;
    }
    notify(result.data.favorite ? 'Added to Favorites.' : 'Removed from Favorites.');
    refresh();
  };

  const toggleShowArchived = async () => {
    setShowArchivedSaving(true);
    const next = !data.showArchived;
    const result = await setShowArchived(next);
    setShowArchivedSaving(false);
    if (!result.ok) {
      notify(result.message, 'error');
      return;
    }
    notify(next ? 'Archived projects are now shown.' : 'Archived projects are now hidden.');
    refresh();
  };

  const menuItems: MenuItem[] = [];
  menuItems.push({
    id: 'show-archived',
    label: 'Show archived',
    icon: 'visibility',
    selected: data.showArchived,
    disabled: showArchivedSaving,
    onSelect: () => void toggleShowArchived(),
  });
  if (canAdmin && !project.isRoot) {
    menuItems.push({ id: 'sep-project', separator: true });
    menuItems.push({
      id: 'move',
      label: 'Move…',
      icon: 'drive_file_move',
      disabled: project.trashed,
      onSelect: () => openMove(project.id),
    });
    if (project.trashed) {
      menuItems.push({
        id: 'restore',
        label: 'Restore…',
        icon: 'restore_from_trash',
        onSelect: () => setDialog({ kind: 'restore', projectId: project.id, projectTitle: project.title }),
      });
    } else {
      menuItems.push({
        id: 'archive',
        label: project.archived ? 'Unarchive' : 'Archive…',
        icon: project.archived ? 'unarchive' : 'archive',
        onSelect: () =>
          setDialog({
            kind: 'archive',
            projectId: project.id,
            projectTitle: project.title,
            mode: project.archived ? 'unarchive' : 'archive',
          }),
      });
      menuItems.push({
        id: 'trash',
        label: 'Move to Trash…',
        icon: 'delete',
        danger: true,
        onSelect: () => setDialog({ kind: 'trash', projectId: project.id, projectTitle: project.title }),
      });
    }
  }
  if (canAdmin) {
    menuItems.push({ id: 'sep-settings', separator: true });
    menuItems.push({
      id: 'project-settings',
      label: 'Project settings',
      icon: 'settings',
      href: `/p/${project.id}/settings`,
    });
  }

  const visibleMainFields = data.layout.main;
  const visibleSidebarFields = data.layout.sidebar.filter(
    (field) => !(project.isRoot && field === 'status'),
  );

  const renderProperty = (field: ProjectFieldKey) => {
    if (field === 'status') {
      if (project.isRoot) return null;
      return (
        <div className={styles.propertyRow} key={field}>
          <span className={styles.propertyLabel}>{PROJECT_FIELD_LABELS[field]}</span>
          {canEdit && !project.trashed && data.parentStatuses.length > 0 ? (
            <StatusControlInternal data={data} onStatusChanged={(message, tone) => {
              notify(message, tone);
              if (tone === 'success') refresh();
            }} />
          ) : (
            <span className={styles.propertyValue}>{project.statusName ?? '—'}</span>
          )}
        </div>
      );
    }
    if (field === 'reporter') {
      return (
        <div className={styles.propertyRow} key={field}>
          <span className={styles.propertyLabel}>{PROJECT_FIELD_LABELS[field]}</span>
          <span className={styles.propertyValue}>
            <Avatar name={formatPersonName(project.reporter.username)} src={project.reporter.avatar ?? undefined} size={24} decorative />
            {formatPersonName(project.reporter.username)}
          </span>
        </div>
      );
    }
    if (field === 'projectId') {
      return (
        <div className={styles.propertyRow} key={field}>
          <span className={styles.propertyLabel}>Project ID</span>
          <span className={styles.propertyValue}>{project.displayId}</span>
        </div>
      );
    }
    if (field === 'parent') {
      return (
        <div className={styles.propertyRow} key={field}>
          <span className={styles.propertyLabel}>Parent</span>
          <span className={styles.propertyValue}>
            {project.parent ? <LinkValue link={project.parent} /> : '—'}
          </span>
        </div>
      );
    }
    return (
      <div className={styles.propertyRow} key={field}>
        <span className={styles.propertyLabel}>{PROJECT_FIELD_LABELS[field]}</span>
        <span className={styles.propertyValue}>
          {field === 'created' ? formatDate(project.createdAt) : formatDate(project.updatedAt)}
        </span>
      </div>
    );
  };

  const childPositionAbove = data.settings.child_position === 'above';

  const childSection = project.trashed ? null : (
    <ChildProjects
      data={data}
      canCreate={project.canCreateChild && canEdit}
      onAddProject={() => setDialog({ kind: 'add' })}
      onMoveProject={openMove}
      refresh={refresh}
      notify={notify}
    />
  );

  return (
    <div className={styles.page}>
      <div>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          {project.isRoot ? (
            <span>Projects</span>
          ) : data.breadcrumb.length === 0 ? (
            <span>Projects</span>
          ) : (
            <>
              {data.breadcrumb.map((ancestor) => (
                <span key={ancestor.id} className={styles.breadcrumb}>
                  <Link href={`/p/${ancestor.id}`} className={styles.breadcrumbLink}>
                    {ancestor.title}
                  </Link>
                  <span className={styles.breadcrumbSeparator}>/</span>
                </span>
              ))}
              <span>{project.title}</span>
            </>
          )}
        </nav>
        <header className={styles.header}>
          <div className={styles.headerRow}>
            <div className={styles.titleGroup}>
              <div className={styles.titleRow}>
                <h1 className={styles.title}>{project.title}</h1>
                {project.trashed ? <Badge tone="danger">In Trash</Badge> : null}
                {project.archived ? <Badge tone="archived">Archived</Badge> : null}
                {project.inbox && !project.trashed ? <Badge tone="warning">Inbox</Badge> : null}
              </div>
            </div>
            <div className={styles.headerActions}>
              {!project.trashed ? (
                <button
                  type="button"
                  className={styles.favoriteButton}
                  aria-pressed={project.favorite}
                  onClick={() => void toggleFavorite()}
                  disabled={favoriteSaving}
                >
                  <Icon name="star" size={20} filled={project.favorite} />
                  <span>Favorite</span>
                </button>
              ) : null}
              <Menu
                label="Project actions"
                align="end"
                trigger={({ ref, ...triggerProps }) => (
                  <button
                    {...triggerProps}
                    ref={ref}
                    type="button"
                    className={styles.iconButton}
                    aria-label="Project actions"
                    title="Project actions"
                  >
                    <Icon name="settings" size={20} />
                  </button>
                )}
                items={menuItems}
              />
            </div>
          </div>
        </header>
      </div>

      {project.trashed ? (
        <Notice tone="warning" title="This project is in Trash">
          <div className={styles.trashNotice}>
            <span>
              It is read-only and will be permanently deleted
              {project.purgeDeadline ? ` on ${formatDate(project.purgeDeadline)}` : ' after 30 days'}.
            </span>
            {canAdmin ? (
              <Button
                variant="quiet"
                size="sm"
                icon={<Icon name="restore_from_trash" size={18} />}
                onClick={() =>
                  setDialog({ kind: 'restore', projectId: project.id, projectTitle: project.title })
                }
              >
                Restore
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}

      {childPositionAbove ? childSection : null}

      <div className={styles.overview}>
        <Card className={styles.detailsCard} as="section" aria-labelledby="details-heading">
          <h2 id="details-heading" className={styles.cardTitle}>
            Details
          </h2>
          {project.isRoot ? (
            <div className={styles.rootNotes}>
              <p className={styles.rootNote}>All projects start here.</p>
              <p className={styles.rootNote}>Root has no parent or status.</p>
            </div>
          ) : (
            <div className={styles.detailRows}>
              {visibleMainFields.map((field) => (
                <div className={styles.detailRow} key={field}>
                  <span className={styles.detailLabel}>{PROJECT_FIELD_LABELS[field]}</span>
                  <FieldValue field={field} data={data} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className={styles.propertiesCard} as="aside" aria-labelledby="properties-heading">
          <h2 id="properties-heading" className={styles.cardTitle}>
            Properties
          </h2>
          <div className={styles.propertiesRows}>
            {visibleSidebarFields.map((field) => renderProperty(field))}
          </div>
        </Card>
      </div>

      {!childPositionAbove ? childSection : null}

      <ActivityPanel
        projectId={project.id}
        projectTitle={project.title}
        initial={data.activity}
      />

      {/* Dialogs mount only while open: keeps hidden autofocus inputs out of
          the hydrated DOM (avoids hydration mismatches). */}
      {dialog?.kind === 'add' ? (
        <AddProjectDialog
          open
          parentId={project.id}
          parentTitle={project.title}
          onClose={() => setDialog(null)}
          onCreated={(title) => {
            notify(`Created “${title}” in the Inbox.`);
            refresh();
          }}
        />
      ) : null}
      {dialog?.kind === 'move' ? (
        <MoveDialog
          open
          projectId={dialog.projectId}
          projectTitle={dialog.projectTitle}
          initialDestinationId={dialog.destinationId}
          onClose={() => setDialog(null)}
          onMoved={() => {
            notify('Project moved.');
            refresh();
          }}
        />
      ) : null}
      {dialog?.kind === 'trash' ? (
        <TrashDialog
          open
          projectId={dialog.projectId}
          projectTitle={dialog.projectTitle}
          onClose={() => setDialog(null)}
          onTrashed={() => {
            notify('Moved to Trash.');
            refresh();
            if (project.parent) router.push(`/p/${project.parent.id}`);
            else router.push('/');
          }}
        />
      ) : null}
      {dialog?.kind === 'archive' ? (
        <ArchiveDialog
          open
          projectId={dialog.projectId}
          projectTitle={dialog.projectTitle}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onChanged={() => {
            const mode = dialog?.kind === 'archive' ? dialog.mode : 'archive';
            if (mode === 'archive' && !data.showArchived) {
              // F22: do not leave the user on the hidden-archived dead end;
              // return to the parent with a confirmation.
              notify('Project archived. Turn on “Show archived” to see it again.');
              if (project.parent) router.push(`/p/${project.parent.id}`);
              else router.push('/');
              return;
            }
            notify(mode === 'unarchive' ? 'Project unarchived.' : 'Project archived.');
            refresh();
          }}
        />
      ) : null}
      {dialog?.kind === 'restore' ? (
        <RestoreDialog
          open
          projectId={dialog.projectId}
          projectTitle={dialog.projectTitle}
          onClose={() => setDialog(null)}
          onRestored={() => {
            notify('Project restored.');
            refresh();
          }}
        />
      ) : null}

      <Toast
        open={toast !== null}
        message={toast?.message ?? ''}
        tone={toast?.tone ?? 'success'}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
