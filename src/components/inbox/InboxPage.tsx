'use client';

import Link from 'next/link';
import { useState, type DragEvent } from 'react';
import { Badge, Button, EmptyState, Icon, InlineError } from '@/components/ui';
import type { InboxItem } from '@/components/projects/types';
import { releaseInboxProject } from '@/components/projects/api';
import styles from './inbox.module.css';

export interface InboxPageProps {
  initialItems: InboxItem[];
}

/**
 * Global Inbox (product.md §4): Card presentation with parent context, the
 * release action labelled with the parent's start status, and Open. Released
 * projects stay visible and marked Pulled until the user leaves Inbox.
 *
 * Cards can also be dragged onto the drop area above the list. That is a
 * pointer shortcut for the same release action; the per-card Release button
 * stays the keyboard-accessible path.
 */
export function InboxPage({ initialItems }: InboxPageProps) {
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [pulled, setPulled] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [lastReleased, setLastReleased] = useState<InboxItem | null>(null);

  const resetDrag = () => {
    setDraggingId(null);
    setDropActive(false);
  };

  const release = async (item: InboxItem) => {
    if (pendingId) return;
    setPendingId(item.project.id);
    setError(null);
    const result = await releaseInboxProject(item.project.id);
    setPendingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPulled((current) => {
      const next = new Set(current);
      next.add(item.project.id);
      return next;
    });
    setItems((current) =>
      current.map((entry) =>
        entry.project.id === item.project.id
          ? { ...entry, project: { ...entry.project, inbox: false } }
          : entry,
      ),
    );
    setLastReleased(item);
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
        <h1 className={styles.title}>Inbox</h1>
        <p className={styles.subtitle}>Review captured projects and move them into work.</p>
      </header>

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
      ) : (
        <>
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
                <span>Open</span>
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

          <ul className={styles.list} aria-label="Projects in the Inbox">
            {items.map((item) => {
              const isPulled = pulled.has(item.project.id);
              const parent = item.project.parent;
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
                      {isPulled ? <Badge tone="pulled">Pulled</Badge> : null}
                      {item.project.archived ? <Badge tone="archived">Archived</Badge> : null}
                    </div>
                    <p className={styles.context}>
                      {parent ? (
                        <>
                          Under{' '}
                          <Link href={`/p/${parent.id}`} className={styles.contextLink}>
                            {parent.title}
                          </Link>
                        </>
                      ) : item.parentTitle ? (
                        <>Under {item.parentTitle}</>
                      ) : (
                        'Direct access'
                      )}
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
                          disabled={Boolean(pendingId)}
                        >
                          Release to {item.startStatusName ?? 'the start status'}
                        </Button>
                      ) : null}
                      <Link
                        href={`/p/${item.project.id}`}
                        className={styles.open}
                        aria-label={`Open ${item.project.title}`}
                      >
                        <Icon name="open_in_new" size={18} />
                        <span>Open</span>
                      </Link>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
