'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Card, Icon, Menu, Notice, Select, Toast } from '@/components/ui';
import type { MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatPersonName } from '@/lib/format';
import {
  isAddonFieldRef,
  parseAddonFieldRef,
  type ProjectAddonEditorItem,
  type AddonFieldDefinition,
} from '@/lib/addons';
import { PROJECT_FIELD_MESSAGE_KEYS } from '@/i18n/domain-labels';
import { useI18n } from '@/i18n/client';
import { useToastMessage } from '@/components/ui/use-live-announcer';
import { markFieldChanged } from '@/lib/changed-fields';
import { useFieldChanged } from '@/lib/use-field-changed';
import { setProjectWatch } from '@/components/notifications/api';
import { ActivityPanel } from './ActivityPanel';
import { AddonFieldDialog, formatAddonFieldValue } from './AddonFieldDialog';
import { AddonUserPicker } from './AddonUserPicker';
import { ChildProjects } from './ChildProjects';
import {
  readShowInboxPreference,
  writeShowInboxPreference,
} from './collectionVisibility';
import {
  ArchiveDialog,
  AddProjectDialog,
  HideArchivedDialog,
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
  CoreProjectFieldKey,
  ProjectFieldKey,
  ProjectLink,
  ProjectPageData,
} from './types';
import styles from './ProjectPage.module.css';

type DialogState =
  | { kind: 'add' }
  | { kind: 'addon'; identifier: string }
  | { kind: 'move'; projectId: string; projectTitle: string; destinationId?: string }
  | { kind: 'trash'; projectId: string; projectTitle: string }
  | { kind: 'archive'; projectId: string; projectTitle: string; mode: 'archive' | 'unarchive' }
  | { kind: 'hideArchived' }
  | { kind: 'restore'; projectId: string; projectTitle: string }
  | null;

function LinkValue({ link }: { link: ProjectLink }) {
  return (
    <Link href={`/p/${link.id}`} className={styles.breadcrumbLink}>
      {link.title}
    </Link>
  );
}

/**
 * The project actions menu has one trigger for desktop (in the header action
 * row) and one for mobile (on the breadcrumb line). Both are rendered; CSS
 * hides the one that does not apply, so only the visible trigger is tabbable.
 */
function ProjectSettingsMenu({
  items,
  label,
  triggerClassName,
}: {
  items: MenuItem[];
  label: string;
  triggerClassName?: string;
}) {
  return (
    <Menu
      label={label}
      align="end"
      items={items}
      trigger={({ ref, ...triggerProps }) => (
        <button
          {...triggerProps}
          ref={ref}
          type="button"
          className={cn(styles.iconButton, triggerClassName)}
          aria-label={label}
          title={label}
        >
          <Icon name="settings" size={20} />
        </button>
      )}
    />
  );
}

interface ResolvedAddonField {
  item: ProjectAddonEditorItem;
  field: AddonFieldDefinition;
}

function resolveAddonField(data: ProjectPageData, ref: string): ResolvedAddonField | null {
  const parts = parseAddonFieldRef(ref);
  if (!parts) return null;
  const item = data.addons.items.find((candidate) => candidate.identifier === parts.identifier);
  if (!item) return null;
  const field = item.fields.find((candidate) => candidate.key === parts.fieldKey);
  return field ? { item, field } : null;
}

function AddonValueText({ resolved }: { resolved: ResolvedAddonField }) {
  const { t, formatDate, formatNumber } = useI18n();
  const text = formatAddonFieldValue(
    resolved.item,
    resolved.field,
    t,
    formatDate,
    formatNumber,
  );
  return text ? (
    <span className={styles.detailValue}>{text}</span>
  ) : (
    <span className={styles.detailValueMuted}>—</span>
  );
}

function AddonEditButton({
  resolved,
  onEdit,
}: {
  resolved: ResolvedAddonField;
  onEdit: (identifier: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      size="sm"
      variant="quiet"
      className={styles.addonEdit}
      aria-label={t('addons.editField', { field: resolved.field.label })}
      onClick={() => onEdit(resolved.item.identifier)}
    >
      {t('common.edit')}
    </Button>
  );
}

function AddonFieldDisplay({
  resolved,
  projectId,
  canEdit,
  notify,
  onSaved,
  onEdit,
}: {
  resolved: ResolvedAddonField;
  projectId: string;
  canEdit: boolean;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onSaved: () => void;
  onEdit: (identifier: string) => void;
}) {
  if (resolved.field.type === 'user') {
    return (
      <AddonUserPicker
        projectId={projectId}
        item={resolved.item}
        field={resolved.field}
        canEdit={canEdit}
        notify={notify}
        onSaved={onSaved}
      />
    );
  }
  return (
    <>
      <AddonValueText resolved={resolved} />
      {canEdit ? <AddonEditButton resolved={resolved} onEdit={onEdit} /> : null}
    </>
  );
}

function FieldValue({ field, data }: { field: CoreProjectFieldKey; data: ProjectPageData }) {
  const { t, formatDate } = useI18n();
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
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const project = data.project;
  const options = [...data.parentStatuses].sort((a, b) => a.position - b.position);
  return (
    <span className={styles.propertyValue}>
      <Select
        className={styles.propertySelect}
        aria-label={t('project.statusAria')}
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
            // Issue #56: keep a subtle marker on this field until a full load.
            markFieldChanged(project.id, 'status');
            onStatusChanged(t('project.statusChanged', { status: status.name }), 'success');
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
  const { t, formatDate } = useI18n();
  const [dialog, setDialog] = useState<DialogState>(null);
  const { toast, notify, dismiss } = useToastMessage();
  const [showArchivedSaving, setShowArchivedSaving] = useState(false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [watchSaving, setWatchSaving] = useState(false);
  // Default off, matching the server-rendered markup (the saved preference is
  // read after hydration). The project id is stored alongside the value so
  // client-side navigation to another project does not briefly reuse it.
  const [showInboxState, setShowInboxState] = useState({ projectId: data.project.id, show: false });
  const showInbox =
    showInboxState.projectId === data.project.id ? showInboxState.show : false;

  const project = data.project;
  const statusChanged = useFieldChanged(project.id, 'status');
  const refresh = () => router.refresh();

  useEffect(() => {
    setShowInboxState({
      projectId: project.id,
      show: readShowInboxPreference(project.id),
    });
  }, [project.id]);
  const canAdmin = project.canAdmin;
  const canEdit = project.canEdit;
  const childPositionAbove = data.settings.child_position === 'above';

  const openMove = (projectId: string, destinationId?: string) => {
    const known =
      data.children.find((child) => child.id === projectId) ??
      data.descendants.find((child) => child.id === projectId);
    const title =
      projectId === project.id ? project.title : (known?.title ?? t('project.thisProject'));
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
    notify(result.data.favorite ? t('project.favoriteAdded') : t('project.favoriteRemoved'));
    refresh();
  };

  const toggleWatch = async () => {
    setWatchSaving(true);
    const result = await setProjectWatch(project.id, !project.watching);
    setWatchSaving(false);
    if (!result.ok) {
      notify(result.message, 'error');
      return;
    }
    notify(result.data.watching ? t('project.watchingStarted') : t('project.watchingStopped'));
    refresh();
  };

  const toggleShowArchived = async () => {
    const next = !data.showArchived;
    if (!next && project.hiddenWhenArchivedOff) {
      // Turning the setting off would hide this page (the project or one of
      // its ancestors is archived). Confirm and navigate to a visible ancestor
      // instead of refreshing into the 404 dead end.
      setDialog({ kind: 'hideArchived' });
      return;
    }
    setShowArchivedSaving(true);
    const result = await setShowArchived(next);
    setShowArchivedSaving(false);
    if (!result.ok) {
      notify(result.message, 'error');
      return;
    }
    notify(next ? t('project.archivedShown') : t('project.archivedHidden'));
    refresh();
  };

  const fallbackTitle =
    data.breadcrumb.find((ancestor) => `/p/${ancestor.id}` === project.fallbackHref)?.title ??
    (project.fallbackHref === '/' ? t('project.dashboardFallback') : t('project.nearestProject'));

  const toggleShowInbox = () => {
    const next = !showInbox;
    writeShowInboxPreference(project.id, next);
    setShowInboxState({ projectId: project.id, show: next });
    notify(next ? t('project.inboxShown') : t('project.inboxHidden'));
  };

  const menuItems: MenuItem[] = [];
  menuItems.push({
    id: 'show-archived',
    label: t('project.showArchived'),
    icon: 'visibility',
    selected: data.showArchived,
    disabled: showArchivedSaving,
    onSelect: () => void toggleShowArchived(),
  });
  menuItems.push({
    id: 'show-inbox',
    label: t('project.showInbox'),
    icon: 'inbox',
    selected: showInbox,
    onSelect: toggleShowInbox,
  });
  if (project.parent) {
    // Always useful to non-admins, who otherwise only see the per-user toggles.
    menuItems.push({
      id: 'open-parent',
      label: t('project.openParent'),
      icon: 'arrow_upward',
      href: `/p/${project.parent.id}`,
    });
  }
  if (canAdmin && !project.isRoot) {
    menuItems.push({ id: 'sep-project', separator: true });
    menuItems.push({
      id: 'move',
      label: t('project.menuMove'),
      icon: 'drive_file_move',
      disabled: project.trashed,
      onSelect: () => openMove(project.id),
    });
    if (project.trashed) {
      menuItems.push({
        id: 'restore',
        label: t('project.menuRestore'),
        icon: 'restore_from_trash',
        onSelect: () => setDialog({ kind: 'restore', projectId: project.id, projectTitle: project.title }),
      });
    } else {
      menuItems.push({
        id: 'archive',
        label: project.archived ? t('project.unarchive') : t('project.archive'),
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
        label: t('project.moveToTrash'),
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
      label: t('project.projectSettings'),
      icon: 'settings',
      href: `/p/${project.id}/settings`,
    });
  }

  const visibleMainFields = data.layout.main;
  const visibleSidebarFields = data.layout.sidebar.filter(
    (field) => !(project.isRoot && field === 'status'),
  );

  const renderProperty = (field: ProjectFieldKey) => {
    if (isAddonFieldRef(field)) {
      const resolved = resolveAddonField(data, field);
      if (!resolved) return null;
      return (
        <div className={styles.propertyRow} key={field}>
          <span className={styles.propertyLabel}>{resolved.field.label}</span>
          <span className={styles.propertyValue}>
            <AddonFieldDisplay
              resolved={resolved}
              projectId={project.id}
              canEdit={data.addons.canEdit}
              notify={notify}
              onSaved={refresh}
              onEdit={(identifier) => setDialog({ kind: 'addon', identifier })}
            />
          </span>
        </div>
      );
    }
    if (field === 'status') {
      if (project.isRoot) return null;
      return (
        <div
          className={cn(styles.propertyRow, statusChanged && 'changed-field')}
          data-changed={statusChanged || undefined}
          key={field}
        >
          <span className={styles.propertyLabel}>
            {t(PROJECT_FIELD_MESSAGE_KEYS[field])}
          </span>
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
          <span className={styles.propertyLabel}>
            {t(PROJECT_FIELD_MESSAGE_KEYS[field])}
          </span>
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
          <span className={styles.propertyLabel}>{t('project.projectId')}</span>
          <span className={styles.propertyValue}>{project.displayId}</span>
        </div>
      );
    }
    if (field === 'parent') {
      return (
        <div className={styles.propertyRow} key={field}>
          <span className={styles.propertyLabel}>{t('project.parent')}</span>
          <span className={styles.propertyValue}>
            {project.parent ? <LinkValue link={project.parent} /> : '—'}
          </span>
        </div>
      );
    }
    return (
      <div className={styles.propertyRow} key={field}>
        <span className={styles.propertyLabel}>
          {t(PROJECT_FIELD_MESSAGE_KEYS[field])}
        </span>
        <span className={styles.propertyValue}>
          {field === 'created' ? formatDate(project.createdAt) : formatDate(project.updatedAt)}
        </span>
      </div>
    );
  };

  const childSection = project.trashed ? null : (
    <ChildProjects
      data={data}
      canCreate={project.canCreateChild && canEdit}
      showInbox={showInbox}
      onAddProject={() => setDialog({ kind: 'add' })}
      onMoveProject={openMove}
      refresh={refresh}
      notify={notify}
    />
  );

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.breadcrumbRow}>
          <nav
            className={`${styles.breadcrumb} ${styles.breadcrumbNav}`}
            aria-label={t('project.breadcrumb')}
          >
            {project.isRoot ? (
              <span>{t('project.projectsBreadcrumb')}</span>
            ) : data.breadcrumb.length === 0 ? (
              <span>{t('project.projectsBreadcrumb')}</span>
            ) : (
              <>
                {data.breadcrumb.map((ancestor) => (
                  <span key={ancestor.id} className={styles.breadcrumbItem}>
                    <Link href={`/p/${ancestor.id}`} className={styles.breadcrumbLink}>
                      {ancestor.title}
                    </Link>
                    <span className={styles.breadcrumbSeparator}>/</span>
                  </span>
                ))}
                <span aria-current="page">{project.title}</span>
              </>
            )}
          </nav>
          <div className={styles.mobileSettings}>
            <ProjectSettingsMenu
              items={menuItems}
              label={t('project.actions')}
              triggerClassName={styles.mobileSettingsButton}
            />
          </div>
        </div>
        <header className={styles.header}>
          <div className={styles.headerRow}>
            <div className={styles.titleGroup}>
              <div className={styles.titleRow}>
                <h1 className={styles.title}>{project.title}</h1>
                {project.trashed ? (
                  <Badge tone="danger">{t('project.inTrash')}</Badge>
                ) : null}
                {project.archived ? (
                  <Badge tone="archived">{t('common.archived')}</Badge>
                ) : null}
                {project.inbox && !project.trashed ? (
                  <Badge tone="warning">{t('common.inboxBadge')}</Badge>
                ) : null}
              </div>
            </div>
            <div className={styles.headerActions}>
              {!project.trashed ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.compactHeaderAction}
                    aria-label={t('project.favorite')}
                    aria-pressed={project.favorite}
                    onClick={() => void toggleFavorite()}
                    disabled={favoriteSaving}
                    icon={<Icon name="star" size={18} filled={project.favorite} />}
                  >
                    <span className={styles.headerActionLabel}>{t('project.favorite')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.compactHeaderAction}
                    aria-label={project.watching ? t('project.watching') : t('project.watch')}
                    aria-pressed={project.watching}
                    onClick={() => void toggleWatch()}
                    disabled={watchSaving}
                    icon={
                      <Icon
                        name={project.watching ? 'visibility' : 'visibility_off'}
                        size={18}
                        filled={project.watching}
                      />
                    }
                  >
                    <span className={styles.headerActionLabel}>
                      {project.watching ? t('project.watching') : t('project.watch')}
                    </span>
                  </Button>
                </>
              ) : null}
              <div className={styles.desktopSettings}>
                <ProjectSettingsMenu items={menuItems} label={t('project.actions')} />
              </div>
            </div>
          </div>
        </header>
      </div>

      {project.trashed ? (
        <Notice tone="warning" title={t('project.trashNoticeTitle')}>
          <div className={styles.trashNotice}>
            <span>
              {project.purgeDeadline
                ? t('project.trashNoticeOn', { date: formatDate(project.purgeDeadline) })
                : t('project.trashNoticeAfter')}
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
                {t('project.restore')}
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}

      {childPositionAbove ? childSection : null}

      <div className={styles.overview}>
        <Card className={styles.detailsCard} as="section" aria-labelledby="details-heading">
          <h2 id="details-heading" className={styles.cardTitle}>
            {t('project.details')}
          </h2>
          <div className={styles.detailRows}>
            {visibleMainFields.map((field) => {
              if (isAddonFieldRef(field)) {
                const resolved = resolveAddonField(data, field);
                if (!resolved) return null;
                return (
                  <div className={styles.detailRow} key={field}>
                    <span className={styles.detailLabel}>{resolved.field.label}</span>
                    <span className={styles.detailValueGroup}>
                      <AddonFieldDisplay
                        resolved={resolved}
                        projectId={project.id}
                        canEdit={data.addons.canEdit}
                        notify={notify}
                        onSaved={refresh}
                        onEdit={(identifier) => setDialog({ kind: 'addon', identifier })}
                      />
                    </span>
                  </div>
                );
              }
              return (
                <div className={styles.detailRow} key={field}>
                  <span className={styles.detailLabel}>
                    {t(PROJECT_FIELD_MESSAGE_KEYS[field])}
                  </span>
                  <FieldValue field={field} data={data} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card className={styles.propertiesCard} as="aside" aria-labelledby="properties-heading">
          <h2 id="properties-heading" className={styles.cardTitle}>
            {t('project.properties')}
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
            notify(t('project.createdToast', { title }));
            refresh();
          }}
        />
      ) : null}
      {dialog?.kind === 'addon'
        ? (() => {
            const item = data.addons.items.find(
              (candidate) => candidate.identifier === dialog.identifier,
            );
            if (!item) return null;
            return (
              <AddonFieldDialog
                key={`${item.identifier}-${JSON.stringify(item.values)}`}
                open
                projectId={project.id}
                item={item}
                notify={notify}
                onClose={() => setDialog(null)}
                onSaved={refresh}
              />
            );
          })()
        : null}
      {dialog?.kind === 'move' ? (
        <MoveDialog
          open
          projectId={dialog.projectId}
          projectTitle={dialog.projectTitle}
          initialDestinationId={dialog.destinationId}
          onClose={() => setDialog(null)}
          onMoved={() => {
            notify(t('project.movedToast'));
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
            notify(t('project.trashedToast'));
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
              notify(t('project.archivedHiddenToast'));
              if (project.parent) router.push(`/p/${project.parent.id}`);
              else router.push('/');
              return;
            }
            notify(
              mode === 'unarchive' ? t('project.unarchivedToast') : t('project.archivedToast'),
            );
            refresh();
          }}
        />
      ) : null}
      {dialog?.kind === 'hideArchived' ? (
        <HideArchivedDialog
          open
          projectTitle={project.title}
          fallbackTitle={fallbackTitle}
          onClose={() => setDialog(null)}
          onConfirmed={() => router.push(project.fallbackHref)}
        />
      ) : null}
      {dialog?.kind === 'restore' ? (
        <RestoreDialog
          open
          projectId={dialog.projectId}
          projectTitle={dialog.projectTitle}
          onClose={() => setDialog(null)}
          onRestored={() => {
            notify(t('project.restoredToast'));
            refresh();
          }}
        />
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
