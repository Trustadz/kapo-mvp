'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, Button, EmptyState, Icon, Input, Toast } from '@/components/ui';
import { RestoreDialog } from '@/components/projects/ProjectDialogs';
import { formatDate, formatPersonName } from '@/lib/format';
import type { SearchResultItem, TrashGroup, TrashItem } from '@/components/projects/types';
import styles from './search.module.css';

export interface SearchPageProps {
  tab: 'search' | 'trash';
  query: string;
  results: SearchResultItem[];
  trashItems: TrashItem[];
  trashGroups: TrashGroup[];
}

/**
 * /search: ordinary permission-filtered results and the separate Trash tab.
 * Trash is grouped by action (F06) and never mixed into ordinary results.
 */
export function SearchPage({ tab, query, results, trashItems, trashGroups }: SearchPageProps) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [toast, setToast] = useState<string | null>(null);
  const [restore, setRestore] = useState<TrashItem | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (value.trim()) params.set('q', value.trim());
    if (tab === 'trash') params.set('tab', 'trash');
    const suffix = params.toString();
    router.push(suffix ? `/search?${suffix}` : '/search');
  };

  const tabHref = (target: 'search' | 'trash') => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (target === 'trash') params.set('tab', 'trash');
    const suffix = params.toString();
    return suffix ? `/search?${suffix}` : '/search';
  };

  return (
    <div className={styles.page}>
      <nav className={styles.tabs} aria-label="Search sections">
        <Link
          href={tabHref('search')}
          className={styles.tab}
          data-active={tab === 'search' || undefined}
          aria-current={tab === 'search' ? 'page' : undefined}
        >
          Search
        </Link>
        <Link
          href={tabHref('trash')}
          className={styles.tab}
          data-active={tab === 'trash' || undefined}
          aria-current={tab === 'trash' ? 'page' : undefined}
        >
          Trash
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.title}>{tab === 'trash' ? 'Trash' : 'Search'}</h1>
        <p className={styles.subtitle}>
          {tab === 'trash'
            ? 'Read-only projects · Permanently removed 30 days after entering Trash'
            : 'Search project titles and available text fields.'}
        </p>
      </header>

      <form className={styles.searchForm} role="search" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="project-search-input">
          {tab === 'trash' ? 'Filter trashed projects' : 'Search projects'}
        </label>
        <div className={styles.searchField}>
          <Icon name="search" size={20} className={styles.searchFieldIcon} />
          <Input
            id="project-search-input"
            className={styles.searchInput}
            type="text"
            name="q"
            placeholder={tab === 'trash' ? 'Filter trashed projects…' : 'Search projects…'}
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      </form>

      {tab === 'search' ? (
        <section aria-label="Search results" className={styles.results}>
          {!query ? (
            <EmptyState
              icon="search"
              title="Find a project"
              description="Enter a title or another available text value to search."
            />
          ) : null}
          {query && results.length === 0 ? (
            <EmptyState
              icon="search"
              title={`No projects match “${query}”`}
              description="Try a shorter or different word."
            />
          ) : null}
          {results.map((result) => (
            <article key={result.id} className={styles.resultCard}>
              <div className={styles.resultHeading}>
                <h2 className={styles.resultTitle}>
                  <Link href={`/p/${result.id}`}>{result.title}</Link>
                </h2>
                {result.archived ? <Badge tone="archived">Archived</Badge> : null}
              </div>
              <p className={styles.context}>
                {result.directAccess ? (
                  'Direct access'
                ) : result.parentTitle ? (
                  result.parentTitle
                ) : (
                  'Root'
                )}
              </p>
              <p className={styles.match}>
                {result.match.field === 'Title'
                  ? 'Title match'
                  : `Match in ${result.match.field}: ${result.match.text}`}
              </p>
            </article>
          ))}
          <p className={styles.note}>Trash is not included in ordinary search.</p>
        </section>
      ) : (
        <section aria-label="Trashed projects" className={styles.results}>
          {trashGroups.length === 0 ? (
            <EmptyState
              icon="delete"
              title="Trash is empty"
              description="Projects you move to Trash appear here for 30 days before permanent removal."
            />
          ) : (
            <ul className={styles.trashList}>
              {trashGroups.map((group) => (
                <li key={`${group.actionId ?? group.lead.id}:${group.lead.id}`}>
                  <article className={styles.trashCard}>
                    <div className={styles.trashCardHeading}>
                      <h2 className={styles.resultTitle}>
                        <Link href={`/p/${group.lead.id}`}>{group.lead.title}</Link>
                      </h2>
                      {group.lead.archived ? <Badge tone="archived">Archived</Badge> : null}
                      {group.separate ? <Badge tone="pulled">Trashed separately</Badge> : null}
                    </div>
                    <p className={styles.context}>
                      {group.lead.parentTitle
                        ? `Under ${group.lead.parentTitle}`
                        : 'Direct access'}{' '}
                      · {group.lead.statusName ?? 'Status unavailable'}
                    </p>
                    <p className={styles.trashMeta}>
                      {group.actor
                        ? `Trashed by ${formatPersonName(group.actor.username)} · `
                        : 'Trashed · '}
                      {group.actionCreatedAt || group.lead.trashedAt
                        ? formatDate((group.actionCreatedAt ?? group.lead.trashedAt) as string)
                        : 'recently'}
                    </p>
                    <p className={styles.trashMeta}>
                      Purge deadline:{' '}
                      {group.lead.purgeDeadline
                        ? formatDate(group.lead.purgeDeadline)
                        : '30 days after trashing'}
                    </p>
                    {group.alsoTrashed.length > 0 ? (
                      <details className={styles.trashMore}>
                        <summary>
                          Also trashed by this action: {group.alsoTrashed.length} project
                          {group.alsoTrashed.length === 1 ? '' : 's'}
                        </summary>
                        <ul className={styles.trashMoreList}>
                          {group.alsoTrashed.map((item) => (
                            <li key={item.id} className={styles.trashMoreRow}>
                              <span>
                                <Link href={`/p/${item.id}`} className={styles.openLink}>
                                  {item.title}
                                </Link>
                                {item.parentTitle ? ` · under ${item.parentTitle}` : ''}
                              </span>
                              <span>
                                Purge deadline:{' '}
                                {item.purgeDeadline ? formatDate(item.purgeDeadline) : '—'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <div className={styles.trashActions}>
                      <Link href={`/p/${group.lead.id}`} className={styles.openLink}>
                        <Icon name="open_in_new" size={18} />
                        <span>Open</span>
                      </Link>
                      {group.lead.canRestore ? (
                        <Button
                          variant="quiet"
                          size="sm"
                          icon={<Icon name="restore_from_trash" size={18} />}
                          onClick={() => setRestore(group.lead)}
                        >
                          Restore action
                        </Button>
                      ) : null}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <RestoreDialog
        open={restore !== null}
        projectId={restore?.id ?? ''}
        projectTitle={restore?.title ?? ''}
        onClose={() => setRestore(null)}
        onRestored={() => {
          setToast('Project restored.');
          router.refresh();
        }}
      />
      <Toast open={toast !== null} message={toast ?? ''} onClose={() => setToast(null)} />
    </div>
  );
}
