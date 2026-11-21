import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { isKnownDashboardWidgetId, type AuthUser, type DashboardWidgetId } from '@/lib/types';
import type {
  DashboardInboxItem,
  DashboardInboxWidget,
  DashboardRecentEvent,
  DashboardRecentWidget,
  DashboardWidgetPayload,
} from '@/lib/dashboard';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { formatPersonName } from '@/lib/format';
import { getDb } from '../db/connection';
import { canReadProject, isActiveProject, loadAccessContext } from './permissions';

/**
 * Home dashboard payloads (build-spec §6 rule 12, dashboard.md).
 *
 * Only the two registered widgets exist in this iteration:
 *  - `inbox`: the first three visible Inbox captures in the global project
 *    order, parent context, readiness, the authorized total and a link to the
 *    global Inbox.
 *  - `recent`: up to five visible audit events with actor, project, timestamp
 *    and a link to the project's Activity.
 *
 * Every count and title is permission-filtered through the shared project
 * permission engine; trashed projects never appear and archived projects follow
 * the viewer's `show_archived` preference. "Completed last week" is deliberately
 * not registered (build-spec §1).
 */

export const DASHBOARD_INBOX_LIMIT = 3;
export const DASHBOARD_RECENT_LIMIT = 5;

/** Prepared in MVP: there are no add-on fields, so every capture is ready. */
const INBOX_READY_TEXT = 'Ready to do';

interface InboxRow {
  id: string;
  title: string;
  parent_id: string;
  parent_title: string;
  status_name: string | null;
}

export function getInboxWidget(
  db: BetterSqliteDatabase,
  user: AuthUser,
): DashboardInboxWidget {
  const ctx = loadAccessContext(db, user);
  const rows = db
    .prepare(
      `SELECT p.id AS id,
              p.title AS title,
              p.parent_id AS parent_id,
              parent.title AS parent_title,
              s.name AS status_name
         FROM projects p
         JOIN projects parent ON parent.id = p.parent_id
         LEFT JOIN statuses s ON s.id = p.status_id
        WHERE p.inbox = 1
          AND p.trashed_at IS NULL
        ORDER BY p.priority ASC, p.created_at ASC, p.seq ASC`,
    )
    .all() as InboxRow[];

  const visible = rows.filter((row) => isActiveProject(ctx, row.id));
  const items: DashboardInboxItem[] = visible
    .slice(0, DASHBOARD_INBOX_LIMIT)
    .map((row) => {
      // The child may be directly granted while its parent is not readable;
      // never leak the parent title from Home (build-spec §6 rule 12).
      const parentReadable = canReadProject(ctx, row.parent_id);
      return {
        id: row.id,
        title: row.title,
        parentId: row.parent_id,
        parentTitle: parentReadable ? row.parent_title : null,
        statusName: parentReadable ? row.status_name : null,
        readiness: 'ready' as const,
        readinessText: INBOX_READY_TEXT,
      };
    });

  return {
    id: 'inbox',
    total: visible.length,
    items,
    openHref: '/inbox',
  };
}

interface RecentRow {
  id: string;
  action: string;
  field: string | null;
  created_at: string;
  project_id: string;
  project_title: string;
  actor_name: string;
  target_id: string | null;
  target_title: string | null;
  via_channel: string | null;
  via_agent: string | null;
}

function eventVerb(
  row: RecentRow,
  targetTitle: string | null,
): string {
  switch (row.action) {
    case AUDIT_ACTIONS.projectCreated:
      return `created ${row.project_title}`;
    case AUDIT_ACTIONS.projectRenamed:
    case AUDIT_ACTIONS.projectStatusChanged:
      return `updated ${row.project_title}`;
    case AUDIT_ACTIONS.projectPriorityChanged:
      return `reordered ${row.project_title}`;
    case AUDIT_ACTIONS.projectArchived:
      return `archived ${row.project_title}`;
    case AUDIT_ACTIONS.projectUnarchived:
      return `unarchived ${row.project_title}`;
    case AUDIT_ACTIONS.projectMoved:
      return `moved ${row.project_title}`;
    case AUDIT_ACTIONS.projectRestored:
      return `restored ${row.project_title}`;
    case AUDIT_ACTIONS.projectTrashed:
      return `moved ${row.project_title} to Trash`;
    case AUDIT_ACTIONS.childCreated:
      return targetTitle ? `created ${targetTitle}` : 'created a child project';
    case AUDIT_ACTIONS.childTrashed:
      return 'moved a child project to Trash';
    default:
      return `updated ${row.project_title}`;
  }
}

export function getRecentWidget(
  db: BetterSqliteDatabase,
  user: AuthUser,
): DashboardRecentWidget {
  const ctx = loadAccessContext(db, user);
  const rows = db
    .prepare(
      `SELECT e.id AS id,
              e.action AS action,
              e.field AS field,
              e.created_at AS created_at,
              e.project_id AS project_id,
              p.title AS project_title,
              COALESCE(u.username, 'Someone') AS actor_name,
              e.target_id AS target_id,
              e.via_channel AS via_channel,
              e.via_agent AS via_agent,
              target.title AS target_title
         FROM audit_events e
         JOIN projects p ON p.id = e.project_id
         LEFT JOIN users u ON u.id = e.actor_id
         LEFT JOIN projects target ON target.id = e.target_id
        ORDER BY e.created_at DESC, e.rowid DESC
        LIMIT 120`,
    )
    .all() as RecentRow[];

  const items: DashboardRecentEvent[] = [];
  for (const row of rows) {
    if (items.length >= DASHBOARD_RECENT_LIMIT) break;
    // Activity is only available while the project exists and is visible.
    if (!isActiveProject(ctx, row.project_id)) continue;
    const targetTitle =
      row.target_id && isActiveProject(ctx, row.target_id) ? row.target_title : null;
    const actorName = formatPersonName(row.actor_name) || 'Someone';
    const verb = eventVerb(row, targetTitle);
    items.push({
      id: row.id,
      actorName,
      projectId: row.project_id,
      projectTitle: row.project_title,
      action: row.action,
      targetTitle,
      summary: `${actorName} ${verb}`,
      createdAt: row.created_at,
      href: `/p/${row.project_id}#activity`,
      via:
        row.via_channel && row.via_agent
          ? { channel: row.via_channel, agent: row.via_agent }
          : null,
    });
  }

  return { id: 'recent', items };
}

/** Loads exactly one widget payload for the local Retry flow. */
export function getDashboardWidget(
  db: BetterSqliteDatabase,
  user: AuthUser,
  widgetId: DashboardWidgetId,
): DashboardWidgetPayload {
  if (widgetId === 'inbox') return getInboxWidget(db, user);
  if (widgetId === 'recent') return getRecentWidget(db, user);
  // Unreachable for the locked registry; keeps the switch honest if a widget is
  // added without a payload builder.
  throw new Error(`Dashboard widget "${String(widgetId)}" has no payload builder.`);
}

/** Visible widgets in the user's saved order (dashboard GET without a filter). */
export function getDashboardWidgets(
  db: BetterSqliteDatabase = getDb(),
  user: AuthUser,
): DashboardWidgetPayload[] {
  const widgets: DashboardWidgetPayload[] = [];
  for (const preference of user.dashboard) {
    if (!preference.visible) continue;
    // Unknown ids are preserved in the stored preference but not rendered.
    if (!isKnownDashboardWidgetId(preference.id)) continue;
    widgets.push(getDashboardWidget(db, user, preference.id));
  }
  return widgets;
}
