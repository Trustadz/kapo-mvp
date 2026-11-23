'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Badge, Button, Checkbox, EmptyState, Icon, InlineError, LiveRegion } from '@/components/ui';
import { useAnnouncer } from '@/components/ui/use-live-announcer';
import type { InboxItem, InboxTreeNode, ProjectCard } from '@/components/projects/types';
import {
  changeInboxParentRequest,
  releaseInboxProject,
  reorderInboxRequest,
} from '@/components/projects/api';
import {
  flattenInboxTree,
  indexInboxTree,
  orderInboxItemsByTree,
  planSequenceMove,
} from '@/lib/inbox-tree';
import { dropZoneAt, reorderEdgeAt, type DropZone, type ReorderEdge } from '@/lib/reorder';
import {
  measureTouchRows,
  pointInRect,
  reorderTargetAt,
  touchDropTargetAt,
  touchElementAt,
} from '@/lib/touch-drag';
import { useTouchDrag, type TouchDragPoint } from '@/lib/use-touch-drag';
import { cancelFlipAnimations, useFlipReorder } from '@/lib/use-flip-reorder';
import { TouchDragGhost } from '@/components/dnd/TouchDragGhost';
import { useI18n } from '@/i18n/client';
import { ChangeParentDialog } from './ChangeParentDialog';
import styles from './inbox.module.css';

export interface InboxPageProps {
  initialItems: InboxItem[];
  /** Every active project the viewer can read (issue #54). */
  initialTree?: InboxTreeNode[];
}

type InboxView = 'card' | 'tree';

/** Only captures that can still be released take part in bulk selection. */
function isSelectable(item: InboxItem, pulled: ReadonlySet<string>): boolean {
  return item.canRelease && !pulled.has(item.project.id);
}

function ReleasedBadges({ item, pulled }: { item: InboxItem; pulled: ReadonlySet<string> }) {
  const { t } = useI18n();
  return (
    <>
      {pulled.has(item.project.id) ? (
        <Badge tone="pulled">{t('common.pulled')}</Badge>
      ) : null}
      {item.project.archived ? (
        <Badge tone="archived">{t('common.archived')}</Badge>
      ) : null}
    </>
  );
}

/** Parent context shared by the Card and Tree presentations. */
function ParentContext({ item }: { item: InboxItem }) {
  const { t } = useI18n();
  const parent = item.project.parent;
  if (parent) {
    return (
      <>
        {t('inbox.under')}{' '}
        <Link href={`/p/${parent.id}`} className={styles.contextLink}>
          {parent.title}
        </Link>
      </>
    );
  }
  if (item.parentTitle) return <>{t('inbox.under')} {item.parentTitle}</>;
  return <>{t('common.directAccess')}</>;
}

/**
 * Compact presentation switcher: Card is the default browse/refine view and
 * Tree is the application-wide overview (product.md §4/§5, issue #54).
 */
function InboxViewSwitch({
  view,
  onChange,
}: {
  view: InboxView;
  onChange: (view: InboxView) => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.viewSwitch} role="group" aria-label={t('inbox.viewAria')}>
      <button
        type="button"
        className={styles.viewButton}
        aria-pressed={view === 'card'}
        onClick={() => onChange('card')}
      >
        <Icon name="view_agenda" size={18} />
        <span>{t('inbox.card')}</span>
      </button>
      <button
        type="button"
        className={styles.viewButton}
        aria-pressed={view === 'tree'}
        onClick={() => onChange('tree')}
      >
        <Icon name="account_tree" size={18} />
        <span>{t('inbox.tree')}</span>
      </button>
    </div>
  );
}

export interface InboxTreeProps {
  items: InboxItem[];
  tree: InboxTreeNode[];
  pulled: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  bulkPending: boolean;
  anyPending: boolean;
  onToggle: (projectId: string, checked: boolean) => void;
  onToggleAll: () => void;
  onReleaseSelected: () => void;
  onClearSelection: () => void;
  /** Reorder `draggedId` before/after `targetId` in the global sequence. */
  onReorder: (draggedId: string, targetId: string, edge: ReorderEdge) => void;
  /** Reparent `draggedId` under `targetId`, keeping it in the Inbox. */
  onReparent: (draggedId: string, targetId: string) => void;
}

/** Classify a drop against the bounds of the row that received it. */
function dropZoneForEvent(event: DragEvent<HTMLElement>): DropZone {
  const rect = event.currentTarget.getBoundingClientRect();
  return dropZoneAt(event.clientY, rect.top, rect.height);
}

/**
 * Application-wide Tree view (issue #54) with Inbox drag/reparent (issue #53).
 *
 * Root sits at the top and every readable, active project nests under its
 * parent in global priority order. Non-Inbox rows are read-only context: muted,
 * compact, no checkbox and no actions beyond the navigable title. Inbox rows are
 * highlighted, actionable (bulk selection, status display, Open) and draggable.
 * Dropping an Inbox row on another row's middle reparents it; dropping between
 * rows reorders it globally before/after the target. Non-Inbox rows are drop
 * targets but never drag sources. Every branch can be collapsed and branches
 * start expanded.
 */
export function InboxTree({
  items,
  tree,
  pulled,
  selected,
  bulkPending,
  anyPending,
  onToggle,
  onToggleAll,
  onReleaseSelected,
  onClearSelection,
  onReorder,
  onReparent,
}: InboxTreeProps) {
  const { t, plural } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const index = useMemo(() => indexInboxTree(tree), [tree]);
  const rows = flattenInboxTree(index, collapsed);
  useFlipReorder(
    tbodyRef,
    rows.map((row) => row.node.id).join('|'),
    draggingId === null,
  );
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.project.id, item])),
    [items],
  );

  const selectable = items.filter((item) => isSelectable(item, pulled));
  const selectedItems = selectable.filter((item) => selected.has(item.project.id));
  const allSelected = selectable.length > 0 && selectedItems.length === selectable.length;
  const someSelected = selectedItems.length > 0;

  const resetDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  /**
   * Resolve a touch point against the visible Tree rows. Non-Inbox rows are
   * drop targets too (the row explicitly opts in with data-touch-target), so
   * the measured list includes every rendered row except the dragged one.
   */
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
    node: InboxTreeNode,
    point: TouchDragPoint,
  ): void => {
    const next = resolveTouchTarget(point.x, point.y, node.id);
    setDropTarget((current) =>
      current?.id === next?.id && current?.zone === next?.zone ? current : next,
    );
  };

  const touchDrag = useTouchDrag<InboxTreeNode>({
    enabled: !anyPending,
    // Only Inbox captures are drag sources; non-Inbox rows stay drop targets.
    canStart: (_event, node) => {
      const item = itemById.get(node.id);
      return Boolean(item && isSelectable(item, pulled));
    },
    onDragStart: (node, point) => {
      setDraggingId(node.id);
      setDropTarget(null);
      updateTouchTarget(node, point);
    },
    onDragMove: updateTouchTarget,
    onDrop: (node, point) => {
      const target = resolveTouchTarget(point.x, point.y, node.id);
      resetDrag();
      if (!target) return;
      // Middle = reparent, edges = reorder, matching the desktop drop zones.
      if (target.zone === 'inside') onReparent(node.id, target.id);
      else onReorder(node.id, target.id, target.zone);
    },
    onCancel: resetDrag,
  });

  const toggleBranch = (projectId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <>
      <div className={styles.treeWrap} role="region" aria-label={t('inbox.treeRegion')}>
        <h2 className="visually-hidden">{t('inbox.treeRegion')}</h2>
        {items.length > 0 ? (
          <div className={styles.bulkToolbar} role="region" aria-label={t('inbox.bulkRelease')}>
            <span className={styles.bulkCount}>
              {selectedItems.length > 0
                ? plural('plurals.inboxSelected', selectedItems.length)
                : t('inbox.selectPrompt')}
            </span>
            <Button
              size="sm"
              variant="quiet"
              onClick={onReleaseSelected}
              loading={bulkPending}
              disabled={selectedItems.length === 0 || anyPending}
            >
              {t('inbox.releaseSelected')}
            </Button>
            {selectedItems.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={onClearSelection} disabled={anyPending}>
                {t('common.clear')}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className={styles.treeEmptyNotice}>
            {t('inbox.treeEmptyNotice')}
          </p>
        )}

        <div className={styles.treeScroll}>
          <table
            className={styles.treeTable}
            aria-label={t('inbox.tableAria')}
            aria-describedby="inbox-tree-drag-hint"
          >
            <caption className="visually-hidden">
              {t('inbox.caption')}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={styles.treeSelectHeader}>
                  <Checkbox
                    id="inbox-tree-select-all"
                    ref={(node) => {
                      if (node) node.indeterminate = someSelected && !allSelected;
                    }}
                    label={<span className="visually-hidden">{t('inbox.selectAll')}</span>}
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    title={
                      selectable.length === 0
                        ? t('inbox.noCapturesReleasable')
                        : t('inbox.selectAll')
                    }
                    onChange={onToggleAll}
                  />
                </th>
                <th scope="col">{t('inbox.columnProject')}</th>
                <th scope="col" className={styles.treeStatusHeader}>
                  {t('inbox.columnStatus')}
                </th>
                <th scope="col" className={styles.treeActionHeader}>
                  <span className="visually-hidden">{t('inbox.columnActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {rows.map(({ node, depth, hasChildren }) => {
                const item = itemById.get(node.id);
                const isPulled = pulled.has(node.id);
                const inboxRow = node.inbox || Boolean(item) || isPulled;
                const selectableItem = item ? isSelectable(item, pulled) : false;
                const expanded = !collapsed.has(node.id);
                return (
                  <tr
                    key={node.id}
                    className={styles.treeRow}
                    data-flip-key={node.id}
                    data-inbox={inboxRow || undefined}
                    data-context={!inboxRow || undefined}
                    data-pulled={isPulled || undefined}
                    data-archived={node.archived || undefined}
                    data-dragging={draggingId === node.id || undefined}
                    data-pressing={touchDrag.pending?.payload.id === node.id || undefined}
                    data-drop={dropTarget?.id === node.id ? dropTarget.zone : undefined}
                    data-touch-id={node.id}
                    data-touch-target=""
                    aria-describedby={selectableItem ? 'inbox-tree-drag-hint' : undefined}
                    draggable={selectableItem}
                    onPointerDown={(event) => touchDrag.start(event, node)}
                    onPointerMove={touchDrag.handlePointerMove}
                    onPointerUp={touchDrag.handlePointerUp}
                    onPointerCancel={touchDrag.handlePointerCancel}
                    onContextMenu={touchDrag.handleContextMenu}
                    onDragStart={(event) => {
                      if (!selectableItem) {
                        event.preventDefault();
                        return;
                      }
                      cancelFlipAnimations();
                      event.dataTransfer.setData('text/plain', node.id);
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingId(node.id);
                    }}
                    onDragEnd={resetDrag}
                    onDragOver={(event) => {
                      if (!draggingId || draggingId === node.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      const zone = dropZoneForEvent(event);
                      setDropTarget((current) =>
                        current?.id === node.id && current.zone === zone
                          ? current
                          : { id: node.id, zone },
                      );
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                      setDropTarget((current) => (current?.id === node.id ? null : current));
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData('text/plain') || draggingId;
                      const zone = dropZoneForEvent(event);
                      resetDrag();
                      if (!id || id === node.id) return;
                      if (zone === 'inside') {
                        onReparent(id, node.id);
                        return;
                      }
                      onReorder(id, node.id, zone);
                    }}
                  >
                    <td className={styles.treeSelectCell}>
                      {inboxRow ? (
                        <Checkbox
                          id={`inbox-tree-select-${node.id}`}
                          label={
                            <span className="visually-hidden">{t('inbox.selectProject', { title: node.title })}</span>
                          }
                          checked={selectableItem && selected.has(node.id)}
                          disabled={!selectableItem}
                          title={
                            isPulled
                              ? t('inbox.alreadyReleased')
                              : !item?.canRelease
                                ? t('inbox.needEditToRelease')
                                : undefined
                          }
                          onChange={(event) => onToggle(node.id, event.target.checked)}
                        />
                      ) : null}
                    </td>
                    <th scope="row" className={styles.treeNameCell}>
                      <div
                        className={styles.treeName}
                        style={{ paddingInlineStart: depth * 14 }}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            className={styles.chevronButton}
                            aria-label={
                              expanded
                                ? t('common.collapseName', { title: node.title })
                                : t('common.expandName', { title: node.title })
                            }
                            aria-expanded={expanded}
                            onClick={() => toggleBranch(node.id)}
                          >
                            <Icon name={expanded ? 'expand_more' : 'chevron_right'} size={18} />
                          </button>
                        ) : (
                          <span className={styles.chevronSpacer} aria-hidden="true" />
                        )}
                        <Link
                          href={`/p/${node.id}`}
                          className={styles.treeTitle}
                          draggable={false}
                        >
                          {node.title}
                        </Link>
                        {isPulled ? <Badge tone="pulled">{t('common.pulled')}</Badge> : null}
                        {node.archived ? (
                          <Badge tone="archived">{t('common.archived')}</Badge>
                        ) : null}
                        {inboxRow ? (
                          <span className={styles.treeInlineStatus} aria-hidden="true">
                            {node.statusName ?? '—'}
                          </span>
                        ) : null}
                      </div>
                    </th>
                    <td className={styles.treeStatusCell}>{node.statusName ?? '—'}</td>
                    <td className={styles.treeActionCell}>
                      {inboxRow ? (
                        <Link
                          href={`/p/${node.id}`}
                          className={styles.open}
                          aria-label={t('common.openName', { title: node.title })}
                          draggable={false}
                        >
                          <Icon name="open_in_new" size={18} />
                          <span className={styles.openLabel}>{t('common.open')}</span>
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className={styles.hint} id="inbox-tree-drag-hint">
          {t('inbox.dragHint')}
        </p>
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

/**
 * Global Inbox (product.md §4): Card presentation with parent context, the
 * release action labelled with the parent's start status, and Open. Released
 * projects stay visible and marked Pulled until the user leaves Inbox.
 *
 * Tree is the application-wide overview: every readable project nests by parent
 * and Inbox captures are the only actionable rows. In both presentations an
 * Inbox capture can be dragged: within the Card list it reorders globally, on
 * the right-hand rail it releases, and in the Tree dropping on a row's middle
 * reparents while dropping between rows reorders. The per-card Release button
 * and the Card "Change parent" action remain the keyboard-accessible paths.
 */
export function InboxPage({ initialItems, initialTree = [] }: InboxPageProps) {
  const { t, plural } = useI18n();
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [tree, setTree] = useState<InboxTreeNode[]>(initialTree);
  const [pulled, setPulled] = useState<Set<string>>(new Set());
  const [view, setView] = useState<InboxView>('card');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { announcement, announce } = useAnnouncer();
  const [changeParentItem, setChangeParentItem] = useState<InboxItem | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [cardDropTarget, setCardDropTarget] = useState<{ id: string; edge: ReorderEdge } | null>(
    null,
  );
  const [movePending, setMovePending] = useState(false);
  const [lastReleased, setLastReleased] = useState<InboxItem | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  useFlipReorder(
    listRef,
    items.map((item) => item.project.id).join('|'),
    draggingId === null,
  );

  const resetDrag = () => {
    setDraggingId(null);
    setDropActive(false);
    setCardDropTarget(null);
  };

  const markReleased = (ids: string[]) => {
    if (ids.length === 0) return;
    const released = new Set(ids);
    setPulled((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
    setItems((current) =>
      current.map((entry) =>
        released.has(entry.project.id)
          ? { ...entry, project: { ...entry.project, inbox: false } }
          : entry,
      ),
    );
    setTree((current) =>
      current.map((node) =>
        released.has(node.id) ? { ...node, inbox: false } : node,
      ),
    );
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  const release = async (item: InboxItem) => {
    if (pendingId || bulkPending || movePending) return;
    setPendingId(item.project.id);
    setError(null);
    const result = await releaseInboxProject(item.project.id);
    setPendingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    markReleased([item.project.id]);
    announce(
      t('inbox.releaseSuccess', {
        title: item.project.title,
        status: item.startStatusName ?? t('inbox.startStatus'),
      }),
    );
    setLastReleased(item);
  };

  const releaseSelected = async () => {
    if (pendingId || bulkPending || movePending) return;
    const targets = items.filter(
      (item) => isSelectable(item, pulled) && selected.has(item.project.id),
    );
    if (targets.length === 0) return;
    setBulkPending(true);
    setError(null);
    const released: string[] = [];
    const failures: string[] = [];
    for (const item of targets) {
      const result = await releaseInboxProject(item.project.id);
      if (result.ok) released.push(item.project.id);
      else failures.push(result.message);
    }
    setBulkPending(false);
    markReleased(released);
    if (released.length > 0) {
      announce(plural('plurals.releases', released.length));
    }
    if (failures.length > 0) {
      const count = failures.length;
      setError(
        plural('plurals.releaseFailures', count, { message: failures[0] ?? '' }),
      );
    }
  };

  const toggleSelection = (projectId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  };

  const toggleAll = () => {
    const selectable = items.filter((item) => isSelectable(item, pulled));
    const allSelected =
      selectable.length > 0 &&
      selectable.every((item) => selected.has(item.project.id));
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) {
        for (const item of selectable) next.delete(item.project.id);
      } else {
        for (const item of selectable) next.add(item.project.id);
      }
      return next;
    });
  };

  const applyParentChange = (updated: ProjectCard) => {
    setItems((current) =>
      current.map((entry) =>
        entry.project.id === updated.id
          ? {
              ...entry,
              project: updated,
              parentTitle: updated.parent?.title ?? entry.parentTitle,
              startStatusId: updated.statusId,
              startStatusName: updated.statusName,
            }
          : entry,
      ),
    );
    setTree((current) => {
      const ids = new Set(current.map((node) => node.id));
      return current.map((node) =>
        node.id === updated.id
          ? {
              ...node,
              parentId:
                updated.parentId !== null && ids.has(updated.parentId)
                  ? updated.parentId
                  : null,
              statusName: updated.statusName,
              archived: updated.archived,
              inbox: updated.inbox,
            }
          : node,
      );
    });
  };

  /**
   * Applies the server-confirmed global reorder to both presentations without
   * dropping the local Pulled state. The Tree payload is the flat global order
   * (issue #54), so planning the move there gives the same order the server
   * wrote; item priorities are renumbered locally only to keep the derived
   * hierarchy stable until the next server render.
   */
  const applyLocalReorder = (
    draggedId: string,
    targetId: string,
    edge: ReorderEdge,
  ): boolean => {
    const nextOrder = planSequenceMove(
      tree.map((node) => node.id),
      draggedId,
      targetId,
      edge,
    );
    if (!nextOrder) return false;
    const byId = new Map(tree.map((node) => [node.id, node]));
    const nextTree = nextOrder.map((id, index) => ({
      ...byId.get(id)!,
      priority: index,
    }));
    setTree(nextTree);
    setItems((current) => orderInboxItemsByTree(current, nextTree));
    return true;
  };

  /** Reorder an Inbox capture in the one global sequence (issue #53). */
  const reorderTo = async (
    item: InboxItem,
    targetId: string,
    edge: ReorderEdge,
  ): Promise<void> => {
    if (pendingId || bulkPending || movePending) return;
    if (item.project.id === targetId || pulled.has(item.project.id) || !item.canRelease) {
      return;
    }
    // No-op drops never hit the API, matching the visible insertion plan.
    if (
      !planSequenceMove(
        tree.map((node) => node.id),
        item.project.id,
        targetId,
        edge,
      )
    ) {
      return;
    }
    setMovePending(true);
    setError(null);
    const result = await reorderInboxRequest(item.project.id, { targetId, edge });
    setMovePending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Server-validated state is the source of truth; apply it locally so the
    // list/tree refresh immediately and released (Pulled) rows stay put.
    applyLocalReorder(item.project.id, targetId, edge);
    announce(t('inbox.reorderAnnounce', { title: item.project.title }));
  };

  /** Reparent an Inbox capture while keeping it in the Inbox (issue #53). */
  const reparentTo = async (item: InboxItem, targetId: string): Promise<void> => {
    if (pendingId || bulkPending || movePending) return;
    if (item.project.id === targetId || pulled.has(item.project.id) || !item.canRelease) {
      return;
    }
    setMovePending(true);
    setError(null);
    const result = await changeInboxParentRequest(item.project.id, targetId);
    setMovePending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    applyParentChange(result.data.project);
    const parentTitle = tree.find((node) => node.id === targetId)?.title;
    announce(
      t('inbox.reparentAnnounce', {
        title: item.project.title,
        parent: parentTitle ?? t('inbox.newParent'),
      }),
    );
  };

  const applyCardReorder = (
    draggedId: string,
    targetId: string,
    edge: ReorderEdge,
  ): void => {
    if (!draggedId || draggedId === targetId || pulled.has(targetId)) return;
    const dragged = items.find((entry) => entry.project.id === draggedId);
    if (!dragged) return;
    void reorderTo(dragged, targetId, edge);
  };

  type InboxCardTouchTarget =
    | { kind: 'release' }
    | { kind: 'reorder'; id: string; edge: ReorderEdge };

  /**
   * Card touch drops resolve to exactly two things: the release rail, or a
   * before/after slot in the global Inbox sequence. There is no "inside" zone,
   * so a card body never opens an ambiguous action.
   */
  const resolveTouchCardTarget = (
    x: number,
    y: number,
    draggedId: string,
  ): InboxCardTouchTarget | null => {
    if (touchElementAt(x, y, '[data-drop-area="release"]')) {
      return { kind: 'release' };
    }
    const list = listRef.current;
    if (!list || !pointInRect(x, y, list.getBoundingClientRect())) return null;
    const target = reorderTargetAt(y, measureTouchRows(list, draggedId));
    return target ? { kind: 'reorder', ...target } : null;
  };

  const updateTouchCardTarget = (
    item: InboxItem,
    point: TouchDragPoint,
  ): void => {
    const target = resolveTouchCardTarget(point.x, point.y, item.project.id);
    if (target?.kind === 'release') {
      setDropActive(true);
      setCardDropTarget(null);
      return;
    }
    setDropActive(false);
    setCardDropTarget((current) => {
      const next =
        target?.kind === 'reorder' ? { id: target.id, edge: target.edge } : null;
      return current?.id === next?.id && current?.edge === next?.edge
        ? current
        : next;
    });
  };

  const touchDrag = useTouchDrag<InboxItem>({
    enabled: view === 'card' && !pendingId && !bulkPending && !movePending,
    canStart: (_event, item) =>
      item.canRelease && !pulled.has(item.project.id),
    onDragStart: (item, point) => {
      setDraggingId(item.project.id);
      setCardDropTarget(null);
      setDropActive(false);
      updateTouchCardTarget(item, point);
    },
    onDragMove: updateTouchCardTarget,
    onDrop: (item, point) => {
      const target = resolveTouchCardTarget(point.x, point.y, item.project.id);
      resetDrag();
      if (!target) return;
      if (target.kind === 'release') {
        if (!pulled.has(item.project.id) && item.canRelease) void release(item);
        return;
      }
      applyCardReorder(item.project.id, target.id, target.edge);
    },
    onCancel: resetDrag,
  });

  const handleCardDragOver = (
    event: DragEvent<HTMLElement>,
    item: InboxItem,
  ): void => {
    if (!draggingId || draggingId === item.project.id) return;
    if (pulled.has(item.project.id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = reorderEdgeAt(event.clientY, rect.top, rect.height);
    setCardDropTarget((current) =>
      current?.id === item.project.id && current.edge === edge
        ? current
        : { id: item.project.id, edge },
    );
  };

  const handleCardDrop = (event: DragEvent<HTMLElement>, item: InboxItem): void => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || draggingId;
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = reorderEdgeAt(event.clientY, rect.top, rect.height);
    resetDrag();
    if (!id) return;
    applyCardReorder(id, item.project.id, edge);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || draggingId;
    resetDrag();
    if (!id) return;
    const item = items.find((entry) => entry.project.id === id);
    if (!item || pulled.has(id) || !item.canRelease) return;
    void release(item);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{t('inbox.title')}</h1>
        </div>
        <InboxViewSwitch view={view} onChange={setView} />
      </header>

      <LiveRegion message={announcement.message} sequence={announcement.sequence} />

      {error ? (
        <div className={styles.error}>
          <InlineError>{error}</InlineError>
        </div>
      ) : null}

      {view === 'tree' ? (
        <InboxTree
          items={items}
          tree={tree}
          pulled={pulled}
          selected={selected}
          bulkPending={bulkPending}
          anyPending={pendingId !== null || movePending}
          onToggle={toggleSelection}
          onToggleAll={toggleAll}
          onReleaseSelected={() => void releaseSelected()}
          onClearSelection={() => setSelected(new Set())}
          onReorder={(draggedId, targetId, edge) => {
            const dragged = items.find((entry) => entry.project.id === draggedId);
            if (dragged) void reorderTo(dragged, targetId, edge);
          }}
          onReparent={(draggedId, targetId) => {
            const dragged = items.find((entry) => entry.project.id === draggedId);
            if (dragged) void reparentTo(dragged, targetId);
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={t('inbox.emptyTitle')}
          description={t('inbox.emptyDescription')}
        />
      ) : (
        <div className={styles.cardLayout}>
          <div className={styles.dropRail}>
          <section
            className={styles.dropZone}
            data-active={dropActive || undefined}
            aria-label={t('inbox.releaseDropArea')}
            data-drop-area="release"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDropActive(false);
            }}
            onDrop={handleDrop}
          >
            <span className={styles.dropIcon} aria-hidden="true">
              <Icon name="move_to_inbox" size={24} />
            </span>
            <span className={styles.dropText}>
              <span className={styles.dropTitle}>
                {dropActive ? t('inbox.dropActive') : t('inbox.dropIdle')}
              </span>
            </span>
          </section>

          {lastReleased ? (
            <section className={styles.dropResult} aria-label={t('inbox.releaseAria')}>
              <span className={styles.dropResultIcon} aria-hidden="true">
                <Icon name="check_circle" size={20} />
              </span>
              <span className={styles.dropResultText}>
                <span className={styles.dropResultTitle}>
                  {t('inbox.releasedTo', {
                    title: lastReleased.project.title,
                    status: lastReleased.startStatusName ?? t('inbox.startStatus'),
                  })}
                </span>
                <span className={styles.dropResultHint}>{t('inbox.stillPulled')}</span>
              </span>
              <Link
                href={`/p/${lastReleased.project.id}`}
                className={styles.open}
                aria-label={t('common.openName', { title: lastReleased.project.title })}
              >
                <Icon name="open_in_new" size={18} />
                <span className={styles.openLabel}>{t('common.open')}</span>
              </Link>
            </section>
          ) : null}

          <p id="inbox-card-drag-hint" className="visually-hidden">
            {t('inbox.cardDragHint')}
          </p>
          </div>

          <ul
            ref={listRef}
            className={styles.list}
            aria-label={t('inbox.listAria')}
            aria-describedby="inbox-card-drag-hint"
          >
            {items.map((item) => {
              const isPulled = pulled.has(item.project.id);
              const canDrag = !isPulled && item.canRelease;
              return (
                <li key={item.project.id} data-flip-key={item.project.id}>
                  <article
                    className={styles.card}
                    data-pulled={isPulled || undefined}
                    data-dragging={draggingId === item.project.id || undefined}
                    data-pressing={touchDrag.pending?.payload.project.id === item.project.id || undefined}
                    data-drop-area="reorder"
                    data-drop={
                      cardDropTarget?.id === item.project.id
                        ? cardDropTarget.edge
                        : undefined
                    }
                    data-touch-id={item.project.id}
                    data-touch-target={isPulled ? undefined : ''}
                    draggable={canDrag}
                    onPointerDown={(event) => touchDrag.start(event, item)}
                    onPointerMove={touchDrag.handlePointerMove}
                    onPointerUp={touchDrag.handlePointerUp}
                    onPointerCancel={touchDrag.handlePointerCancel}
                    onContextMenu={touchDrag.handleContextMenu}
                    onDragStart={(event) => {
                      cancelFlipAnimations();
                      event.dataTransfer.setData('text/plain', item.project.id);
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingId(item.project.id);
                    }}
                    onDragEnd={resetDrag}
                    onDragOver={(event) => handleCardDragOver(event, item)}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                      setCardDropTarget((current) =>
                        current?.id === item.project.id ? null : current,
                      );
                    }}
                    onDrop={(event) => handleCardDrop(event, item)}
                  >
                    <div className={styles.cardHeading}>
                      <h2 className={styles.cardTitle}>
                        <Link href={`/p/${item.project.id}`}>{item.project.title}</Link>
                      </h2>
                      <ReleasedBadges item={item} pulled={pulled} />
                    </div>
                    <p className={styles.context}>
                      <ParentContext item={item} />
                    </p>
                    <div className={styles.actions}>
                      {isPulled ? null : item.canRelease ? (
                        <Button
                          variant="quiet"
                          onClick={() => void release(item)}
                          loading={pendingId === item.project.id}
                          disabled={Boolean(pendingId) || bulkPending || movePending}
                        >
                          {t('inbox.releaseTo', {
                            status: item.startStatusName ?? t('inbox.startStatus'),
                          })}
                        </Button>
                      ) : null}
                      {!isPulled && item.canChangeParent ? (
                        <Button
                          variant="quiet"
                          onClick={() => setChangeParentItem(item)}
                          disabled={Boolean(pendingId) || movePending}
                        >
                          {t('inbox.changeParent')}
                        </Button>
                      ) : null}
                      <Link
                        href={`/p/${item.project.id}`}
                        className={styles.open}
                        aria-label={t('common.openName', { title: item.project.title })}
                      >
                        <Icon name="open_in_new" size={18} />
                        <span className={styles.openLabel}>{t('common.open')}</span>
                      </Link>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ChangeParentDialog
        open={changeParentItem !== null}
        projectId={changeParentItem?.project.id ?? ''}
        projectTitle={changeParentItem?.project.title ?? ''}
        onClose={() => setChangeParentItem(null)}
        onChanged={applyParentChange}
      />
      {view === 'card' && touchDrag.active ? (
        <TouchDragGhost
          x={touchDrag.active.x}
          y={touchDrag.active.y}
          label={touchDrag.active.payload.project.title}
        />
      ) : null}
    </div>
  );
}
