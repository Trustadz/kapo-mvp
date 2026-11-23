'use client';

import { useEffect, useState } from 'react';
import { Button, Icon, Menu } from '@/components/ui';
import type { MenuItem } from '@/components/ui';
import { type CollectionView } from '@/lib/types';
import { COLLECTION_VIEW_MESSAGE_KEYS } from '@/i18n/domain-labels';
import { useI18n } from '@/i18n/client';
import { CollectionViewSwitch } from '@/components/views/CollectionViews';
import type { CollectionViewContext } from '@/components/views/types';
import {
  filterInboxDescendants,
  filterInboxItems,
} from './collectionVisibility';
import { ProjectFilterBar } from './ProjectFilterBar';
import {
  EMPTY_PROJECT_FILTERS,
  filterProjectDescendants,
  filterProjectItems,
  reporterFilterOptions,
  type ProjectFilterState,
} from './projectFilters';
import type { ProjectPageData } from './types';
import styles from './ProjectPage.module.css';

const VIEW_STORAGE_PREFIX = 'kapo:collection-view:';

export interface ChildProjectsProps {
  data: ProjectPageData;
  canCreate: boolean;
  /** Viewer's per-project "Show Inbox items" preference (default false). */
  showInbox: boolean;
  onAddProject: () => void;
  onMoveProject: (projectId: string, destinationId?: string) => void;
  refresh: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

/**
 * Child-project section: filter bar, toolbar (view selector + Add project) and
 * the four collection views. When there are no children, the collection views,
 * filter bar and selector are hidden while the Add project action is retained
 * (product.md §4). The visible "Child projects" heading is intentionally gone;
 * the section keeps an accessible name only.
 */
export function ChildProjects({
  data,
  canCreate,
  showInbox,
  onAddProject,
  onMoveProject,
  refresh,
  notify,
}: ChildProjectsProps) {
  const { t, plural } = useI18n();
  const availableViews = data.settings.enabled_views.length
    ? data.settings.enabled_views
    : (['kanban'] as CollectionView[]);
  const fallbackView = availableViews.includes(data.settings.default_view)
    ? data.settings.default_view
    : (availableViews[0] ?? 'kanban');
  const [view, setView] = useState<CollectionView>(fallbackView);
  // Filters are session-only and scoped to one project: the project id is kept
  // alongside the state so client-side navigation starts unfiltered instead of
  // inheriting a query that may hide everything.
  const [filterState, setFilterState] = useState({
    projectId: data.project.id,
    filters: EMPTY_PROJECT_FILTERS,
  });
  const filters =
    filterState.projectId === data.project.id ? filterState.filters : EMPTY_PROJECT_FILTERS;
  const setFilters = (next: ProjectFilterState) =>
    setFilterState({ projectId: data.project.id, filters: next });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`${VIEW_STORAGE_PREFIX}${data.project.id}`);
      if (stored && (availableViews as string[]).includes(stored)) {
        setView(stored as CollectionView);
      }
    } catch {
      /* ignore unavailable storage */
    }
  }, [data.project.id, availableViews]);

  const selectView = (next: CollectionView) => {
    setView(next);
    try {
      window.localStorage.setItem(`${VIEW_STORAGE_PREFIX}${data.project.id}`, next);
    } catch {
      /* ignore */
    }
  };

  // Inbox children are hidden by default (issue #16); filtering here keeps
  // Kanban counts, empty states and Tree selection/bulk actions consistent.
  const visibleChildren = filterInboxItems(data.children, showInbox);
  const visibleDescendants = filterInboxDescendants(data.descendants, showInbox);
  const hasChildren = visibleChildren.length > 0;

  // Issue #55: filter before handing the collection to a view so every count,
  // empty state and bulk action operates on the filtered set. The Tree keeps
  // the ancestors of matches in `contextIds`; those rows stay read-only.
  const filteredChildren = filterProjectItems(visibleChildren, filters);
  const filteredTree = filterProjectDescendants(visibleDescendants, filters);
  const filteredDescendants = filteredTree.rows;
  const treeContextIds = filteredTree.contextIds.size > 0 ? filteredTree.contextIds : undefined;

  const isTree = view === 'tree';
  const collectionSize = isTree ? visibleDescendants.length : visibleChildren.length;
  const matchingCount = isTree
    ? filteredDescendants.length - filteredTree.contextIds.size
    : filteredChildren.length;

  // Reporter options come from the unfiltered visible collection for the active
  // view (descendants for Tree), so narrowing the query does not remove options.
  const reporterSource = isTree ? visibleDescendants : visibleChildren;
  const reporters = reporterFilterOptions(reporterSource);
  if (
    filters.reporterId !== null &&
    !reporters.some((reporter) => reporter.id === filters.reporterId)
  ) {
    // Keep the selected reporter selectable after a view switch that no longer
    // lists them (e.g. a descendant-only reporter in Card view).
    const known = [...data.children, ...data.descendants].find(
      (project) => project.reporter.id === filters.reporterId,
    );
    if (known) {
      reporters.push({ id: known.reporter.id, username: known.reporter.username });
      reporters.sort((a, b) => a.username.localeCompare(b.username) || a.id.localeCompare(b.id));
    }
  }

  const toolItems: MenuItem[] = availableViews.map((option) => ({
    id: option,
    label: t(COLLECTION_VIEW_MESSAGE_KEYS[option]),
    selected: option === view,
    onSelect: () => selectView(option),
  }));

  const ctx: CollectionViewContext = {
    projectId: data.project.id,
    projectTitle: data.project.title,
    statuses: data.statuses,
    settings: data.settings,
    canEdit: data.project.canEdit,
    view,
    children: filteredChildren,
    descendants: filteredDescendants,
    contextIds: treeContextIds,
    refresh,
    notify,
    openMoveDialog: onMoveProject,
    openCreateDialog: onAddProject,
  };

  if (!hasChildren && !canCreate) return null;

  const clearFilters = () => setFilters(EMPTY_PROJECT_FILTERS);

  return (
    <section aria-label={t('project.childProjects')}>
      <h2 className="visually-hidden">{t('project.childProjects')}</h2>
      <div className={styles.collectionToolbar}>
        {hasChildren ? (
          <ProjectFilterBar
            filters={filters}
            reporters={reporters}
            onChange={setFilters}
            matchingCount={matchingCount}
            totalCount={collectionSize}
          />
        ) : null}
        <div className={styles.sectionActions}>
          {hasChildren ? (
            <Menu
              label={t('project.collectionView')}
              align="end"
              trigger={({ ref, ...triggerProps }) => (
                <button
                  {...triggerProps}
                  ref={ref}
                  type="button"
                  className={styles.viewTrigger}
                  aria-label={t('project.collectionViewWith', {
                    view: t(COLLECTION_VIEW_MESSAGE_KEYS[view]),
                  })}
                >
                  <span>{t(COLLECTION_VIEW_MESSAGE_KEYS[view])}</span>
                  <Icon name="expand_more" size={18} />
                </button>
              )}
              items={toolItems}
            />
          ) : null}
          {canCreate ? (
            <Button icon={<Icon name="add" size={20} />} onClick={onAddProject}>
              {t('project.addChild')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* F12: with no children the collection, filter bar and view selector are
          hidden entirely; the toolbar keeps the Add project action for editors
          and Activity stays below. */}
      {hasChildren ? (
        matchingCount > 0 ? (
          <CollectionViewSwitch ctx={ctx} />
        ) : (
          <div className={styles.filterEmpty} role="status">
            <span className={styles.filterEmptyText}>{t('project.noMatchFilters')}</span>
            <Button size="sm" variant="quiet" onClick={clearFilters}>
              {t('project.clearFilters')}
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}
