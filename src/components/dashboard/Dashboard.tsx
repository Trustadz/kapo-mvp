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
  isDashboardWidgetPayload,
  type DashboardInboxWidget,
  type DashboardRecentEvent,
  type DashboardRecentWidget,
} from '@/lib/dashboard';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { DASHBOARD_WIDGET_MESSAGE_KEYS } from '@/i18n/domain-labels';
import { useI18n, type I18nContextValue } from '@/i18n/client';
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
  const { t } = useI18n();
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
      notify(t('dashboard.saved'));
      // Refresh the RSC cache so navigating away and back keeps the new order.
      router.refresh();
    } catch {
      setEditError(t('common.networkError'));
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
          <h1>{editing ? t('dashboard.editTitle') : t('dashboard.title')}</h1>
        </div>
        {editing ? null : (
          <Button
            variant="ghost"
            icon={<Icon name="tune" size={20} />}
            onClick={openEditor}
            className={styles.editButton}
          >
            {t('dashboard.edit')}
          </Button>
        )}
      </div>

      {editing ? (
        <Card>
          <CardHeader title={t('dashboard.visibleWidgets')} />
          <ul className={styles.editorList} aria-label={t('dashboard.widgetsAria')}>
            {knownDraft.map((entry, index) => {
              const label = t(DASHBOARD_WIDGET_MESSAGE_KEYS[entry.id]);
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
                      aria-label={t('common.moveNameUp', { name: label })}
                    >
                      <Icon name="arrow_upward" size={20} />
                    </button>
                    <button
                      type="button"
                      className={styles.moveButton}
                      onClick={() => moveKnown(index, 1)}
                      disabled={index === knownDraft.length - 1}
                      aria-label={t('common.moveNameDown', { name: label })}
                    >
                      <Icon name="arrow_downward" size={20} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {editError ? (
            <div className={styles.editorError}>
              <Notice tone="error">{editError}</Notice>
            </div>
          ) : null}
          <div className={styles.editorActions}>
            <Button onClick={() => void save()} loading={saving} className={styles.saveButton}>
              {t('dashboard.save')}
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={saving}>
              {t('common.cancel')}
            </Button>
          </div>
          <div className={styles.editorSecondary}>
            <Button variant="ghost" size="sm" onClick={restoreDefaults} disabled={saving}>
              {t('dashboard.restoreDefaults')}
            </Button>
          </div>
        </Card>
      ) : visible.length === 0 ? (
        <div className={styles.emptyDashboard} role="status">
          <Icon name="info" size={20} className={styles.emptyIcon} />
          <div>
            <p className={styles.emptyTitle}>{t('dashboard.emptyTitle')}</p>
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
  const { t } = useI18n();
  const label = t(DASHBOARD_WIDGET_MESSAGE_KEYS[widgetId]);
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
              : t('dashboard.widgetLoadFailed');
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
            message: t('dashboard.unexpectedResponse'),
          });
          return;
        }
        setState({ status: 'ready', data: widget });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({
          status: 'error',
          message: t('common.networkError'),
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
        {t('dashboard.inboxLabel')}
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
          <Spinner label={t('dashboard.loadingWidget', { name: label })} />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className={styles.widgetErrorBlock}>
          <div className={styles.widgetError} role="alert">
            <Icon name="error_outline" size={20} className={styles.widgetErrorIcon} />
            <div>
              <p className={styles.widgetErrorTitle}>
                {t('dashboard.widgetErrorTitle', { name: label })}
              </p>
              <p className={styles.widgetErrorText}>
                {t('dashboard.widgetErrorText')}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className={styles.retryButton}
            onClick={() => setReloadToken((token) => token + 1)}
          >
            {t('common.retry')}
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
  const { t } = useI18n();
  const readinessLabel = (readiness: DashboardInboxWidget['items'][number]['readiness']) =>
    readiness === 'ready' ? t('dashboard.readyToDo') : t('dashboard.needsProperties');
  return (
    <div className={styles.widgetBody}>
      {data.items.length === 0 ? null : (
        <ul className={styles.inboxList}>
          {data.items.map((item) => (
            <li key={item.id} className={styles.inboxItem}>
              <Link href={`/p/${item.id}`} className={styles.inboxTitle}>
                {item.title}
              </Link>
              <p className={styles.inboxMeta}>
                {item.parentTitle
                  ? `${item.parentTitle} · ${readinessLabel(item.readiness)}`
                  : readinessLabel(item.readiness)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link href={data.openHref} className={styles.widgetLink}>
        {t('dashboard.openInbox')}
      </Link>
    </div>
  );
}

function recentSummary(event: DashboardRecentEvent, t: I18nContextValue['t']): string {
  const actor = event.actorName === 'Someone' ? t('common.someone') : event.actorName;
  const project = event.projectTitle;
  switch (event.action) {
    case AUDIT_ACTIONS.projectCreated:
      return t('dashboard.recent.created', { actor, project });
    case AUDIT_ACTIONS.projectRenamed:
    case AUDIT_ACTIONS.projectStatusChanged:
      return t('dashboard.recent.updated', { actor, project });
    case AUDIT_ACTIONS.projectPriorityChanged:
      return t('dashboard.recent.reordered', { actor, project });
    case AUDIT_ACTIONS.projectArchived:
      return t('dashboard.recent.archived', { actor, project });
    case AUDIT_ACTIONS.projectUnarchived:
      return t('dashboard.recent.unarchived', { actor, project });
    case AUDIT_ACTIONS.projectMoved:
      return t('dashboard.recent.moved', { actor, project });
    case AUDIT_ACTIONS.projectRestored:
      return t('dashboard.recent.restored', { actor, project });
    case AUDIT_ACTIONS.projectTrashed:
      return t('dashboard.recent.trashed', { actor, project });
    case AUDIT_ACTIONS.childCreated:
      return event.targetTitle
        ? t('dashboard.recent.childCreated', { actor, target: event.targetTitle })
        : t('dashboard.recent.childCreatedGeneric', { actor });
    case AUDIT_ACTIONS.childTrashed:
      return t('dashboard.recent.childTrashed', { actor });
    default:
      return t('dashboard.recent.updated', { actor, project });
  }
}

function RecentWidgetBody({ data }: { data: DashboardRecentWidget }) {
  const { t, formatDayTime } = useI18n();
  return (
    <div className={styles.widgetBody}>
      {data.items.length === 0 ? null : (
        <ul className={styles.recentList}>
          {data.items.map((event) => (
            <li key={event.id}>
              <Link href={event.href} className={styles.recentRow}>
                <span className={styles.recentAvatar}>
                  <Avatar name={event.actorName} size={32} decorative />
                  {event.via ? (
                    <span className={styles.aiBadge} title={t('activity.viaBadgeLabel')}>
                      <span aria-hidden="true">{t('activity.viaBadge')}</span>
                      <span className="visually-hidden">{t('activity.viaBadgeLabel')}</span>
                    </span>
                  ) : null}
                </span>
                <span className={styles.recentText}>
                  <span className={styles.recentSummary}>
                    {recentSummary(event, t)}
                    {event.via ? (
                      <span className={styles.recentVia}>
                        {' '}
                        {t('activity.viaAgent', { agent: event.via.agent })}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.recentTime}>{formatDayTime(event.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
