'use client';

import Link from 'next/link';
import { useState } from 'react';
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
 */
export function InboxPage({ initialItems }: InboxPageProps) {
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [pulled, setPulled] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <ul className={styles.list} aria-label="Projects in the Inbox">
          {items.map((item) => {
            const isPulled = pulled.has(item.project.id);
            const parent = item.project.parent;
            return (
              <li key={item.project.id}>
                <article className={styles.card} data-pulled={isPulled || undefined}>
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
      )}
    </div>
  );
}
