'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Icon } from '@/components/ui/Icon';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import { useToastMessage } from '@/components/ui/use-live-announcer';
import { requestJson } from '@/lib/api-client';
import {
  DASHBOARD_WIDGET_LABELS,
  isDashboardWidgetPayload,
  type DashboardInboxWidget,
  type DashboardRecentWidget,
} from '@/lib/dashboard';
import { formatDayTime } from '@/lib/format';
import {
  DEFAULT_DASHBOARD,
  isKnownDashboardWidgetId,
  type AuthUser,
  type DashboardPreference,
  type DashboardWidgetId,
  type KnownDashboardPreference,
} from '@/lib/types';
import styles from './Dashboard.module.css';

export interface DashboardProps {
  user: AuthUser;
}

/**
 * Keeps every stored entry (including widget ids this build does not render,
 * so a future/add-on widget preference survives a save) and appends known
 * widgets that are missing from the stored list as hidden.
 */
function sanitizePreferences(raw: DashboardPreference[]): DashboardPreference[] {
  const seen = new Set<string>();
  const prefs: DashboardPreference[] = [];
  for (const entry of raw) {
    if (typeof entry.id !== 'string' || entry.id.length === 0 || seen.has(entry.id)) continue;
    seen.add(entry.id);
    prefs.push({ id: entry.id, visible: entry.visible !== false });
  }
  for (const widget of DEFAULT_DASHBOARD) {
    if (!seen.has(widget.id)) prefs.push({ id: widget.id, visible: false });
  }
  // A missing/corrupt preference falls back to the registered defaults; the
  // "hide all" state is stored as entries with visible:false, never as [].
  return prefs.length > 0 ? prefs : DEFAULT_DASHBOARD.map((entry) => ({ ...entry }));
}

/** Known entries only, in stored order — what the editor can render. */
function knownPreferences(prefs: DashboardPreference[]): KnownDashboardPreference[] {
  const known: KnownDashboardPreference[] = [];
  for (const entry of prefs) {
    if (isKnownDashboardWidgetId(entry.id)) {
      known.push({ id: entry.id, visible: entry.visible });
    }
  }
  return known;
}

/**
 * Home dashboard. Two registered widgets only (Inbox preview and Recent
 * changes); the editor changes visibility and order per user. Each widget owns
 * its request so a failure shows a local Retry and the rest of Home keeps
 * working.
 */
export function Dashboard({ user }: DashboardProps) {
  const router = useRouter();
  const [savedPrefs, setSavedPrefs] = useState<DashboardPreference[]>(() =>
    sanitizePreferences(user.dashboard),
  );
  const [draft, setDraft] = useState<DashboardPreference[]>(() =>
    sanitizePreferences(user.dashboard),
  );
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const { toast, notify, dismiss } = useToastMessage();

  const openEditor = () => {
    setDraft(savedPrefs.map((entry) => ({ ...entry })));
    setEditError(null);
    setEditing(true);
  };

  const moveKnown = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const known = knownPreferences(current);
      const target = index + direction;
      if (target < 0 || target >= known.length) return current;
      const swapped = known.map((entry) => ({ ...entry }));
      const item = swapped[index];
      const other = swapped[target];
      if (!item || !other) return current;
      swapped[index] = other;
      swapped[target] = item;
      let cursor = 0;
      // Id and visibility travel together; unknown stored ids keep their slots.
      return current.map((entry) => {
        if (!isKnownDashboardWidgetId(entry.id)) return entry;
        const replacement = swapped[cursor];
        cursor += 1;
        return replacement
          ? { id: replacement.id, visible: replacement.visible }
          : entry;
      });
    });
  };

  const toggleWidget = (id: DashboardWidgetId, visible: boolean) => {
    setDraft((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, visible } : entry)),
    );
  };

  const restoreDefaults = () => {
    setDraft(DEFAULT_DASHBOARD.map((entry) => ({ ...entry })));
    setEditError(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setEditError(null);
    try {
      const result = await requestJson<{ user: AuthUser }>('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dashboard: draft }),
      });
      if (!result.ok) {
        setEditError(result.message);
        return;
      }
      setSavedPrefs(sanitizePreferences(result.data.user.dashboard));
      setEditing(false);
      notify('Dashboard saved.');
      // Refresh the RSC cache so navigating away and back keeps the new order.
      router.refresh();
    } catch {
      setEditError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(savedPrefs.map((entry) => ({ ...entry })));
    setEditError(null);
    setEditing(false);
  };

  const visible = knownPreferences(savedPrefs).filter((entry) => entry.visible);
  const knownDraft = knownPreferences(draft);

  return (
    <>
      <div className="page-heading">
        <div className="page-heading-text">
          <h1>{editing ? 'Edit dashboard' : 'Home'}</h1>
        </div>
        {editing ? null : (
          <Button
            variant="ghost"
            icon={<Icon name="tune" size={20} />}
            onClick={openEditor}
            className={styles.editButton}
          >
            Edit dashboard
          </Button>
        )}
      </div>

      {editing ? (
        <Card>
          <CardHeader title="Visible widgets and order" />
          <ul className={styles.editorList} aria-label="Dashboard widgets">
            {knownDraft.map((entry, index) => {
              const label = DASHBOARD_WIDGET_LABELS[entry.id];
              return (
                <li key={entry.id} className={styles.editorRow}>
                  <Checkbox
                    id={`dashboard-widget-${entry.id}`}
                    name={`widget-${entry.id}`}
                    label={label}
                    checked={entry.visible}
                    onChange={(event) => toggleWidget(entry.id, event.target.checked)}
                  />
                  <div className={styles.moveButtons}>
                    <button
                      type="button"
                      className={styles.moveButton}
                      onClick={() => moveKnown(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${label} up`}
                    >
                      <Icon name="arrow_upward" size={20} />
                    </button>
                    <button
                      type="button"
                      className={styles.moveButton}
                      onClick={() => moveKnown(index, 1)}
                      disabled={index === knownDraft.length - 1}
                      aria-label={`Move ${label} down`}
                    >
                      <Icon name="arrow_downward" size={20} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className={styles.editorHint}>
            One of each widget. Show/hide and reorder; the layout adapts to your device.
          </p>
          {editError ? (
            <div className={styles.editorError}>
              <Notice tone="error">{editError}</Notice>
            </div>
          ) : null}
          <div className={styles.editorActions}>
            <Button onClick={() => void save()} loading={saving} className={styles.saveButton}>
              Save dashboard
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
          </div>
          <div className={styles.editorSecondary}>
            <Button variant="ghost" size="sm" onClick={restoreDefaults} disabled={saving}>
              Restore defaults
            </Button>
          </div>
        </Card>
      ) : visible.length === 0 ? (
        <div className={styles.emptyDashboard} role="status">
          <Icon name="info" size={20} className={styles.emptyIcon} />
          <div>
            <p className={styles.emptyTitle}>Your dashboard is empty</p>
            <p className={styles.emptyDescription}>
              Choose Edit dashboard to show the widgets you find useful.
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((entry) => (
            <DashboardWidget key={entry.id} widgetId={entry.id} />
          ))}
        </div>
      )}

      <Toast
        open={toast !== null}
        message={toast?.message ?? ''}
        tone={toast?.tone ?? 'success'}
        announcementKey={toast?.sequence}
        onClose={dismiss}
      />
    </>
  );
}

interface DashboardWidgetProps {
  widgetId: DashboardWidgetId;
}

type WidgetState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardInboxWidget | DashboardRecentWidget };

/** One widget, one request: a failure is local to this card. */
function DashboardWidget({ widgetId }: DashboardWidgetProps) {
  const label = DASHBOARD_WIDGET_LABELS[widgetId];
  const [state, setState] = useState<WidgetState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: 'loading' });

    const load = async () => {
      try {
        const response = await fetch(`/api/dashboard?widget=${widgetId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (cancelled) return;
        if (!response.ok) {
          const message =
            typeof payload === 'object' &&
            payload !== null &&
            typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
              ? (payload as { error: { message: string } }).error.message
              : 'This widget could not load.';
          setState({ status: 'error', message });
          return;
        }
        const widget =
          typeof payload === 'object' && payload !== null && 'widget' in payload
            ? (payload as { widget?: unknown }).widget
            : undefined;
        if (!isDashboardWidgetPayload(widget) || widget.id !== widgetId) {
          setState({
            status: 'error',
            message: 'This widget returned an unexpected response.',
          });
          return;
        }
        setState({ status: 'ready', data: widget });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({
          status: 'error',
          message: 'Could not reach the server. Check your connection and try again.',
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [widgetId, reloadToken]);

  const heading =
    state.status === 'ready' && state.data.id === 'inbox' ? (
      <>
        Inbox
        <span className={styles.widgetCount}> · {state.data.total}</span>
      </>
    ) : (
      label
    );

  return (
    <Card className={styles.widgetCard} data-widget={widgetId}>
      <CardHeader title={heading} />
      {state.status === 'loading' ? (
        <div className={styles.widgetLoading}>
          <Spinner label={`Loading ${label}`} />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className={styles.widgetErrorBlock}>
          <div className={styles.widgetError} role="alert">
            <Icon name="error_outline" size={20} className={styles.widgetErrorIcon} />
            <div>
              <p className={styles.widgetErrorTitle}>{label} could not load</p>
              <p className={styles.widgetErrorText}>
                Other widgets remain available. Retry this widget.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className={styles.retryButton}
            onClick={() => setReloadToken((token) => token + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' && state.data.id === 'inbox' ? (
        <InboxWidgetBody data={state.data} />
      ) : null}
      {state.status === 'ready' && state.data.id === 'recent' ? (
        <RecentWidgetBody data={state.data} />
      ) : null}
    </Card>
  );
}

function InboxWidgetBody({ data }: { data: DashboardInboxWidget }) {
  return (
    <div className={styles.widgetBody}>
      {data.items.length === 0 ? (
        <p className={styles.widgetEmpty}>Your Inbox is empty.</p>
      ) : (
        <ul className={styles.inboxList}>
          {data.items.map((item) => (
            <li key={item.id} className={styles.inboxItem}>
              <Link href={`/p/${item.id}`} className={styles.inboxTitle}>
                {item.title}
              </Link>
              <p className={styles.inboxMeta}>
                {item.parentTitle ? `${item.parentTitle} · ${item.readinessText}` : item.readinessText}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link href={data.openHref} className={styles.widgetLink}>
        Open Inbox
      </Link>
    </div>
  );
}

function RecentWidgetBody({ data }: { data: DashboardRecentWidget }) {
  return (
    <div className={styles.widgetBody}>
      {data.items.length === 0 ? (
        <p className={styles.widgetEmpty}>No recent changes.</p>
      ) : (
        <ul className={styles.recentList}>
          {data.items.map((event) => (
            <li key={event.id}>
              <Link href={event.href} className={styles.recentRow}>
                <Avatar name={event.actorName} size={32} decorative />
                <span className={styles.recentText}>
                  <span className={styles.recentSummary}>{event.summary}</span>
                  <span className={styles.recentTime}>{formatDayTime(event.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.recentFooter}>Open a project to see its Activity.</p>
    </div>
  );
}
