'use client';

import { useState } from 'react';
import { Tabs, tabId, tabPanelId } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { ProjectCommentsData } from '@/lib/comments';
import { ActivityPanel } from './ActivityPanel';
import { CommentsPanel } from './CommentsPanel';
import type { ActivityPageData } from './types';
import styles from './ProjectDiscussion.module.css';

type DiscussionTab = 'comments' | 'history';

export interface ProjectDiscussionProps {
  projectId: string;
  projectTitle: string;
  comments: ProjectCommentsData;
  activity: ActivityPageData;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

/** Comments and History share one tabbed region at the bottom of the page. */
export function ProjectDiscussion({
  projectId,
  projectTitle,
  comments,
  activity,
  notify,
}: ProjectDiscussionProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DiscussionTab>('comments');
  const idPrefix = `project-discussion-${projectId}`;

  return (
    <div className={styles.discussion}>
      <Tabs<DiscussionTab>
        items={[
          { id: 'comments', label: t('comments.title'), icon: 'forum' },
          { id: 'history', label: t('activity.historyTitle'), icon: 'history' },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('comments.tabsAria')}
        idPrefix={idPrefix}
      />

      <div
        role="tabpanel"
        id={tabPanelId(idPrefix, 'comments')}
        aria-labelledby={tabId(idPrefix, 'comments')}
        hidden={tab !== 'comments'}
        tabIndex={tab === 'comments' ? 0 : -1}
        className={styles.panel}
      >
        <CommentsPanel projectId={projectId} comments={comments} notify={notify} />
      </div>

      <div
        role="tabpanel"
        id={tabPanelId(idPrefix, 'history')}
        aria-labelledby={tabId(idPrefix, 'history')}
        hidden={tab !== 'history'}
        tabIndex={tab === 'history' ? 0 : -1}
        className={styles.panel}
      >
        <ActivityPanel
          projectId={projectId}
          projectTitle={projectTitle}
          initial={activity}
          title={t('activity.historyTitle')}
        />
      </div>
    </div>
  );
}
