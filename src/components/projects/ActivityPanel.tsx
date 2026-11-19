'use client';

import { useState } from 'react';
import { Avatar, Button, Card, Icon, Notice } from '@/components/ui';
import { formatDateTime, formatPersonName } from '@/lib/format';
import { fetchActivityPage } from './api';
import type { ActivityEvent, ActivityPageData } from './types';
import styles from './ProjectPage.module.css';

function valuesLine(event: ActivityEvent): string | null {
  if (event.oldValue === null && event.newValue === null) return null;
  if (event.field === 'priority') {
    // Priority is a calculated relative ordering, not a scored field (PO m6).
    const before = Number(event.oldValue);
    const after = Number(event.newValue);
    if (Number.isFinite(before) && Number.isFinite(after)) {
      return after < before ? 'Moved earlier among its siblings' : 'Moved later among its siblings';
    }
    return null;
  }
  return `From: ${event.oldValue ?? '—'} · To: ${event.newValue ?? '—'}`;
}

/** Turns an audit row into the Activity sentence pattern from the design. */
function describe(event: ActivityEvent, projectTitle: string): { main: string; detail: string | null } {
  const actor = formatPersonName(event.actor?.username ?? '') || 'Someone';
  const values = valuesLine(event);
  switch (event.action) {
    case 'project.created':
      return { main: `${actor} created ${projectTitle}`, detail: event.detail };
    case 'project.renamed':
      return { main: `${actor} renamed the project`, detail: values };
    case 'project.status_changed':
      return { main: `${actor} changed Status`, detail: values };
    case 'project.archived':
      return { main: `${actor} archived the project`, detail: null };
    case 'project.unarchived':
      return { main: `${actor} unarchived the project`, detail: null };
    case 'project.trashed':
      return { main: `${actor} moved the project to Trash`, detail: event.detail };
    case 'project.restored':
      return { main: `${actor} restored the project from Trash`, detail: event.detail };
    case 'project.moved':
      return { main: `${actor} moved the project`, detail: values };
    case 'project.priority_changed':
      return { main: `${actor} changed the priority`, detail: values };
    case 'project.child_created':
      return {
        main: `${actor} created ${event.target?.title ?? event.newValue ?? 'a child project'}`,
        detail: 'Child project created',
      };
    case 'project.child_trashed':
      return {
        main: `${actor} moved ${event.target?.title ?? event.newValue ?? 'a child project'} to Trash`,
        detail: 'Child project moved to Trash',
      };
    case 'project.inbox_released':
      return { main: `${actor} released it from Inbox`, detail: 'Released from Inbox' };
    case 'workflow.updated':
      return { main: `${actor} changed child workflow`, detail: event.detail };
    default:
      // Never expose internal action constants; fall back to a human field
      // label, or plain copy when no field is available (F19).
      return {
        main: event.field
          ? `${actor} updated the ${event.field}`
          : `${actor} updated the project`,
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
        Activity
      </h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {events.length === 0 ? (
        <p className={styles.dialogHint}>No activity yet.</p>
      ) : (
        <ul className={styles.activityList}>
          {events.map((event) => {
            const { main, detail } = describe(event, projectTitle);
            const actorName = formatPersonName(event.actor?.username ?? '') || 'Someone';
            return (
              <li key={event.id} className={styles.activityRow}>
                <Avatar name={actorName} src={event.actor?.avatar ?? undefined} size={32} decorative />
                <div className={styles.activityBody}>
                  <p className={styles.activityMain}>{main}</p>
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
          Load older activity
        </Button>
      ) : null}
    </Card>
  );
}
