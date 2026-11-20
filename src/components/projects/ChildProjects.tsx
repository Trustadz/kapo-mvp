'use client';

import { useEffect, useState } from 'react';
import { Button, Icon, Menu } from '@/components/ui';
import type { MenuItem } from '@/components/ui';
import { COLLECTION_VIEW_LABELS, type CollectionView } from '@/lib/types';
import { CollectionViewSwitch } from '@/components/views/CollectionViews';
import type { CollectionViewContext } from '@/components/views/types';
import {
  filterInboxDescendants,
  filterInboxItems,
} from './collectionVisibility';
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
 * "Child projects" section: toolbar (view selector + Add project) and the four
 * collection views. When there are no children, collection views and the
 * selector are hidden while the Add project action is retained (product.md §4).
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
  const availableViews = data.settings.enabled_views.length
    ? data.settings.enabled_views
    : (['kanban'] as CollectionView[]);
  const fallbackView = availableViews.includes(data.settings.default_view)
    ? data.settings.default_view
    : (availableViews[0] ?? 'kanban');
  const [view, setView] = useState<CollectionView>(fallbackView);

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
  const children = filterInboxItems(data.children, showInbox);
  const descendants = filterInboxDescendants(data.descendants, showInbox);
  const hasChildren = children.length > 0;

  const toolItems: MenuItem[] = availableViews.map((option) => ({
    id: option,
    label: COLLECTION_VIEW_LABELS[option],
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
    children,
    descendants,
    refresh,
    notify,
    openMoveDialog: onMoveProject,
    openCreateDialog: onAddProject,
  };

  if (!hasChildren && !canCreate) return null;

  return (
    <section aria-labelledby="child-projects-heading">
      <div className={styles.sectionHeader}>
        <h2 id="child-projects-heading" className={styles.sectionTitle}>
          Child projects
        </h2>
        <div className={styles.sectionActions}>
          {hasChildren ? (
            <Menu
              label="Collection view"
              align="end"
              trigger={({ ref, ...triggerProps }) => (
                <button
                  {...triggerProps}
                  ref={ref}
                  type="button"
                  className={styles.viewTrigger}
                  aria-label={`Collection view: ${COLLECTION_VIEW_LABELS[view]}`}
                >
                  <span>{COLLECTION_VIEW_LABELS[view]}</span>
                  <Icon name="expand_more" size={18} />
                </button>
              )}
              items={toolItems}
            />
          ) : null}
          {canCreate ? (
            <Button icon={<Icon name="add" size={20} />} onClick={onAddProject}>
              Add child project
            </Button>
          ) : null}
        </div>
      </div>

      {/* F12: with no children the collection and its view selector are hidden
          entirely; the section header keeps the Add project action for editors
          and Activity stays below. */}
      {hasChildren ? <CollectionViewSwitch ctx={ctx} /> : null}
    </section>
  );
}
