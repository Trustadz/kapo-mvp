'use client';

import Link from 'next/link';
import { useMemo, useState, type DragEvent } from 'react';
import { Badge, Button, Checkbox, EmptyState, Icon, InlineError } from '@/components/ui';
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
  return (
    <>
      {pulled.has(item.project.id) ? <Badge tone="pulled">Pulled</Badge> : null}
      {item.project.archived ? <Badge tone="archived">Archived</Badge> : null}
    </>
  );
}

/** Parent context shared by the Card and Tree presentations. */
function ParentContext({ item }: { item: InboxItem }) {
  const parent = item.project.parent;
  if (parent) {
    return (
      <>
        Under{' '}
        <Link href={`/p/${parent.id}`} className={styles.contextLink}>
          {parent.title}
        </Link>
      </>
    );
  }
  if (item.parentTitle) return <>Under {item.parentTitle}</>;
  return <>Direct access</>;
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
  return (
    <div className={styles.viewSwitch} role="group" aria-label="Inbox view">
      <button
        type="button"
        className={styles.viewButton}
        aria-pressed={view === 'card'}
        onClick={() => onChange('card')}
      >
        <Icon name="view_agenda" size={18} />
        <span>Card</span>
      </button>
      <button
        type="button"
        className={styles.viewButton}
        aria-pressed={view === 'tree'}
        onClick={() => onChange('tree')}
      >
        <Icon name="account_tree" size={18} />
        <span>Tree</span>
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  const index = useMemo(() => indexInboxTree(tree), [tree]);
  const rows = flattenInboxTree(index, collapsed);
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

  const toggleBranch = (projectId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <div className={styles.treeWrap} role="region" aria-label="Application tree">
      {items.length > 0 ? (
        <div className={styles.bulkToolbar} role="region" aria-label="Bulk release">
          <span className={styles.bulkCount}>
            {selectedItems.length > 0
              ? `${selectedItems.length} selected`
              : 'Select captures to release them together'}
          </span>
          <Button
            size="sm"
            variant="quiet"
            onClick={onReleaseSelected}
            loading={bulkPending}
            disabled={selectedItems.length === 0 || anyPending}
          >
            Release selected
          </Button>
          {selectedItems.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={onClearSelection} disabled={anyPending}>
              Clear
            </Button>
          ) : null}
        </div>
      ) : (
        <p className={styles.treeEmptyNotice}>
          No Inbox captures right now — showing every project you can read.
        </p>
      )}

      <div className={styles.treeScroll}>
        <table className={styles.treeTable} aria-label="Application projects">
          <thead>
            <tr>
              <th scope="col" className={styles.treeSelectHeader}>
                <Checkbox
                  id="inbox-tree-select-all"
                  ref={(node) => {
                    if (node) node.indeterminate = someSelected && !allSelected;
                  }}
                  label={<span className="visually-hidden">Select all Inbox captures</span>}
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  title={
                    selectable.length === 0
                      ? 'No captures can be released right now'
                      : 'Select all Inbox captures'
                  }
                  onChange={onToggleAll}
                />
              </th>
              <th scope="col">Project</th>
              <th scope="col" className={styles.treeStatusHeader}>
                Status
              </th>
              <th scope="col" className={styles.treeActionHeader}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
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
                  data-inbox={inboxRow || undefined}
                  data-context={!inboxRow || undefined}
                  data-pulled={isPulled || undefined}
                  data-archived={node.archived || undefined}
                  data-dragging={draggingId === node.id || undefined}
                  data-drop={dropTarget?.id === node.id ? dropTarget.zone : undefined}
                  draggable={selectableItem}
                  onDragStart={(event) => {
                    if (!selectableItem) {
                      event.preventDefault();
                      return;
                    }
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
                          <span className="visually-hidden">Select {node.title}</span>
                        }
                        checked={selectableItem && selected.has(node.id)}
                        disabled={!selectableItem}
                        title={
                          isPulled
                            ? 'Already released'
                            : !item?.canRelease
                              ? 'You need edit access to release this capture'
                              : undefined
                        }
                        onChange={(event) => onToggle(node.id, event.target.checked)}
                      />
                    ) : null}
                  </td>
                  <td className={styles.treeNameCell}>
                    <div
                      className={styles.treeName}
                      style={{ paddingInlineStart: depth * 14 }}
                    >
                      {hasChildren ? (
                        <button
                          type="button"
                          className={styles.chevronButton}
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
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
                      {isPulled ? <Badge tone="pulled">Pulled</Badge> : null}
                      {node.archived ? <Badge tone="archived">Archived</Badge> : null}
                      {inboxRow ? (
                        <span className={styles.treeInlineStatus} aria-hidden="true">
                          {node.statusName ?? '—'}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={styles.treeStatusCell}>{node.statusName ?? '—'}</td>
                  <td className={styles.treeActionCell}>
                    {inboxRow ? (
                      <Link
                        href={`/p/${node.id}`}
                        className={styles.open}
                        aria-label={`Open ${node.title}`}
                        draggable={false}
                      >
                        <Icon name="open_in_new" size={18} />
                        <span className={styles.openLabel}>Open</span>
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={styles.hint}>
        Inbox captures are highlighted, selectable for bulk release, and draggable. Drop one on
        another row’s middle to move it under that project, or between rows to reorder it in the
        global sequence. Non-Inbox rows are drop targets but read-only context. Use the chevron to
        expand or collapse a branch — all branches start expanded.
      </p>
    </div>
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
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [tree, setTree] = useState<InboxTreeNode[]>(initialTree);
  const [pulled, setPulled] = useState<Set<string>>(new Set());
  const [view, setView] = useState<InboxView>('card');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changeParentItem, setChangeParentItem] = useState<InboxItem | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [cardDropTarget, setCardDropTarget] = useState<{ id: string; edge: ReorderEdge } | null>(
    null,
  );
  const [movePending, setMovePending] = useState(false);
  const [lastReleased, setLastReleased] = useState<InboxItem | null>(null);

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
    setNotice(null);
    const result = await releaseInboxProject(item.project.id);
    setPendingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    markReleased([item.project.id]);
    setNotice(`Released “${item.project.title}”.`);
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
    setNotice(null);
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
      setNotice(
        `Released ${released.length} capture${released.length === 1 ? '' : 's'}.`,
      );
    }
    if (failures.length > 0) {
      const count = failures.length;
      setError(
        `${count} capture${count === 1 ? '' : 's'} could not be released. ${failures[0]}`,
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
    setNotice(null);
    const result = await reorderInboxRequest(item.project.id, { targetId, edge });
    setMovePending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Server-validated state is the source of truth; apply it locally so the
    // list/tree refresh immediately and released (Pulled) rows stay put.
    applyLocalReorder(item.project.id, targetId, edge);
    setNotice(`Reordered “${item.project.title}”.`);
  };

  /** Reparent an Inbox capture while keeping it in the Inbox (issue #53). */
  const reparentTo = async (item: InboxItem, targetId: string): Promise<void> => {
    if (pendingId || bulkPending || movePending) return;
    if (item.project.id === targetId || pulled.has(item.project.id) || !item.canRelease) {
      return;
    }
    setMovePending(true);
    setError(null);
    setNotice(null);
    const result = await changeInboxParentRequest(item.project.id, targetId);
    setMovePending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    applyParentChange(result.data.project);
    const parentTitle = tree.find((node) => node.id === targetId)?.title;
    setNotice(
      `Moved “${item.project.title}” under ${parentTitle ?? 'the new parent'}; it stays in the Inbox.`,
    );
  };

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
    if (!id || id === item.project.id || pulled.has(item.project.id)) return;
    const dragged = items.find((entry) => entry.project.id === id);
    if (!dragged) return;
    void reorderTo(dragged, item.project.id, edge);
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
          <h1 className={styles.title}>Inbox</h1>
          <p className={styles.subtitle}>
            Review captured projects and move them into work.
          </p>
        </div>
        <InboxViewSwitch view={view} onChange={setView} />
      </header>

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {notice ?? ''}
      </p>

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
          title="Inbox is empty"
          description="New projects captured from the top bar appear here for refinement."
        />
      ) : (
        <div className={styles.cardLayout}>
          <div className={styles.dropRail}>
          <section
            className={styles.dropZone}
            data-active={dropActive || undefined}
            aria-label="Release drop area"
            aria-describedby="inbox-drop-hint"
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
                {dropActive ? 'Release to the start status' : 'Drag a capture here to release it'}
              </span>
              <span id="inbox-drop-hint" className={styles.dropHint}>
                Drop here to release. To reorder instead, drag between cards in the list. Prefer
                the keyboard? Use the Release button on a card.
              </span>
            </span>
          </section>

          {lastReleased ? (
            <section className={styles.dropResult} aria-label="Released capture">
              <span className={styles.dropResultIcon} aria-hidden="true">
                <Icon name="check_circle" size={20} />
              </span>
              <span className={styles.dropResultText}>
                <span className={styles.dropResultTitle}>
                  “{lastReleased.project.title}” released to{' '}
                  {lastReleased.startStatusName ?? 'the start status'}.
                </span>
                <span className={styles.dropResultHint}>Still listed below as Pulled.</span>
              </span>
              <Link
                href={`/p/${lastReleased.project.id}`}
                className={styles.open}
                aria-label={`Open ${lastReleased.project.title}`}
              >
                <Icon name="open_in_new" size={18} />
                <span className={styles.openLabel}>Open</span>
              </Link>
            </section>
          ) : null}

          <p className="visually-hidden" aria-live="polite" aria-atomic="true">
            {lastReleased
              ? `${lastReleased.project.title} released to ${
                  lastReleased.startStatusName ?? 'the start status'
                }.`
              : ''}
          </p>
          </div>

          <ul className={styles.list} aria-label="Projects in the Inbox">
            {items.map((item) => {
              const isPulled = pulled.has(item.project.id);
              const canDrag = !isPulled && item.canRelease;
              return (
                <li key={item.project.id}>
                  <article
                    className={styles.card}
                    data-pulled={isPulled || undefined}
                    data-dragging={draggingId === item.project.id || undefined}
                    data-drop-area="reorder"
                    data-drop={
                      cardDropTarget?.id === item.project.id
                        ? cardDropTarget.edge
                        : undefined
                    }
                    draggable={canDrag}
                    onDragStart={(event) => {
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
                      {isPulled ? (
                        <span className={styles.pulledNote}>
                          <Icon name="check_circle" size={18} />
                          Released — open it to keep working.
                        </span>
                      ) : item.canRelease ? (
                        <Button
                          variant="quiet"
                          onClick={() => void release(item)}
                          loading={pendingId === item.project.id}
                          disabled={Boolean(pendingId) || bulkPending || movePending}
                        >
                          Release to {item.startStatusName ?? 'the start status'}
                        </Button>
                      ) : null}
                      {!isPulled && item.canChangeParent ? (
                        <Button
                          variant="quiet"
                          onClick={() => setChangeParentItem(item)}
                          disabled={Boolean(pendingId) || movePending}
                        >
                          Change parent
                        </Button>
                      ) : null}
                      <Link
                        href={`/p/${item.project.id}`}
                        className={styles.open}
                        aria-label={`Open ${item.project.title}`}
                      >
                        <Icon name="open_in_new" size={18} />
                        <span className={styles.openLabel}>Open</span>
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
    </div>
  );
}
