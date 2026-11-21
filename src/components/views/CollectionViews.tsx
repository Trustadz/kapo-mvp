'use client';

import Link from 'next/link';
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, Checkbox, Icon, Menu, Select } from '@/components/ui';
import type { MenuItem } from '@/components/ui';
import type { Status } from '@/lib/types';
import type { ProjectCard, ProjectWithParent } from '@/components/projects/types';
import type { ViewFieldKey } from '@/lib/projects';
import { VIEW_FIELD_MESSAGE_KEYS } from '@/i18n/domain-labels';
import { useI18n, type I18nContextValue } from '@/i18n/client';
import { formatPersonName } from '@/lib/format';
import {
  dropZoneAt,
  insertionIndexAt,
  planIndexReorder,
  planSiblingReorder,
  priorityInsertionIndex,
  reorderEdgeAt,
  type DropZone,
  type ReorderEdge,
} from '@/lib/reorder';
import {
  KANBAN_LONG_PRESS_MS,
  autoscrollVelocity,
  isTouchLikePointer,
  movedBeyondTouchTolerance,
} from '@/lib/kanban-drag';
import {
  measureTouchRows,
  pointInRect,
  reorderTargetAt,
  touchDropTargetAt,
} from '@/lib/touch-drag';
import { useTouchDrag, type TouchDragPoint } from '@/lib/use-touch-drag';
import { TouchDragGhost } from '@/components/dnd/TouchDragGhost';
import { releaseInboxProject } from '@/components/projects/api';
import {
  reorderProjectRequest,
  updateProjectFields,
} from '@/components/projects/api';
import { BulkMoveDialog, BulkTrashDialog } from '@/components/projects/ProjectDialogs';
import { cancelFlipAnimations, useFlipReorder } from '@/lib/use-flip-reorder';
import type { CollectionViewContext } from './types';
import styles from './views.module.css';

/**
 * Collection views: Kanban, Card, Tree and List (product.md §5).
 *
 * Desktop drag and drop uses HTML5 DnD. Kanban: cross-column drops change only
 * the status (sibling priority is preserved), within-column drops rewrite
 * sibling priority. Card and Tree: dropping between two rows/cards reorders
 * siblings; dropping on a row/card opens the Move dialog to reparent the
 * project. List only reorders siblings. Reordering is always sibling-only
 * (issue #28); every action is also available from the keyboard-operable
 * "Move to…" menu where the view renders one.
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
  t: I18nContextValue['t'],
): Promise<void> {
  const status = ctx.statuses.find((entry) => entry.id === statusId);
  if (!status || status.id === project.statusId) return;
  const result = await updateProjectFields(project.id, { statusId });
  if (!result.ok) {
    ctx.notify(result.message, 'error');
    return;
  }
  ctx.notify(t('views.movedTo', { title: project.title, status: status.name }));
  ctx.refresh();
}

async function reorderBefore(
  ctx: CollectionViewContext,
  project: ProjectCard,
  beforeId: string | null,
  t: I18nContextValue['t'],
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
  ctx.notify(t('views.reordered', { title: project.title }));
  ctx.refresh();
}

/** Classify a drop against the bounds of the row/card that received it. */
function dropZoneForEvent(event: DragEvent<HTMLElement>): DropZone {
  const rect = event.currentTarget.getBoundingClientRect();
  return dropZoneAt(event.clientY, rect.top, rect.height);
}

interface ProjectActionsMenuProps {
  ctx: CollectionViewContext;
  project: ProjectCard;
  /** Projects the earlier/later actions step through (a Kanban column or siblings). */
  siblings: ProjectCard[];
  /**
   * Siblings in priority order. Used to place a card after its next sibling
   * when Move later runs at the end of a Kanban column (the next sibling may be
   * in another column).
   */
  allSiblings: ProjectCard[];
  /**
   * Reparenting requires project Admin rights, while reordering only needs
   * edit rights. Callers that know the per-row role (Tree) can hide Move to…
   * for editors; it defaults to the view's edit capability.
   */
  canReparent?: boolean;
}

/**
 * Keyboard/touch equivalent of the drag actions for one collection row/card:
 * status moves, Move earlier/later and Move to another project. The trigger is
 * a normal menu button, so every action is reachable without a pointer.
 */
export function ProjectActionsMenu({
  ctx,
  project,
  siblings,
  allSiblings,
  canReparent,
}: ProjectActionsMenuProps) {
  const { t } = useI18n();
  const columnIndex = siblings.findIndex((sibling) => sibling.id === project.id);
  const previousInColumn = columnIndex > 0 ? siblings[columnIndex - 1] : undefined;
  const nextInColumn =
    columnIndex >= 0 && columnIndex < siblings.length - 1
      ? siblings[columnIndex + 1]
      : undefined;

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
        label: t('views.moveToStatus', { status: status.name }),
        icon: 'swap_horiz',
        onSelect: () => {
          void changeStatus(ctx, project, status.id, t);
        },
      });
    }
    if (items.length > 0) items.push({ id: 'sep-status', separator: true });
    items.push({
      id: 'priority-earlier',
      label: t('views.moveEarlier'),
      icon: 'arrow_upward',
      disabled: !previousInColumn,
      onSelect: () => {
        if (previousInColumn) {
          void reorderBefore(ctx, project, previousInColumn.id, t);
        }
      },
    });
    items.push({
      id: 'priority-later',
      label: t('views.moveLater'),
      icon: 'arrow_downward',
      disabled: !nextInColumn,
      onSelect: () => {
        void reorderBefore(ctx, project, beforeSiblingForLater?.id ?? null, t);
      },
    });
    items.push({ id: 'sep-move', separator: true });
    if (canReparent ?? ctx.canEdit) {
      items.push({
        id: 'move-parent',
        label: t('views.moveToAnother'),
        icon: 'drive_file_move',
        onSelect: () => ctx.openMoveDialog(project.id),
      });
    }
    items.push({ id: 'sep-open', separator: true });
  }
  items.push({
    id: 'open',
    label: t('views.openProject'),
    icon: 'open_in_new',
    href: `/p/${project.id}`,
  });

  return (
    <Menu
      label={t('views.actionsFor', { title: project.title })}
      align="end"
      // Fixed positioning keeps the panel out of the Kanban grid's
      // `overflow-x: auto` clip box (issue #20); the shared Menu clamps it to
      // the viewport and repositions on scroll/resize.
      fixed
      trigger={({ ref, ...triggerProps }) => (
        <button
          {...triggerProps}
          ref={ref}
          type="button"
          className={styles.iconButton}
          aria-label={t('views.actionsFor', { title: project.title })}
          title={t('views.actionsFor', { title: project.title })}
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
  const { t } = useI18n();
  if (!ctx.canEdit) {
    return <span className={styles.readonlyStatus}>{project.statusName ?? '—'}</span>;
  }
  return (
    <Select
      className={styles.statusSelect}
      aria-label={label ?? t('views.statusFor', { title: project.title })}
      value={project.statusId ?? ''}
      onChange={(event) => {
        const value = event.target.value;
        void changeStatus(ctx, project, value, t);
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
  t: I18nContextValue['t'],
  formatDate: I18nContextValue['formatDate'],
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
      case 'created':
        value = formatDate(project.createdAt);
        break;
      case 'id':
        value = project.displayId;
        break;
      default:
        value = null;
    }
    if (value) parts.push(`${t(VIEW_FIELD_MESSAGE_KEYS[field])}: ${value}`);
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
  const { t, formatDate } = useI18n();
  const parts = viewMetaParts(project, fields, t, formatDate);
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
  const { t } = useI18n();
  return project.archived ? (
    <Badge tone="archived">{t('common.archived')}</Badge>
  ) : null;
}

/* ------------------------------------------------------------------------- */
/* Kanban                                                                    */
/* ------------------------------------------------------------------------- */

interface KanbanDropTarget {
  statusId: string;
  /** Insertion slot in the column, 0..cards.length. */
  index: number;
}

interface KanbanPointerDrag {
  pointerId: number;
  project: ProjectCard;
  x: number;
  y: number;
  /** Autoscroll waits for the first move so a long press near an edge is still. */
  moved: boolean;
}

interface KanbanPendingPress {
  pointerId: number;
  project: ProjectCard;
  startX: number;
  startY: number;
  timer: number;
}

/** The gap that reserves the landing position (issue #25). */
function KanbanPlaceholder() {
  return (
    <div
      className={styles.kanbanPlaceholder}
      data-kanban-placeholder=""
      aria-hidden="true"
    />
  );
}

export function KanbanView({ ctx }: { ctx: CollectionViewContext }) {
  const { t, plural } = useI18n();
  const [dragging, setDragging] = useState<ProjectCard | null>(null);
  const [dropTarget, setDropTarget] = useState<KanbanDropTarget | null>(null);
  const [pendingPressId, setPendingPressId] = useState<string | null>(null);
  const [pointerDrag, setPointerDrag] = useState<KanbanPointerDrag | null>(null);
  const pointerDragRef = useRef<KanbanPointerDrag | null>(null);
  const pendingPressRef = useRef<KanbanPendingPress | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const hidden = new Set(ctx.settings.hidden_statuses);
  const visibleStatuses = sortStatuses(ctx.statuses).filter((status) => !hidden.has(status.id));
  const columns = visibleStatuses.length > 0 ? visibleStatuses : sortStatuses(ctx.statuses);
  const ordered = orderedChildren(ctx.children);

  const cardsFor = (statusId: string) =>
    ordered.filter((project) => project.statusId === statusId);

  // Issue #56: one signature per column so a cross-column status move also
  // reads as an order change for the FLIP helper.
  const flipSignature = columns
    .map((status) => `${status.id}:${cardsFor(status.id).map((card) => card.id).join('.')}`)
    .join('|');
  useFlipReorder(scrollerRef, flipSignature, dragging === null);

  const resetDrag = () => {
    const pending = pendingPressRef.current;
    if (pending) window.clearTimeout(pending.timer);
    pendingPressRef.current = null;
    pointerDragRef.current = null;
    setPendingPressId(null);
    setPointerDrag(null);
    setDragging(null);
    setDropTarget(null);
  };

  const clearPendingPress = () => {
    const pending = pendingPressRef.current;
    if (pending) window.clearTimeout(pending.timer);
    pendingPressRef.current = null;
    setPendingPressId(null);
  };

  /**
   * Classify the pointer against one column. Cards are measured from the DOM so
   * the same rule works for HTML5 drag events and pointer drags. The dragged
   * card is excluded: the gap describes the list after the move.
   */
  const targetAt = (
    clientY: number,
    statusId: string,
    column: HTMLElement,
    project: ProjectCard,
  ): KanbanDropTarget => {
    const cards = cardsFor(statusId);
    if (project.statusId !== statusId) {
      // Cross-column drops change status only, so priority decides the landing
      // slot; previewing the pointer slot would promise a reorder that the API
      // intentionally does not perform.
      return { statusId, index: priorityInsertionIndex(cards, project.priority) };
    }
    const bounds = Array.from(
      column.querySelectorAll<HTMLElement>('[data-kanban-card-id]'),
    )
      .filter((element) => element.dataset.kanbanCardId !== project.id)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      });
    return { statusId, index: insertionIndexAt(clientY, bounds) };
  };

  /** Resolve a viewport point to the column and slot under a touch pointer. */
  const pointerTargetAt = (
    clientX: number,
    clientY: number,
    project: ProjectCard,
  ): KanbanDropTarget | null => {
    if (typeof document === 'undefined') return null;
    const element = document.elementFromPoint(clientX, clientY);
    const column = element?.closest<HTMLElement>('[data-kanban-status-id]');
    const statusId = column?.dataset.kanbanStatusId;
    if (!column || !statusId) return null;
    return targetAt(clientY, statusId, column, project);
  };

  const updatePointerTarget = (x: number, y: number, project: ProjectCard): void => {
    const next = pointerTargetAt(x, y, project);
    setDropTarget((current) => {
      if (!next) return current === null ? current : null;
      return current?.statusId === next.statusId && current.index === next.index
        ? current
        : next;
    });
  };

  const finishDrop = (project: ProjectCard, target: KanbanDropTarget): void => {
    if (project.statusId !== target.statusId) {
      void changeStatus(ctx, project, target.statusId, t);
      return;
    }
    const plan = planIndexReorder(
      cardsFor(target.statusId).map((card) => card.id),
      project.id,
      target.index,
    );
    if (plan) void reorderBefore(ctx, project, plan.beforeId, t);
  };

  /** Finish the active pointer drag exactly once, from the latest position. */
  const completePointerDrag = (
    clientX: number,
    clientY: number,
    pointerId: number,
  ): void => {
    const current = pointerDragRef.current;
    if (!current || current.pointerId !== pointerId) return;
    const target = pointerTargetAt(clientX, clientY, current.project);
    const project = current.project;
    resetDrag();
    if (target) finishDrop(project, target);
  };

  const cancelPointerDrag = (pointerId: number): void => {
    if (pointerDragRef.current?.pointerId === pointerId) resetDrag();
  };

  const handleDrop = (event: DragEvent<HTMLElement>, statusId: string): void => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || dragging?.id;
    const project = ordered.find((candidate) => candidate.id === id) ?? null;
    if (!project) {
      resetDrag();
      return;
    }
    const target = targetAt(event.clientY, statusId, event.currentTarget, project);
    resetDrag();
    finishDrop(project, target);
  };

  /**
   * Arm the long-press gesture. Deliberately does not preventDefault: until the
   * press activates, the browser must still be able to scroll the page/strip.
   */
  const startPointerPress = (
    event: ReactPointerEvent<HTMLElement>,
    project: ProjectCard,
  ): void => {
    if (!ctx.canEdit || !isTouchLikePointer(event.pointerType)) return;
    if (event.button !== 0) return;
    if (typeof window === 'undefined' || !('PointerEvent' in window)) return;
    if (dragging || pendingPressRef.current || pointerDragRef.current) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('a, button, select, input, textarea, [data-no-drag]')) return;
    cancelFlipAnimations();

    const { pointerId, clientX, clientY } = event;
    const element = event.currentTarget;
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Synthetic events and older browsers may not allow capture; the window
      // listeners below still receive the bubbled moves.
    }
    const timer = window.setTimeout(() => {
      const pending = pendingPressRef.current;
      if (!pending || pending.pointerId !== pointerId) return;
      pendingPressRef.current = null;
      setPendingPressId(null);
      const next: KanbanPointerDrag = {
        pointerId,
        project,
        x: clientX,
        y: clientY,
        moved: false,
      };
      pointerDragRef.current = next;
      setPointerDrag(next);
      setDragging(project);
      setDropTarget(null);
      updatePointerTarget(clientX, clientY, project);
    }, KANBAN_LONG_PRESS_MS);
    pendingPressRef.current = {
      pointerId,
      project,
      startX: clientX,
      startY: clientY,
      timer,
    };
    setPendingPressId(project.id);
  };

  // Clear a pending timer if the view unmounts mid-press.
  useEffect(
    () => () => {
      const pending = pendingPressRef.current;
      if (pending) window.clearTimeout(pending.timer);
      pendingPressRef.current = null;
      pointerDragRef.current = null;
    },
    [],
  );

  // Before activation, movement means the user is scrolling, not dragging.
  useEffect(() => {
    if (!pendingPressId) return;
    const onMove = (event: PointerEvent) => {
      const pending = pendingPressRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      if (
        movedBeyondTouchTolerance(
          pending.startX,
          pending.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        clearPendingPress();
      }
    };
    const onEnd = (event: PointerEvent) => {
      if (pendingPressRef.current?.pointerId === event.pointerId) clearPendingPress();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearPendingPress();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pendingPressId]);

  // Active pointer drag: track the finger, block scrolling, finish or cancel.
  const activePointerId = pointerDrag?.pointerId;
  useEffect(() => {
    if (activePointerId === undefined) return;
    const onMove = (event: PointerEvent) => {
      const current = pointerDragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      const next: KanbanPointerDrag = {
        ...current,
        x: event.clientX,
        y: event.clientY,
        moved: true,
      };
      pointerDragRef.current = next;
      setPointerDrag(next);
      updatePointerTarget(next.x, next.y, next.project);
    };
    const onUp = (event: PointerEvent) =>
      completePointerDrag(event.clientX, event.clientY, event.pointerId);
    const onCancel = (event: PointerEvent) => cancelPointerDrag(event.pointerId);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      resetDrag();
    };
    const stopTouchScroll = (event: TouchEvent) => event.preventDefault();
    const stopContextMenu = (event: MouseEvent) => event.preventDefault();
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('touchmove', stopTouchScroll, { passive: false });
    document.addEventListener('contextmenu', stopContextMenu, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('touchmove', stopTouchScroll);
      document.removeEventListener('contextmenu', stopContextMenu, true);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [activePointerId]);

  // Horizontal autoscroll while the finger is parked near a strip edge.
  useEffect(() => {
    if (activePointerId === undefined) return;
    let frame = 0;
    const tick = () => {
      const scroller = scrollerRef.current;
      const current = pointerDragRef.current;
      if (scroller && current?.moved) {
        const rect = scroller.getBoundingClientRect();
        const delta = autoscrollVelocity(current.x, rect.left, rect.right);
        if (delta !== 0) {
          const previous = scroller.scrollLeft;
          scroller.scrollLeft = previous + delta;
          if (scroller.scrollLeft !== previous) {
            updatePointerTarget(current.x, current.y, current.project);
          }
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [activePointerId]);

  return (
    <>
      <div
        ref={scrollerRef}
        className={styles.kanban}
        role="list"
        aria-label={t('views.kanbanColumnsAria')}
        aria-describedby={ctx.canEdit ? 'kanban-drag-hint' : undefined}
        data-kanban-scroller=""
        data-pointer-drag={pointerDrag ? '' : undefined}
      >
        {columns.map((status) => {
          const cards = cardsFor(status.id);
          const activeTarget = dropTarget?.statusId === status.id ? dropTarget : null;
          const remainingCards = dragging
            ? cards.filter((card) => card.id !== dragging.id)
            : cards;
          const remainingIndex = new Map(
            remainingCards.map((card, index) => [card.id, index]),
          );
          let gapIndex: number | null = null;
          if (activeTarget && dragging) {
            if (dragging.statusId !== status.id) {
              gapIndex = Math.min(activeTarget.index, remainingCards.length);
            } else {
              const plan = planIndexReorder(
                cards.map((card) => card.id),
                dragging.id,
                activeTarget.index,
              );
              // No gap for a no-op (e.g. hovering the dragged card's own slot).
              if (plan) gapIndex = plan.index;
            }
          }

          return (
            <section
              key={status.id}
              className={styles.column}
              data-over={activeTarget ? '' : undefined}
              data-kanban-status-id={status.id}
              aria-label={plural('plurals.columnCount', cards.length, {
                status: status.name,
              })}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (!dragging) return;
                const next = targetAt(
                  event.clientY,
                  status.id,
                  event.currentTarget,
                  dragging,
                );
                setDropTarget((current) =>
                  current?.statusId === next.statusId && current.index === next.index
                    ? current
                    : next,
                );
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setDropTarget((current) =>
                  current?.statusId === status.id ? null : current,
                );
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
                  gapIndex === 0 ? (
                    <KanbanPlaceholder />
                  ) : (
                    <p className={styles.columnEmpty}>{t('views.noProjects')}</p>
                  )
                ) : (
                  <>
                    {cards.map((project) => (
                      <Fragment key={project.id}>
                        {gapIndex !== null &&
                        remainingIndex.get(project.id) === gapIndex ? (
                          <KanbanPlaceholder />
                        ) : null}
                        <article
                          className={styles.kanbanCard}
                          data-archived={project.archived || undefined}
                          data-dragging={dragging?.id === project.id || undefined}
                          data-pressing={pendingPressId === project.id || undefined}
                          data-kanban-card-id={project.id}
                          data-flip-key={project.id}
                          draggable={ctx.canEdit}
                          onPointerDown={(event) => startPointerPress(event, project)}
                          onPointerMove={(event) => {
                            const pending = pendingPressRef.current;
                            if (!pending || pending.pointerId !== event.pointerId) return;
                            if (
                              movedBeyondTouchTolerance(
                                pending.startX,
                                pending.startY,
                                event.clientX,
                                event.clientY,
                              )
                            ) {
                              clearPendingPress();
                            }
                          }}
                          onPointerUp={(event) => {
                            if (pendingPressRef.current?.pointerId === event.pointerId) {
                              clearPendingPress();
                              return;
                            }
                            completePointerDrag(
                              event.clientX,
                              event.clientY,
                              event.pointerId,
                            );
                          }}
                          onPointerCancel={(event) => {
                            if (pendingPressRef.current?.pointerId === event.pointerId) {
                              clearPendingPress();
                              return;
                            }
                            cancelPointerDrag(event.pointerId);
                          }}
                          onContextMenu={(event) => {
                            if (
                              pendingPressRef.current?.project.id === project.id ||
                              pointerDragRef.current?.project.id === project.id
                            ) {
                              event.preventDefault();
                            }
                          }}
                          onDragStart={(event) => {
                            if (pointerDragRef.current) {
                              event.preventDefault();
                              return;
                            }
                            cancelFlipAnimations();
                            event.dataTransfer.setData('text/plain', project.id);
                            event.dataTransfer.effectAllowed = 'move';
                            clearPendingPress();
                            setDragging(project);
                            setDropTarget(null);
                          }}
                          onDragEnd={resetDrag}
                        >
                          <div className={styles.cardTop}>
                            <Link href={`/p/${project.id}`} className={styles.cardTitle}>
                              {project.title}
                            </Link>
                            <ProjectActionsMenu
                              ctx={ctx}
                              project={project}
                              siblings={cards}
                              allSiblings={ordered}
                            />
                          </div>
                          <ViewMeta
                            project={project}
                            fields={ctx.settings.view_fields.kanban}
                          />
                          <div className={styles.cardMeta}>
                            <ArchivedBadge project={project} />
                            {project.inbox ? (
                              <Badge tone="warning">{t('common.inboxBadge')}</Badge>
                            ) : null}
                          </div>
                        </article>
                      </Fragment>
                    ))}
                    {gapIndex === remainingCards.length ? <KanbanPlaceholder /> : null}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {pointerDrag && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={styles.kanbanGhost}
              data-kanban-ghost=""
              aria-hidden="true"
              style={{
                transform: `translate3d(${pointerDrag.x + 14}px, ${pointerDrag.y + 14}px, 0)`,
              }}
            >
              {pointerDrag.project.title}
            </div>,
            document.body,
          )
        : null}
      {ctx.canEdit ? (
        <p className={styles.hint} id="kanban-drag-hint">
          {t('views.kanbanHint')}
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Card                                                                      */
/* ------------------------------------------------------------------------- */

export function CardView({ ctx }: { ctx: CollectionViewContext }) {
  const { t } = useI18n();
  const ordered = orderedChildren(ctx.children);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  useFlipReorder(
    listRef,
    ordered.map((project) => project.id).join('|'),
    draggingId === null,
  );

  const resetDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  /** Shared by HTML5 and touch drops so both paths keep identical semantics. */
  const applyCardDrop = (id: string, targetId: string, zone: DropZone): void => {
    if (!id || id === targetId) return;
    const dragged = ordered.find((candidate) => candidate.id === id);
    if (!dragged) return;
    // Drop on the card body = make it a child (explicit move + status mapping).
    if (zone === 'inside') {
      ctx.openMoveDialog(id, targetId);
      return;
    }
    // Drop on an edge = sibling reorder. Cards are direct children of this page,
    // so the dragged project is always a sibling of the target.
    const plan = planSiblingReorder(
      ordered.map((sibling) => sibling.id),
      id,
      targetId,
      zone,
    );
    if (!plan) return;
    void reorderBefore(ctx, dragged, plan.beforeId, t);
  };

  const resolveTouchTarget = (
    x: number,
    y: number,
    draggedId: string,
  ): { id: string; zone: DropZone } | null => {
    const list = listRef.current;
    if (!list || !pointInRect(x, y, list.getBoundingClientRect())) return null;
    return touchDropTargetAt(y, measureTouchRows(list, draggedId));
  };

  const updateTouchTarget = (project: ProjectCard, point: TouchDragPoint): void => {
    const next = resolveTouchTarget(point.x, point.y, project.id);
    setDropTarget((current) =>
      current?.id === next?.id && current?.zone === next?.zone ? current : next,
    );
  };

  const touchDrag = useTouchDrag<ProjectCard>({
    enabled: ctx.canEdit,
    onDragStart: (project, point) => {
      setDraggingId(project.id);
      setDropTarget(null);
      updateTouchTarget(project, point);
    },
    onDragMove: updateTouchTarget,
    onDrop: (project, point) => {
      const target = resolveTouchTarget(point.x, point.y, project.id);
      resetDrag();
      if (target) applyCardDrop(project.id, target.id, target.zone);
    },
    onCancel: resetDrag,
  });

  const handleDragOver = (event: DragEvent<HTMLElement>, project: ProjectCard) => {
    if (!draggingId || draggingId === project.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const zone = dropZoneForEvent(event);
    setDropTarget((current) =>
      current?.id === project.id && current.zone === zone ? current : { id: project.id, zone },
    );
  };

  const handleDrop = (event: DragEvent<HTMLElement>, project: ProjectCard) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || draggingId;
    const zone = dropZoneForEvent(event);
    resetDrag();
    if (id) applyCardDrop(id, project.id, zone);
  };

  return (
    <>
      <ul
        ref={listRef}
        className={styles.cardList}
        aria-label={t('views.cardListAria')}
        aria-describedby={ctx.canEdit ? 'card-drag-hint' : undefined}
      >
        {ordered.map((project) => (
          <li key={project.id} data-flip-key={project.id}>
            <article
              className={styles.projectCard}
              data-archived={project.archived || undefined}
              data-dragging={draggingId === project.id || undefined}
              data-pressing={touchDrag.pending?.payload.id === project.id || undefined}
              data-drop={dropTarget?.id === project.id ? dropTarget.zone : undefined}
              data-touch-id={project.id}
              data-touch-target=""
              draggable={ctx.canEdit}
              onPointerDown={(event) => touchDrag.start(event, project)}
              onPointerMove={touchDrag.handlePointerMove}
              onPointerUp={touchDrag.handlePointerUp}
              onPointerCancel={touchDrag.handlePointerCancel}
              onContextMenu={touchDrag.handleContextMenu}
              onDragStart={(event) => {
                cancelFlipAnimations();
                event.dataTransfer.setData('text/plain', project.id);
                event.dataTransfer.effectAllowed = 'move';
                setDraggingId(project.id);
              }}
              onDragEnd={resetDrag}
              onDragOver={(event) => handleDragOver(event, project)}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setDropTarget((current) => (current?.id === project.id ? null : current));
              }}
              onDrop={(event) => handleDrop(event, project)}
            >
              <div className={styles.cardTop}>
                <Link
                  href={`/p/${project.id}`}
                  className={styles.cardTitle}
                  draggable={false}
                >
                  {project.title}
                </Link>
                <ProjectActionsMenu
                  ctx={ctx}
                  project={project}
                  siblings={ordered}
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
                        ctx.notify(t('views.released', { title: project.title }));
                        ctx.refresh();
                      });
                    }}
                  >
                    {t('views.releaseTo', {
                      status: project.statusName ?? t('inbox.startStatus'),
                    })}
                  </Button>
                ) : null}
                <Link
                  href={`/p/${project.id}`}
                  className={styles.openLink}
                  draggable={false}
                >
                  <Icon name="open_in_new" size={18} />
                  <span>{t('views.open')}</span>
                </Link>
                <ArchivedBadge project={project} />
                {project.inbox ? (
                              <Badge tone="warning">{t('common.inboxBadge')}</Badge>
                            ) : null}
              </div>
            </article>
          </li>
        ))}
      </ul>
      {ctx.canEdit ? (
        <p className={styles.hint} id="card-drag-hint">
          {t('views.cardHint')}
        </p>
      ) : null}
      {touchDrag.active ? (
        <TouchDragGhost
          x={touchDrag.active.x}
          y={touchDrag.active.y}
          label={touchDrag.active.payload.title}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Tree                                                                      */
/* ------------------------------------------------------------------------- */

export function TreeView({ ctx }: { ctx: CollectionViewContext }) {
  const { t, plural } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  // Selection is independent of expansion state, so it survives expand/collapse.
  // The view unmounts when the collection view changes, which clears it.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState<'move' | 'trash' | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  // Filtered Tree rows that are ancestors of matches: they keep the structure
  // visible but are read-only context (issue #55).
  const isContext = (projectId: string) => ctx.contextIds?.has(projectId) ?? false;

  const resetDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

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

  const selectable = ctx.descendants.filter(
    (project) => project.canAdmin && !isContext(project.id),
  );
  const selectableIds = new Set(selectable.map((project) => project.id));
  const selectedProjects = ctx.descendants.filter(
    (project) => selected.has(project.id) && !isContext(project.id),
  );
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
  // Flattened row order in render order, used as the FLIP signature.
  const rowOrder: string[] = [];

  /** Shared by HTML5 and touch drops so both paths keep identical semantics. */
  const applyTreeDrop = (
    id: string,
    targetId: string,
    zone: DropZone,
  ): void => {
    if (!id || id === targetId) return;
    // Middle of the row keeps the existing behaviour: reparent onto it.
    if (zone === 'inside') {
      ctx.openMoveDialog(id, targetId);
      return;
    }
    const dragged = ctx.descendants.find((candidate) => candidate.id === id);
    const target = ctx.descendants.find((candidate) => candidate.id === targetId);
    if (!dragged || !target) return;
    const draggedParentId = dragged.parentId ?? ctx.projectId;
    const targetParentId = target.parentId ?? ctx.projectId;
    if (targetParentId === id) return;
    if (draggedParentId !== targetParentId) {
      // Reordering is sibling-only. Dropping between rows of another parent
      // opens the Move dialog for that parent instead of inventing a
      // cross-parent order.
      ctx.openMoveDialog(id, targetParentId);
      return;
    }
    const siblingIds = (byParent.get(targetParentId) ?? []).map(
      (sibling) => sibling.id,
    );
    const plan = planSiblingReorder(siblingIds, id, targetId, zone);
    if (!plan) return;
    void reorderBefore(ctx, dragged, plan.beforeId, t);
  };

  const resolveTouchTarget = (
    x: number,
    y: number,
    draggedId: string,
  ): { id: string; zone: DropZone } | null => {
    const tbody = tbodyRef.current;
    if (!tbody || !pointInRect(x, y, tbody.getBoundingClientRect())) return null;
    return touchDropTargetAt(y, measureTouchRows(tbody, draggedId));
  };

  const updateTouchTarget = (
    project: ProjectWithParent,
    point: TouchDragPoint,
  ): void => {
    const next = resolveTouchTarget(point.x, point.y, project.id);
    setDropTarget((current) =>
      current?.id === next?.id && current?.zone === next?.zone ? current : next,
    );
  };

  const touchDrag = useTouchDrag<ProjectWithParent>({
    enabled: ctx.canEdit,
    canStart: (_event, project) =>
      project.id !== ctx.projectId && !isContext(project.id),
    onDragStart: (project, point) => {
      setDraggingId(project.id);
      setDropTarget(null);
      updateTouchTarget(project, point);
    },
    onDragMove: updateTouchTarget,
    onDrop: (project, point) => {
      const target = resolveTouchTarget(point.x, point.y, project.id);
      resetDrag();
      if (target) applyTreeDrop(project.id, target.id, target.zone);
    },
    onCancel: resetDrag,
  });

  const renderRows = (parentId: string, depth: number): ReactElement[] => {
    const rows: ReactElement[] = [];
    for (const project of byParent.get(parentId) ?? []) {
      const hasChildren = (byParent.get(project.id) ?? []).length > 0;
      const isCollapsed = collapsed.has(project.id);
      const contextRow = isContext(project.id);
      const siblings = byParent.get(project.parentId ?? ctx.projectId) ?? [];
      rowOrder.push(project.id);
      rows.push(
        <tr
          key={project.id}
          className={styles.treeRow}
          data-flip-key={project.id}
          data-archived={project.archived || undefined}
          data-context={contextRow || undefined}
          data-touch-id={project.id}
          data-touch-target={contextRow ? undefined : ''}
          data-pressing={touchDrag.pending?.payload.id === project.id || undefined}
          aria-describedby={
            ctx.canEdit && project.id !== ctx.projectId && !contextRow
              ? 'tree-drag-hint'
              : undefined
          }
          draggable={ctx.canEdit && project.id !== ctx.projectId && !contextRow}
          onPointerDown={(event) => touchDrag.start(event, project)}
          onPointerMove={touchDrag.handlePointerMove}
          onPointerUp={touchDrag.handlePointerUp}
          onPointerCancel={touchDrag.handlePointerCancel}
          onContextMenu={touchDrag.handleContextMenu}
          onDragStart={(event) => {
            if (contextRow || (event.target as HTMLElement).closest('[data-no-drag]')) {
              event.preventDefault();
              return;
            }
            cancelFlipAnimations();
            event.dataTransfer.setData('text/plain', project.id);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingId(project.id);
          }}
          onDragEnd={resetDrag}
          onDragOver={(event) => {
            if (contextRow || !draggingId || draggingId === project.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const zone = dropZoneForEvent(event);
            setDropTarget((current) =>
              current?.id === project.id && current.zone === zone
                ? current
                : { id: project.id, zone },
            );
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDropTarget((current) => (current?.id === project.id ? null : current));
          }}
          onDrop={(event) => {
            if (contextRow) {
              resetDrag();
              return;
            }
            event.preventDefault();
            const id = event.dataTransfer.getData('text/plain') || draggingId;
            const zone = dropZoneForEvent(event);
            resetDrag();
            if (id) applyTreeDrop(id, project.id, zone);
          }}
          data-drop={dropTarget?.id === project.id ? dropTarget.zone : undefined}
        >
          {selectable.length > 0 ? (
            <td className={styles.treeSelectCell} data-no-drag>
              <Checkbox
                id={`tree-select-${project.id}`}
                label={
                  <span className="visually-hidden">
                    {t('views.selectProject', { title: project.title })}
                  </span>
                }
                checked={selected.has(project.id)}
                disabled={!project.canAdmin || contextRow}
                title={
                  contextRow
                    ? t('views.contextOnly')
                    : project.canAdmin
                      ? undefined
                      : t('views.adminOnly')
                }
                onChange={(event) => toggleSelection(project.id, event.target.checked)}
              />
            </td>
          ) : null}
          <th scope="row" className={styles.treeNameCell}>
            <div className={styles.treeName}>
              {Array.from({ length: depth }).map((_, index) => (
                <span key={index} className={styles.indentGuide} aria-hidden="true" />
              ))}
              {hasChildren ? (
                <button
                  type="button"
                  className={styles.chevronButton}
                  aria-label={
                    isCollapsed
                      ? t('common.expandName', { title: project.title })
                      : t('common.collapseName', { title: project.title })
                  }
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(project.id)}
                >
                  <Icon name={isCollapsed ? 'chevron_right' : 'expand_more'} size={18} />
                </button>
              ) : (
                <span className={styles.chevronSpacer} aria-hidden="true" />
              )}
              <Link
                href={`/p/${project.id}`}
                className={styles.treeTitle}
                draggable={false}
              >
                {project.title}
              </Link>
              {contextRow ? (
                <Badge tone="neutral">{t('common.context')}</Badge>
              ) : null}
              <ArchivedBadge project={project} />
              {project.inbox ? (
                              <Badge tone="warning">{t('common.inboxBadge')}</Badge>
                            ) : null}
              <ViewMeta project={project} fields={ctx.settings.view_fields.tree} />
            </div>
          </th>
          <td className={styles.treeStatusCell}>
            {contextRow ? (
              <span className={styles.readonlyStatus}>{project.statusName ?? '—'}</span>
            ) : (
              <StatusControl
                ctx={ctx}
                project={project}
                label={t('views.statusFor', { title: project.title })}
              />
            )}
          </td>
          {ctx.canEdit ? (
            <td className={styles.treeActionCell}>
              {contextRow ? null : (
                <span data-no-drag="">
                  <ProjectActionsMenu
                    ctx={ctx}
                    project={project}
                    siblings={siblings}
                    allSiblings={siblings}
                    canReparent={Boolean(project.canAdmin)}
                  />
                </span>
              )}
            </td>
          ) : null}
        </tr>,
      );
      if (hasChildren && !isCollapsed) rows.push(...renderRows(project.id, depth + 1));
    }
    return rows;
  };

  const rows = renderRows(ctx.projectId, 0);
  useFlipReorder(tbodyRef, rowOrder.join('|'), draggingId === null);

  return (
    <>
      <div className={styles.treeWrap}>
        {selectedProjects.length > 0 ? (
          <div className={styles.bulkToolbar} role="region" aria-label={t('views.bulkActions')}>
            <span className={styles.bulkCount}>
              {t('views.selectedCount', { count: selectedProjects.length })}
            </span>
            <Button size="sm" variant="quiet" onClick={() => setBulkDialog('move')}>
              {t('views.bulkMove')}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setBulkDialog('trash')}>
              {t('views.bulkTrash')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t('common.clear')}
            </Button>
          </div>
        ) : null}
        <table
          className={styles.treeTable}
          aria-label={t('views.treeTableAria')}
          aria-describedby="tree-drag-hint"
        >
          <caption className="visually-hidden">
            {t('views.treeCaption')}
          </caption>
          <thead>
            <tr>
              {selectable.length > 0 ? (
                <th scope="col" className={styles.treeSelectHeader}>
                  <Checkbox
                    id="tree-select-all"
                    ref={(node) => {
                      if (node) node.indeterminate = someSelected && !allSelected;
                    }}
                    label={
                      <span className="visually-hidden">{t('views.selectAll')}</span>
                    }
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
              ) : null}
              <th scope="col">{t('views.columnProject')}</th>
              <th scope="col" className={styles.treeStatusHeader}>
                {t('views.columnStatus')}
              </th>
              {ctx.canEdit ? (
                <th scope="col" className={styles.treeActionHeader}>
                  <span className="visually-hidden">{t('views.columnActions')}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody ref={tbodyRef}>{rows}</tbody>
        </table>
        <p className={styles.hint} id="tree-drag-hint">
          {t('views.treeHint')}
        </p>
        {ctx.contextIds && ctx.contextIds.size > 0 ? (
          <p className={styles.hint}>
            {t('views.treeContextHint')}
          </p>
        ) : null}
        <p className="visually-hidden" aria-live="polite">
          {plural('plurals.directChildren', allSiblings.length)}
          {selectedProjects.length > 0
            ? ` ${t('views.selectedCount', { count: selectedProjects.length })}.`
            : ''}
        </p>

        <BulkMoveDialog
          open={bulkDialog === 'move'}
          projects={selectedProjects}
          onClose={() => setBulkDialog(null)}
          onMoved={(moved) => {
            ctx.notify(plural('plurals.movedCount', moved.length));
            setSelected(new Set());
            ctx.refresh();
          }}
        />
        <BulkTrashDialog
          open={bulkDialog === 'trash'}
          projects={selectedProjects}
          onClose={() => setBulkDialog(null)}
          onTrashed={(count) => {
            ctx.notify(plural('plurals.trashedCount', count));
            setSelected(new Set());
            ctx.refresh();
          }}
        />
      </div>
      {touchDrag.active ? (
        <TouchDragGhost
          x={touchDrag.active.x}
          y={touchDrag.active.y}
          label={touchDrag.active.payload.title}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* List                                                                      */
/* ------------------------------------------------------------------------- */

export function ListView({ ctx }: { ctx: CollectionViewContext }) {
  const { t } = useI18n();
  const ordered = orderedChildren(ctx.children);
  const finish = ctx.statuses.find((status) => status.isFinish) ?? null;
  const start = ctx.statuses.find((status) => status.isStart) ?? null;
  const listRef = useRef<HTMLUListElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: ReorderEdge } | null>(null);
  useFlipReorder(
    listRef,
    ordered.map((project) => project.id).join('|'),
    draggingId === null,
  );

  const resetDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  /** Shared by HTML5 and touch drops so both paths keep identical semantics. */
  const applyListDrop = (
    id: string,
    targetId: string,
    edge: ReorderEdge,
  ): void => {
    if (!id || id === targetId) return;
    const dragged = ordered.find((candidate) => candidate.id === id);
    if (!dragged) return;
    const plan = planSiblingReorder(
      ordered.map((sibling) => sibling.id),
      id,
      targetId,
      edge,
    );
    if (!plan) return;
    void reorderBefore(ctx, dragged, plan.beforeId, t);
  };

  const resolveTouchTarget = (
    x: number,
    y: number,
    draggedId: string,
  ): { id: string; edge: ReorderEdge } | null => {
    const list = listRef.current;
    if (!list || !pointInRect(x, y, list.getBoundingClientRect())) return null;
    return reorderTargetAt(y, measureTouchRows(list, draggedId));
  };

  const updateTouchTarget = (project: ProjectCard, point: TouchDragPoint): void => {
    const next = resolveTouchTarget(point.x, point.y, project.id);
    setDropTarget((current) =>
      current?.id === next?.id && current?.edge === next?.edge ? current : next,
    );
  };

  const touchDrag = useTouchDrag<ProjectCard>({
    enabled: ctx.canEdit,
    onDragStart: (project, point) => {
      setDraggingId(project.id);
      setDropTarget(null);
      updateTouchTarget(project, point);
    },
    onDragMove: updateTouchTarget,
    onDrop: (project, point) => {
      const target = resolveTouchTarget(point.x, point.y, project.id);
      resetDrag();
      if (target) applyListDrop(project.id, target.id, target.edge);
    },
    onCancel: resetDrag,
  });

  const toggle = (project: ProjectCard, checked: boolean) => {
    const target = checked ? finish : start;
    if (!target) {
      ctx.notify(t('views.noCompleteStatus'), 'error');
      return;
    }
    void changeStatus(ctx, project, target.id, t);
  };

  return (
    <>
      <ul
        ref={listRef}
        className={styles.list}
        aria-label={t('views.checklistAria')}
        aria-describedby={ctx.canEdit ? 'list-drag-hint' : undefined}
      >
        {ordered.map((project) => {
          const complete = finish !== null && project.statusId === finish.id;
          const disabled = !ctx.canEdit || !finish || !start;
          return (
            <li
              key={project.id}
              data-flip-key={project.id}
              className={styles.listRow}
              data-archived={project.archived || undefined}
              data-dragging={draggingId === project.id || undefined}
              data-pressing={touchDrag.pending?.payload.id === project.id || undefined}
              data-drop={dropTarget?.id === project.id ? dropTarget.edge : undefined}
              data-touch-id={project.id}
              data-touch-target=""
              draggable={ctx.canEdit}
              onPointerDown={(event) => touchDrag.start(event, project)}
              onPointerMove={touchDrag.handlePointerMove}
              onPointerUp={touchDrag.handlePointerUp}
              onPointerCancel={touchDrag.handlePointerCancel}
              onContextMenu={touchDrag.handleContextMenu}
              onDragStart={(event) => {
                if ((event.target as HTMLElement).closest('[data-no-drag]')) {
                  event.preventDefault();
                  return;
                }
                cancelFlipAnimations();
                event.dataTransfer.setData('text/plain', project.id);
                event.dataTransfer.effectAllowed = 'move';
                setDraggingId(project.id);
              }}
              onDragEnd={resetDrag}
              onDragOver={(event) => {
                if (!draggingId || draggingId === project.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const rect = event.currentTarget.getBoundingClientRect();
                const edge = reorderEdgeAt(event.clientY, rect.top, rect.height);
                setDropTarget((current) =>
                  current?.id === project.id && current.edge === edge
                    ? current
                    : { id: project.id, edge },
                );
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setDropTarget((current) => (current?.id === project.id ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData('text/plain') || draggingId;
                const rect = event.currentTarget.getBoundingClientRect();
                const edge = reorderEdgeAt(event.clientY, rect.top, rect.height);
                resetDrag();
                if (id) applyListDrop(id, project.id, edge);
              }}
            >
              <Checkbox
                label={
                  <span className={complete ? styles.listTitleDone : undefined}>
                    {project.title}
                  </span>
                }
                checked={complete}
                disabled={disabled}
                onChange={(event) => toggle(project, event.target.checked)}
              />
              <ViewMeta project={project} fields={ctx.settings.view_fields.list} />
              <span className={styles.listStatus}>{project.statusName ?? '—'}</span>
              <Link
                href={`/p/${project.id}`}
                className={styles.openLink}
                draggable={false}
              >
                <Icon name="open_in_new" size={18} />
                <span>{t('views.open')}</span>
              </Link>
              <ArchivedBadge project={project} />
              {ctx.canEdit ? (
                <span data-no-drag="">
                  <ProjectActionsMenu
                    ctx={ctx}
                    project={project}
                    siblings={ordered}
                    allSiblings={ordered}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {ctx.canEdit ? (
        <p className={styles.hint} id="list-drag-hint">
          {t('views.listHint')}
        </p>
      ) : null}
      {touchDrag.active ? (
        <TouchDragGhost
          x={touchDrag.active.x}
          y={touchDrag.active.y}
          label={touchDrag.active.payload.title}
        />
      ) : null}
    </>
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
