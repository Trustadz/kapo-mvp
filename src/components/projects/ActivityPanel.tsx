'use client';

import { useState } from 'react';
import { Avatar, Button, Card, Icon, Notice } from '@/components/ui';
import { formatPersonName } from '@/lib/format';
import { useI18n, type I18nContextValue } from '@/i18n/client';
import { fetchActivityPage } from './api';
import type { ActivityEvent, ActivityPageData } from './types';
import styles from './ProjectPage.module.css';

function valuesLine(event: ActivityEvent, t: I18nContextValue['t']): string | null {
  if (event.oldValue === null && event.newValue === null) return null;
  if (event.field === 'priority') {
    // Priority is a calculated relative ordering, not a scored field (PO m6).
    const before = Number(event.oldValue);
    const after = Number(event.newValue);
    if (Number.isFinite(before) && Number.isFinite(after)) {
      return after < before ? t('activity.movedEarlier') : t('activity.movedLater');
    }
    return null;
  }
  return t('activity.valuesFromTo', {
    old: event.oldValue ?? '—',
    new: event.newValue ?? '—',
  });
}

/** Turns an audit row into the Activity sentence pattern from the design. */
function localizeDetail(
  detail: string | null,
  t: I18nContextValue['t'],
): string | null {
  if (!detail) return null;
  if (detail === 'Child project created') return t('activity.detailChildCreated');
  if (detail === 'Child project moved to Trash') return t('activity.detailChildTrashed');
  if (detail === 'Moved to Trash. Permanently removed after 30 days.') {
    return t('activity.detailTrashed');
  }
  if (detail === 'Restored from Trash') return t('activity.detailRestored');
  if (detail === 'Updated child workflow') return t('activity.detailWorkflowUpdated');
  if (detail.startsWith('Project created under ')) {
    return t('activity.detailCreatedUnder', { parent: detail.slice('Project created under '.length) });
  }
  if (detail.startsWith('Added statuses: ')) {
    return t('activity.detailAddedStatuses', { names: detail.slice('Added statuses: '.length) });
  }
  if (detail.startsWith('Added status: ')) {
    return t('activity.detailAddedStatus', { names: detail.slice('Added status: '.length) });
  }
  return detail;
}

function fieldLabel(field: string, t: I18nContextValue['t']): string {
  switch (field) {
    case 'title':
      return t('project.title');
    case 'status':
      return t('project.status');
    case 'parent':
      return t('project.parent');
    case 'priority':
      return t('project.priority');
    case 'archived':
      return t('project.archivedField');
    case 'description':
      return t('description.heading');
    default:
      return field;
  }
}

function describe(
  event: ActivityEvent,
  projectTitle: string,
  t: I18nContextValue['t'],
): { main: string; detail: string | null } {
  const actorName = formatPersonName(event.actor?.username ?? '') || t('common.someone');
  const actor = actorName;
  const values = valuesLine(event, t);
  const detail = localizeDetail(event.detail, t);
  switch (event.action) {
    case 'project.created':
      return { main: t('activity.created', { actor, title: projectTitle }), detail };
    case 'project.renamed':
      return { main: t('activity.renamed', { actor }), detail: values };
    case 'project.status_changed':
      return { main: t('activity.statusChanged', { actor }), detail: values };
    case 'project.archived':
      return { main: t('activity.archived', { actor }), detail: null };
    case 'project.unarchived':
      return { main: t('activity.unarchived', { actor }), detail: null };
    case 'project.trashed':
      return { main: t('activity.trashed', { actor }), detail };
    case 'project.restored':
      return { main: t('activity.restored', { actor }), detail };
    case 'project.moved':
      return { main: t('activity.moved', { actor }), detail: values };
    case 'project.priority_changed':
      return { main: t('activity.priorityChanged', { actor }), detail: values };
    case 'project.child_created':
      return {
        main: event.target?.title || event.newValue
          ? t('activity.childCreated', {
              actor,
              title: event.target?.title ?? event.newValue ?? '',
            })
          : t('activity.childCreatedFallback', { actor }),
        detail: t('activity.detailChildCreated'),
      };
    case 'project.child_trashed':
      return {
        main:
          event.target?.title || event.newValue
            ? t('activity.childTrashed', {
                actor,
                title: event.target?.title ?? event.newValue ?? '',
              })
            : t('activity.childTrashedFallback', { actor }),
        detail: t('activity.detailChildTrashed'),
      };
    case 'project.inbox_released':
      return {
        main: t('activity.inboxReleased', { actor }),
        detail: t('activity.detailReleased'),
      };
    case 'project.description_updated':
      return { main: t('activity.descriptionUpdated', { actor }), detail: null };
    case 'project.addon_value_changed':
      // Add-on values store their human field label in `field` (the raw ids
      // live in `detail`), so no core add-on branch is needed here.
      return {
        main: event.field
          ? t('activity.updatedField', { actor, field: fieldLabel(event.field, t) })
          : t('activity.updatedProject', { actor }),
        detail: values,
      };
    case 'workflow.updated':
      return {
        main: t('activity.workflowUpdated', { actor }),
        detail,
      };
    default:
      // Never expose internal action constants; fall back to a human field
      // label, or plain copy when no field is available (F19).
      return {
        main: event.field
          ? t('activity.updatedField', { actor, field: fieldLabel(event.field, t) })
          : t('activity.updatedProject', { actor }),
        detail: null,
      };
  }
}

export interface ActivityPanelProps {
  projectId: string;
  projectTitle: string;
  initial: ActivityPageData;
}

/** Activity history with "Load older activity" pagination (product.md §4). */
export function ActivityPanel({ projectId, projectTitle, initial }: ActivityPanelProps) {
  const { t, formatDateTime } = useI18n();
  const [events, setEvents] = useState<ActivityEvent[]>(initial.events);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOlder = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    const result = await fetchActivityPage(projectId, cursor);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEvents((current) => [...current, ...result.data.events]);
    setCursor(result.data.nextCursor);
  };

  return (
    <Card className={styles.activityCard} as="section" aria-labelledby="activity-heading">
      <h2 id="activity-heading" className={styles.cardTitle}>
        {t('activity.title')}
      </h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {events.length === 0 ? null : (
        <ul className={styles.activityList}>
          {events.map((event) => {
            const { main, detail } = describe(event, projectTitle, t);
            const actorName =
              formatPersonName(event.actor?.username ?? '') || t('common.someone');
            return (
              <li key={event.id} className={styles.activityRow}>
                <span className={styles.activityAvatar}>
                  <Avatar
                    name={actorName}
                    src={event.actor?.avatar ?? undefined}
                    size={32}
                    decorative
                  />
                  {event.via ? (
                    <span className={styles.aiBadge} title={t('activity.viaBadgeLabel')}>
                      <span aria-hidden="true">{t('activity.viaBadge')}</span>
                      <span className="visually-hidden">{t('activity.viaBadgeLabel')}</span>
                    </span>
                  ) : null}
                </span>
                <div className={styles.activityBody}>
                  <p className={styles.activityMain}>
                    {main}
                    {event.via ? (
                      <span className={styles.activityVia}>
                        {' '}
                        {t('activity.viaAgent', { agent: event.via.agent })}
                      </span>
                    ) : null}
                  </p>
                  {detail ? <p className={styles.activityDetail}>{detail}</p> : null}
                </div>
                <time className={styles.activityTime} dateTime={event.createdAt}>
                  {formatDateTime(event.createdAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
      {cursor ? (
        <Button
          variant="ghost"
          size="sm"
          className={styles.loadOlder}
          onClick={() => void loadOlder()}
          loading={loading}
          icon={<Icon name="history" size={18} />}
        >
          {t('activity.loadOlder')}
        </Button>
      ) : null}
    </Card>
  );
}
