'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, Button, EmptyState, Icon, Input, Toast } from '@/components/ui';
import { useToastMessage } from '@/components/ui/use-live-announcer';
import { RestoreDialog } from '@/components/projects/ProjectDialogs';
import { formatPersonName } from '@/lib/format';
import { useI18n } from '@/i18n/client';
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
  const { t, plural, formatDate } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState(query);
  const { toast, notify, dismiss } = useToastMessage();
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
      <nav className={styles.tabs} aria-label={t('search.sectionsAria')}>
        <Link
          href={tabHref('search')}
          className={styles.tab}
          data-active={tab === 'search' || undefined}
          aria-current={tab === 'search' ? 'page' : undefined}
        >
          {t('search.search')}
        </Link>
        <Link
          href={tabHref('trash')}
          className={styles.tab}
          data-active={tab === 'trash' || undefined}
          aria-current={tab === 'trash' ? 'page' : undefined}
        >
          {t('search.trash')}
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.title}>
          {tab === 'trash' ? t('search.trash') : t('search.search')}
        </h1>
      </header>

      <form
        className={styles.searchForm}
        role="search"
        aria-label={tab === 'trash' ? t('search.filterAria') : t('search.searchAria')}
        onSubmit={submit}
      >
        <label className="visually-hidden" htmlFor="project-search-input">
          {tab === 'trash' ? t('search.filterAria') : t('search.searchAria')}
        </label>
        <div className={styles.searchField}>
          <Icon name="search" size={20} className={styles.searchFieldIcon} />
          <Input
            id="project-search-input"
            className={styles.searchInput}
            type="text"
            name="q"
            placeholder={
              tab === 'trash' ? t('search.filterPlaceholder') : t('search.searchPlaceholder')
            }
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      </form>

      {tab === 'search' ? (
        <section aria-label={t('search.resultsAria')} className={styles.results}>
          {!query ? (
            <EmptyState icon="search" title={t('search.findTitle')} />
          ) : null}
          {query && results.length === 0 ? (
            <EmptyState icon="search" title={t('search.noMatchTitle', { query })} />
          ) : null}
          {results.map((result) => (
            <article key={result.id} className={styles.resultCard}>
              <div className={styles.resultHeading}>
                <h2 className={styles.resultTitle}>
                  <Link href={`/p/${result.id}`}>{result.title}</Link>
                </h2>
                {result.archived ? (
                  <Badge tone="archived">{t('common.archived')}</Badge>
                ) : null}
              </div>
              <p className={styles.context}>
                {result.directAccess
                  ? t('common.directAccess')
                  : result.parentTitle
                    ? result.parentTitle
                    : t('common.root')}
              </p>
              <p className={styles.match}>
                {result.match.field === 'Title'
                  ? t('search.titleMatch')
                  : result.match.field === 'Text'
                    ? t('search.textMatch', { text: result.match.text })
                    : t('search.matchIn', {
                        field: result.match.field,
                        text: result.match.text,
                      })}
              </p>
            </article>
          ))}
          <p className={styles.note}>{t('search.trashNote')}</p>
        </section>
      ) : (
        <section aria-label={t('search.trashResultsAria')} className={styles.results}>
          {trashGroups.length === 0 ? (
            <EmptyState icon="delete" title={t('search.emptyTrashTitle')} />
          ) : (
            <ul className={styles.trashList}>
              {trashGroups.map((group) => (
                <li key={`${group.actionId ?? group.lead.id}:${group.lead.id}`}>
                  <article className={styles.trashCard}>
                    <div className={styles.trashCardHeading}>
                      <h2 className={styles.resultTitle}>
                        <Link href={`/p/${group.lead.id}`}>{group.lead.title}</Link>
                      </h2>
                      {group.lead.archived ? (
                        <Badge tone="archived">{t('common.archived')}</Badge>
                      ) : null}
                      {group.separate ? (
                        <Badge tone="pulled">{t('search.trashedSeparately')}</Badge>
                      ) : null}
                    </div>
                    <p className={styles.context}>
                      {group.lead.parentTitle
                        ? t('search.under', { title: group.lead.parentTitle })
                        : t('common.directAccess')}{' '}
                      · {group.lead.statusName ?? t('search.statusUnavailable')}
                    </p>
                    <p className={styles.trashMeta}>
                      {group.actor
                        ? t('search.trashedBy', {
                            name: formatPersonName(group.actor.username),
                          })
                        : t('search.trashed')}
                      {group.actionCreatedAt || group.lead.trashedAt
                        ? formatDate((group.actionCreatedAt ?? group.lead.trashedAt) as string)
                        : t('search.recently')}
                    </p>
                    <p className={styles.trashMeta}>
                      {group.lead.purgeDeadline
                        ? t('search.purgeDeadline', {
                            date: formatDate(group.lead.purgeDeadline),
                          })
                        : t('search.purgeFallback')}
                    </p>
                    {group.alsoTrashed.length > 0 ? (
                      <details className={styles.trashMore}>
                        <summary>
                          {plural('plurals.alsoTrashed', group.alsoTrashed.length)}
                        </summary>
                        <ul className={styles.trashMoreList}>
                          {group.alsoTrashed.map((item) => (
                            <li key={item.id} className={styles.trashMoreRow}>
                              <span>
                                <Link href={`/p/${item.id}`} className={styles.openLink}>
                                  {item.title}
                                </Link>
                                {item.parentTitle
                                  ? t('search.alsoTrashedUnder', { title: item.parentTitle })
                                  : ''}
                              </span>
                              <span>
                                {item.purgeDeadline
                                  ? t('search.purgeDeadline', {
                                      date: formatDate(item.purgeDeadline),
                                    })
                                  : '—'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <div className={styles.trashActions}>
                      <Link href={`/p/${group.lead.id}`} className={styles.openLink}>
                        <Icon name="open_in_new" size={18} />
                        <span>{t('common.open')}</span>
                      </Link>
                      {group.lead.canRestore ? (
                        <Button
                          variant="quiet"
                          size="sm"
                          icon={<Icon name="restore_from_trash" size={18} />}
                          onClick={() => setRestore(group.lead)}
                        >
                          {t('search.restoreAction')}
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
          notify(t('search.restored'));
          router.refresh();
        }}
      />
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
