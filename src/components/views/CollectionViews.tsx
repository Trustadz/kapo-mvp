'use client';

import Link from 'next/link';
import { useMemo, useState, type DragEvent, type ReactElement } from 'react';
import { Badge, Button, Checkbox, Icon, Menu, Select } from '@/components/ui';
import type { MenuItem } from '@/components/ui';
import type { Status } from '@/lib/types';
import type { ProjectCard, ProjectWithParent } from '@/components/projects/types';
import type { ViewFieldKey } from '@/lib/projects';
import { VIEW_FIELD_LABELS } from '@/lib/projects';
import { formatDate, formatPersonName } from '@/lib/format';
import { releaseInboxProject } from '@/components/projects/api';
import {
  reorderProjectRequest,
  updateProjectFields,
} from '@/components/projects/api';
import { BulkMoveDialog, BulkTrashDialog } from '@/components/projects/ProjectDialogs';
import type { CollectionViewContext } from './types';
import styles from './views.module.css';

/**
 * Collection views: Kanban, Card, Tree and List (product.md §5).
 *
 * Desktop drag and drop uses HTML5 DnD: cross-column drops change only the
 * status (sibling priority is preserved), within-column drops rewrite sibling
 * priority. Every action is also available from the keyboard-operable "Move
 * to…" menu so mouse/touch/keyboard users can do the same thing.
 */

function sameStatusColumn(statuses: Status[], statusId: string | null): Status | undefined {
  return statuses.find((status) => status.id === statusId);
}

function orderedChildren(children: ProjectCard[]): ProjectCard[] {
  return [...children].sort((a, b) => a.priority - b.priority);
}

function sortByPriority<T extends { priority: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.priority - b.priority);
}

function sortStatuses(statuses: Status[]): Status[] {
  return [...statuses].sort((a, b) => a.position - b.position);
}

async function changeStatus(
  ctx: CollectionViewContext,
  project: ProjectCard,
  statusId: string,
): Promise<void> {
  const status = ctx.statuses.find((entry) => entry.id === statusId);
  if (!status || status.id === project.statusId) return;
  const result = await updateProjectFields(project.id, { statusId });
  if (!result.ok) {
    ctx.notify(result.message, 'error');
    return;
  }
  ctx.notify(`Moved “${project.title}” to ${status.name}.`);
  ctx.refresh();
}

async function reorderBefore(
  ctx: CollectionViewContext,
  project: ProjectCard,
  beforeId: string | null,
): Promise<void> {
  if (!project.statusId) return;
  const result = await reorderProjectRequest(project.id, {
    statusId: project.statusId,
    beforeId,
  });
  if (!result.ok) {
    ctx.notify(result.message, 'error');
    return;
  }
  ctx.notify(`Reordered “${project.title}”.`);
  ctx.refresh();
}

interface ProjectActionsMenuProps {
  ctx: CollectionViewContext;
  project: ProjectCard;
  columnSiblings: ProjectCard[];
  allSiblings: ProjectCard[];
}

/** Keyboard/touch accessible equivalent of the Kanban drag actions. */
export function ProjectActionsMenu({
  ctx,
  project,
  columnSiblings,
  allSiblings,
}: ProjectActionsMenuProps) {
  const columnIndex = columnSiblings.findIndex((sibling) => sibling.id === project.id);
  const previousInColumn = columnIndex > 0 ? columnSiblings[columnIndex - 1] : undefined;
  const nextInColumn =
    columnIndex >= 0 && columnIndex < columnSiblings.length - 1
      ? columnSiblings[columnIndex + 1]
      : undefined;

  const globalIndex = allSiblings.findIndex((sibling) => sibling.id === project.id);
  const beforeSiblingForLater = (() => {
    if (!nextInColumn) return undefined;
    const nextGlobalIndex = allSiblings.findIndex((sibling) => sibling.id === nextInColumn.id);
    if (nextGlobalIndex < 0) return undefined;
    return allSiblings[nextGlobalIndex + 1];
  })();

  const items: MenuItem[] = [];
  if (ctx.canEdit) {
    for (const status of sortStatuses(ctx.statuses)) {
      if (status.id === project.statusId) continue;
      items.push({
        id: `status-${status.id}`,
        label: `Move to “${status.name}”`,
        icon: 'swap_horiz',
        onSelect: () => {
          void changeStatus(ctx, project, status.id);
        },
      });
    }
    if (items.length > 0) items.push({ id: 'sep-status', separator: true });
    items.push({
      id: 'priority-earlier',
      label: 'Move earlier',
      icon: 'arrow_upward',
      disabled: !previousInColumn,
      onSelect: () => {
        if (previousInColumn) {
          void reorderBefore(ctx, project, previousInColumn.id);
        }
      },
    });
    items.push({
      id: 'priority-later',
      label: 'Move later',
      icon: 'arrow_downward',
      disabled: !nextInColumn,
      onSelect: () => {
        void reorderBefore(ctx, project, beforeSiblingForLater?.id ?? null);
      },
    });
    items.push({ id: 'sep-move', separator: true });
    items.push({
      id: 'move-parent',
      label: 'Move to another project…',
      icon: 'drive_file_move',
      onSelect: () => ctx.openMoveDialog(project.id),
    });
    items.push({ id: 'sep-open', separator: true });
  }
  items.push({ id: 'open', label: 'Open project', icon: 'open_in_new', href: `/p/${project.id}` });
  void globalIndex;

  return (
    <Menu
      label={`Actions for ${project.title}`}
      align="end"
      trigger={({ ref, ...triggerProps }) => (
        <button
          {...triggerProps}
          ref={ref}
          type="button"
          className={styles.iconButton}
          aria-label={`Actions for ${project.title}`}
          title={`Actions for ${project.title}`}
        >
          <Icon name="more_vert" size={20} />
        </button>
      )}
      items={items}
    />
  );
}

function StatusControl({
  ctx,
  project,
  label,
}: {
  ctx: CollectionViewContext;
  project: ProjectCard;
  label?: string;
}) {
  if (!ctx.canEdit) {
    return <span className={styles.readonlyStatus}>{project.statusName ?? '—'}</span>;
  }
  return (
    <Select
      className={styles.statusSelect}
      aria-label={label ?? `Status for ${project.title}`}
      value={project.statusId ?? ''}
      onChange={(event) => {
        const value = event.target.value;
        void changeStatus(ctx, project, value);
      }}
    >
      {sortStatuses(ctx.statuses).map((status) => (
        <option key={status.id} value={status.id}>
          {status.name}
        </option>
      ))}
    </Select>
  );
}

function viewMetaParts(
  project: ProjectCard,
  fields: readonly ViewFieldKey[] | undefined,
): string[] {
  if (!fields || fields.length === 0) return [];
  const parts: string[] = [];
  for (const field of fields) {
    let value: string | null = null;
    switch (field) {
      case 'status':
        value = project.statusName;
        break;
      case 'parent':
        value = project.parent?.title ?? null;
        break;
      case 'reporter':
        value = project.reporter ? formatPersonName(project.reporter.username) : null;
        break;
      case 'priority':
        value = String(project.priority + 1);
        break;
      case 'created':
        value = formatDate(project.createdAt);
        break;
      case 'id':
        value = project.displayId;
        break;
      default:
        value = null;
    }
    if (value) parts.push(`${VIEW_FIELD_LABELS[field]}: ${value}`);
  }
  return parts;
}

/** Configured per-view property slots (product.md §5, PO P2). */
function ViewMeta({
  project,
  fields,
}: {
  project: ProjectCard;
  fields: readonly ViewFieldKey[] | undefined;
}) {
  const parts = viewMetaParts(project, fields);
  if (parts.length === 0) return null;
  return (
    <span className={styles.viewMeta}>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>{part}</span>
      ))}
    </span>
  );
}

function ArchivedBadge({ project }: { project: ProjectCard }) {
  return project.archived ? <Badge tone="archived">Archived</Badge> : null;
}

/* ------------------------------------------------------------------------- */
/* Kanban                                                                    */
/* ------------------------------------------------------------------------- */

export function KanbanView({ ctx }: { ctx: CollectionViewContext }) {
  const [dragging, setDragging] = useState<ProjectCard | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [overCard, setOverCard] = useState<string | null>(null);

  const hidden = new Set(ctx.settings.hidden_statuses);
  const visibleStatuses = sortStatuses(ctx.statuses).filter((status) => !hidden.has(status.id));
  const columns = visibleStatuses.length > 0 ? visibleStatuses : sortStatuses(ctx.statuses);
  const ordered = orderedChildren(ctx.children);

  const cardsFor = (statusId: string) =>
    ordered.filter((project) => project.statusId === statusId);

  const resetDrag = () => {
    setDragging(null);
    setOverColumn(null);
    setOverCard(null);
  };

  const handleDrop = (event: DragEvent, statusId: string, target?: ProjectCard) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || dragging?.id;
    const project = ordered.find((candidate) => candidate.id === id) ?? null;
    if (!project) {
      resetDrag();
      return;
    }
    if (target && target.id !== project.id) {
      if (target.statusId === project.statusId) void reorderBefore(ctx, project, target.id);
      else if (project.statusId && statusId) void changeStatus(ctx, project, statusId);
      resetDrag();
      return;
    }
    if (project.statusId !== statusId) void changeStatus(ctx, project, statusId);
    resetDrag();
  };

  return (
    <div className={styles.kanban} role="list" aria-label="Kanban columns">
      {columns.map((status) => {
        const cards = cardsFor(status.id);
        return (
          <section
            key={status.id}
            className={styles.column}
            data-over={overColumn === status.id || undefined}
            aria-label={`${status.name}, ${cards.length} project${cards.length === 1 ? '' : 's'}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOverColumn(status.id);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setOverColumn((current) => (current === status.id ? null : current));
            }}
            onDrop={(event) => handleDrop(event, status.id)}
          >
            <header className={styles.columnHeader}>
              <h3 className={styles.columnTitle}>{status.name}</h3>
              <span className={styles.columnCount} aria-hidden="true">
                {cards.length}
              </span>
            </header>
            <div className={styles.columnBody}>
              {cards.length === 0 ? (
                <p className={styles.columnEmpty}>No projects</p>
              ) : (
                cards.map((project) => (
                  <article
                    key={project.id}
                    className={styles.kanbanCard}
                    data-archived={project.archived || undefined}
                    data-dragging={dragging?.id === project.id || undefined}
                    data-over-card={overCard === project.id || undefined}
                    draggable={ctx.canEdit}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', project.id);
                      event.dataTransfer.effectAllowed = 'move';
                      setDragging(project);
                    }}
                    onDragEnd={resetDrag}
                    onDragOver={(event) => {
                      if (!dragging || dragging.id === project.id) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setOverCard(project.id);
                    }}
                    onDragLeave={() => setOverCard((current) => (current === project.id ? null : current))}
                    onDrop={(event) => {
                      event.stopPropagation();
                      handleDrop(event, status.id, project);
                    }}
                  >
                    <div className={styles.cardTop}>
                      <Link href={`/p/${project.id}`} className={styles.cardTitle}>
                        {project.title}
                      </Link>
                      <ProjectActionsMenu
                        ctx={ctx}
                        project={project}
                        columnSiblings={cards}
                        allSiblings={ordered}
                      />
                    </div>
                    <ViewMeta project={project} fields={ctx.settings.view_fields.kanban} />
                    <div className={styles.cardMeta}>
                      <ArchivedBadge project={project} />
                      {project.inbox ? <Badge tone="warning">Inbox</Badge> : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Card                                                                      */
/* ------------------------------------------------------------------------- */

export function CardView({ ctx }: { ctx: CollectionViewContext }) {
  const ordered = orderedChildren(ctx.children);
  return (
    <ul className={styles.cardList} aria-label="Projects as cards">
      {ordered.map((project) => (
        <li key={project.id}>
          <article className={styles.projectCard} data-archived={project.archived || undefined}>
            <div className={styles.cardTop}>
              <Link href={`/p/${project.id}`} className={styles.cardTitle}>
                {project.title}
              </Link>
              <ProjectActionsMenu
                ctx={ctx}
                project={project}
                columnSiblings={ordered.filter((sibling) => sibling.statusId === project.statusId)}
                allSiblings={ordered}
              />
            </div>
            <ViewMeta project={project} fields={ctx.settings.view_fields.card} />
            <div className={styles.cardRow}>
              <StatusControl ctx={ctx} project={project} />
              {project.inbox && ctx.canEdit ? (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    void releaseInboxProject(project.id).then((result) => {
                      if (!result.ok) {
                        ctx.notify(result.message, 'error');
                        return;
                      }
                      ctx.notify(`Released “${project.title}” to the start status.`);
                      ctx.refresh();
                    });
                  }}
                >
                  Release to {project.statusName ?? 'the start status'}
                </Button>
              ) : null}
              <Link href={`/p/${project.id}`} className={styles.openLink}>
                <Icon name="open_in_new" size={18} />
                <span>Open</span>
              </Link>
              <ArchivedBadge project={project} />
              {project.inbox ? <Badge tone="warning">Inbox</Badge> : null}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------- */
/* Tree                                                                      */
/* ------------------------------------------------------------------------- */

export function TreeView({ ctx }: { ctx: CollectionViewContext }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Selection is independent of expansion state, so it survives expand/collapse.
  // The view unmounts when the collection view changes, which clears it.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState<'move' | 'trash' | null>(null);

  const byParent = useMemo(() => {
    const map = new Map<string, ProjectWithParent[]>();
    for (const project of ctx.descendants) {
      const parentId = project.parentId ?? ctx.projectId;
      const list = map.get(parentId) ?? [];
      list.push(project);
      map.set(parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.priority - b.priority);
    return map;
  }, [ctx.descendants, ctx.projectId]);

  const selectable = ctx.descendants.filter((project) => project.canAdmin);
  const selectableIds = new Set(selectable.map((project) => project.id));
  const selectedProjects = ctx.descendants.filter((project) => selected.has(project.id));
  const allSelected = selectable.length > 0 && selectable.every((project) => selected.has(project.id));
  const someSelected = selectable.some((project) => selected.has(project.id));

  const toggleSelection = (projectId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) {
        for (const id of selectableIds) next.delete(id);
      } else {
        for (const id of selectableIds) next.add(id);
      }
      return next;
    });
  };

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSiblings = orderedChildren(ctx.children);

  const renderRows = (parentId: string, depth: number): ReactElement[] => {
    const rows: ReactElement[] = [];
    for (const project of byParent.get(parentId) ?? []) {
      const hasChildren = (byParent.get(project.id) ?? []).length > 0;
      const isCollapsed = collapsed.has(project.id);
      rows.push(
        <tr
          key={project.id}
          className={styles.treeRow}
          data-archived={project.archived || undefined}
          draggable={ctx.canEdit && project.id !== ctx.projectId}
          onDragStart={(event) => {
            if ((event.target as HTMLElement).closest('[data-no-drag]')) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.setData('text/plain', project.id);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingId(project.id);
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            if (!draggingId || draggingId === project.id) return;
            event.preventDefault();
            setDropTarget(project.id);
          }}
          onDragLeave={() => setDropTarget((current) => (current === project.id ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData('text/plain') || draggingId;
            setDraggingId(null);
            setDropTarget(null);
            if (id && id !== project.id) ctx.openMoveDialog(id, project.id);
          }}
          data-drop={dropTarget === project.id || undefined}
        >
          {selectable.length > 0 ? (
            <td className={styles.treeSelectCell} data-no-drag>
              <Checkbox
                id={`tree-select-${project.id}`}
                label={<span className="visually-hidden">Select {project.title}</span>}
                checked={selected.has(project.id)}
                disabled={!project.canAdmin}
                title={project.canAdmin ? undefined : 'Only project Admins can bulk-edit this project'}
                onChange={(event) => toggleSelection(project.id, event.target.checked)}
              />
            </td>
          ) : null}
          <td className={styles.treeNameCell}>
            <div className={styles.treeName}>
              {Array.from({ length: depth }).map((_, index) => (
                <span key={index} className={styles.indentGuide} aria-hidden="true" />
              ))}
              {hasChildren ? (
                <button
                  type="button"
                  className={styles.chevronButton}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.title}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(project.id)}
                >
                  <Icon name={isCollapsed ? 'chevron_right' : 'expand_more'} size={18} />
                </button>
              ) : (
                <span className={styles.chevronSpacer} aria-hidden="true" />
              )}
              <Link href={`/p/${project.id}`} className={styles.treeTitle}>
                {project.title}
              </Link>
              <ArchivedBadge project={project} />
              {project.inbox ? <Badge tone="warning">Inbox</Badge> : null}
              <ViewMeta project={project} fields={ctx.settings.view_fields.tree} />
            </div>
          </td>
          <td className={styles.treeStatusCell}>
            <StatusControl ctx={ctx} project={project} label={`Status for ${project.title}`} />
          </td>
        </tr>,
      );
      if (hasChildren && !isCollapsed) rows.push(...renderRows(project.id, depth + 1));
    }
    return rows;
  };

  return (
    <div className={styles.treeWrap}>
      {selectedProjects.length > 0 ? (
        <div className={styles.bulkToolbar} role="region" aria-label="Bulk actions">
          <span className={styles.bulkCount}>
            {selectedProjects.length} selected
          </span>
          <Button size="sm" variant="quiet" onClick={() => setBulkDialog('move')}>
            Bulk move
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setBulkDialog('trash')}>
            Bulk trash
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}
      <table className={styles.treeTable}>
        <thead>
          <tr>
            {selectable.length > 0 ? (
              <th scope="col" className={styles.treeSelectHeader}>
                <Checkbox
                  id="tree-select-all"
                  ref={(node) => {
                    if (node) node.indeterminate = someSelected && !allSelected;
                  }}
                  label={<span className="visually-hidden">Select all loaded projects</span>}
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
            ) : null}
            <th scope="col">Project</th>
            <th scope="col" className={styles.treeStatusHeader}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>{renderRows(ctx.projectId, 0)}</tbody>
      </table>
      <p className={styles.hint}>
        Drag a project onto another row to move it. Select rows to move or trash several projects
        together; changes always ask for confirmation and explicit status mapping.
      </p>
      <p className="visually-hidden" aria-live="polite">
        {allSiblings.length} direct child project{allSiblings.length === 1 ? '' : 's'}.
        {selectedProjects.length > 0 ? ` ${selectedProjects.length} selected.` : ''}
      </p>

      <BulkMoveDialog
        open={bulkDialog === 'move'}
        projects={selectedProjects}
        onClose={() => setBulkDialog(null)}
        onMoved={(moved) => {
          ctx.notify(`Moved ${moved.length} project${moved.length === 1 ? '' : 's'}.`);
          setSelected(new Set());
          ctx.refresh();
        }}
      />
      <BulkTrashDialog
        open={bulkDialog === 'trash'}
        projects={selectedProjects}
        onClose={() => setBulkDialog(null)}
        onTrashed={(count) => {
          ctx.notify(`Moved ${count} project${count === 1 ? '' : 's'} to Trash.`);
          setSelected(new Set());
          ctx.refresh();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* List                                                                      */
/* ------------------------------------------------------------------------- */

export function ListView({ ctx }: { ctx: CollectionViewContext }) {
  const ordered = orderedChildren(ctx.children);
  const finish = ctx.statuses.find((status) => status.isFinish) ?? null;
  const start = ctx.statuses.find((status) => status.isStart) ?? null;

  const toggle = (project: ProjectCard, checked: boolean) => {
    const target = checked ? finish : start;
    if (!target) {
      ctx.notify('This workflow has no complete status.', 'error');
      return;
    }
    void changeStatus(ctx, project, target.id);
  };

  return (
    <ul className={styles.list} aria-label="Projects checklist">
      {ordered.map((project) => {
        const complete = finish !== null && project.statusId === finish.id;
        const disabled = !ctx.canEdit || !finish || !start;
        return (
          <li key={project.id} className={styles.listRow} data-archived={project.archived || undefined}>
            <Checkbox
              label={project.title}
              checked={complete}
              disabled={disabled}
              onChange={(event) => toggle(project, event.target.checked)}
            />
            <ViewMeta project={project} fields={ctx.settings.view_fields.list} />
            <span className={styles.listStatus}>{project.statusName ?? '—'}</span>
            <Link href={`/p/${project.id}`} className={styles.openLink}>
              <Icon name="open_in_new" size={18} />
              <span>Open</span>
            </Link>
            <ArchivedBadge project={project} />
          </li>
        );
      })}
    </ul>
  );
}

export function CollectionViewSwitch({ ctx }: { ctx: CollectionViewContext }) {
  switch (ctx.view) {
    case 'card':
      return <CardView ctx={ctx} />;
    case 'tree':
      return <TreeView ctx={ctx} />;
    case 'list':
      return <ListView ctx={ctx} />;
    case 'kanban':
    default:
      return <KanbanView ctx={ctx} />;
  }
}

/** Used by tests/other views to look up a status safely. */
export function statusFor(statuses: Status[], statusId: string | null): Status | undefined {
  return sameStatusColumn(statuses, statusId);
}
