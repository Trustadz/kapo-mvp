'use client';

import Link from 'next/link';
import { useState, type DragEvent } from 'react';
import { Badge, Button, Checkbox, EmptyState, Icon, InlineError } from '@/components/ui';
import type { InboxItem, ProjectCard } from '@/components/projects/types';
import { releaseInboxProject } from '@/components/projects/api';
import { ChangeParentDialog } from './ChangeParentDialog';
import styles from './inbox.module.css';

export interface InboxPageProps {
  initialItems: InboxItem[];
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
 * Tree is the Inbox-specific mass-release table (product.md §4/§5).
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
  pulled: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  bulkPending: boolean;
  anyPending: boolean;
  onToggle: (projectId: string, checked: boolean) => void;
  onToggleAll: () => void;
  onReleaseSelected: () => void;
  onClearSelection: () => void;
}

/**
 * Inbox-specific Tree view. Unlike the project TreeView this is a flat table:
 * Inbox captures can live under different parents, so there is no single
 * hierarchy root and no drag requirement. Selection drives one bulk action,
 * releasing every chosen capture to its own parent's start status.
 */
export function InboxTree({
  items,
  pulled,
  selected,
  bulkPending,
  anyPending,
  onToggle,
  onToggleAll,
  onReleaseSelected,
  onClearSelection,
}: InboxTreeProps) {
  const selectable = items.filter((item) => isSelectable(item, pulled));
  const selectedItems = selectable.filter((item) => selected.has(item.project.id));
  const allSelected = selectable.length > 0 && selectedItems.length === selectable.length;
  const someSelected = selectedItems.length > 0;

  return (
    <div className={styles.treeWrap}>
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

      <div className={styles.treeScroll}>
        <table className={styles.treeTable}>
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
              <th scope="col">Title</th>
              <th scope="col" className={styles.treeParentHeader}>
                Parent
              </th>
              <th scope="col" className={styles.treeStatusHeader}>
                Status
              </th>
              <th scope="col" className={styles.treeActionHeader}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isPulled = pulled.has(item.project.id);
              const selectableItem = isSelectable(item, pulled);
              const checkboxDisabled = !selectableItem;
              return (
                <tr
                  key={item.project.id}
                  className={styles.treeRow}
                  data-pulled={isPulled || undefined}
                  data-archived={item.project.archived || undefined}
                >
                  <td className={styles.treeSelectCell}>
                    <Checkbox
                      id={`inbox-tree-select-${item.project.id}`}
                      label={
                        <span className="visually-hidden">
                          Select {item.project.title}
                        </span>
                      }
                      checked={selectableItem && selected.has(item.project.id)}
                      disabled={checkboxDisabled}
                      title={
                        isPulled
                          ? 'Already released'
                          : !item.canRelease
                            ? 'You need edit access to release this capture'
                            : undefined
                      }
                      onChange={(event) => onToggle(item.project.id, event.target.checked)}
                    />
                  </td>
                  <td className={styles.treeNameCell}>
                    <div className={styles.treeName}>
                      <Link href={`/p/${item.project.id}`} className={styles.treeTitle}>
                        {item.project.title}
                      </Link>
                      <ReleasedBadges item={item} pulled={pulled} />
                    </div>
                    <p className={styles.treeInlineContext}>
                      <ParentContext item={item} />
                    </p>
                  </td>
                  <td className={styles.treeParentCell}>
                    <ParentContext item={item} />
                  </td>
                  <td className={styles.treeStatusCell}>{item.project.statusName ?? '—'}</td>
                  <td className={styles.treeActionCell}>
                    <Link
                      href={`/p/${item.project.id}`}
                      className={styles.open}
                      aria-label={`Open ${item.project.title}`}
                    >
                      <Icon name="open_in_new" size={18} />
                      <span className={styles.openLabel}>Open</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={styles.hint}>
        Select captures and release them together; each one moves to its parent’s start status.
        Released captures stay listed as Pulled until you leave Inbox.
      </p>
    </div>
  );
}

/**
 * Global Inbox (product.md §4): Card presentation with parent context, the
 * release action labelled with the parent's start status, and Open. Released
 * projects stay visible and marked Pulled until the user leaves Inbox.
 *
 * Tree is an Inbox-specific table for bulk refinement: every visible capture
 * is listed flat (parents can differ), selectable, and releasable in one go.
 * Cards can also be dragged onto the drop area above the Card list; the
 * per-card Release button stays the keyboard-accessible path.
 */
export function InboxPage({ initialItems }: InboxPageProps) {
  const [items, setItems] = useState<InboxItem[]>(initialItems);
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
  const [lastReleased, setLastReleased] = useState<InboxItem | null>(null);

  const resetDrag = () => {
    setDraggingId(null);
    setDropActive(false);
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
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  const release = async (item: InboxItem) => {
    if (pendingId || bulkPending) return;
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
    if (pendingId || bulkPending) return;
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
        {items.length > 0 ? <InboxViewSwitch view={view} onChange={setView} /> : null}
      </header>

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {notice ?? ''}
      </p>

      {error ? (
        <div className={styles.error}>
          <InlineError>{error}</InlineError>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="Inbox is empty"
          description="New projects captured from the top bar appear here for refinement."
        />
      ) : view === 'tree' ? (
        <InboxTree
          items={items}
          pulled={pulled}
          selected={selected}
          bulkPending={bulkPending}
          anyPending={pendingId !== null}
          onToggle={toggleSelection}
          onToggleAll={toggleAll}
          onReleaseSelected={() => void releaseSelected()}
          onClearSelection={() => setSelected(new Set())}
        />
      ) : (
        <div className={styles.cardLayout}>
          <div className={styles.dropRail}>
          <section
            className={styles.dropZone}
            data-active={dropActive || undefined}
            aria-label="Release drop area"
            aria-describedby="inbox-drop-hint"
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
                Each capture moves to its parent’s start status. Prefer the keyboard? Use the
                Release button on a card.
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
                    draggable={canDrag}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', item.project.id);
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingId(item.project.id);
                    }}
                    onDragEnd={resetDrag}
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
                          disabled={Boolean(pendingId) || bulkPending}
                        >
                          Release to {item.startStatusName ?? 'the start status'}
                        </Button>
                      ) : null}
                      {!isPulled && item.canChangeParent ? (
                        <Button
                          variant="quiet"
                          onClick={() => setChangeParentItem(item)}
                          disabled={Boolean(pendingId)}
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
