import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { formatPersonName } from '@/lib/format';
import type {
  NotificationActor,
  NotificationData,
  NotificationItem,
  NotificationOriginType,
  NotificationPage,
  NotificationValue,
} from '@/lib/notifications';
import { newId, nowIso, parseJsonObject } from '@/server/db/util';
import {
  canReadProject,
  DomainError,
  isTrashedProject,
  loadAccessContext,
  type AccessUser,
} from './permissions';

/**
 * Core in-app notifications.
 *
 * A notification is always owned by one recipient and is filtered through the
 * recipient's *current* project access on every read. Watches are personal
 * subscriptions, never permissions: watching a project never grants access,
 * and losing access hides its notifications until access returns.
 */

export const NOTIFICATION_RETENTION = 200;
export const NOTIFICATION_LIST_LIMIT = 30;

const ORIGIN_TYPES: readonly NotificationOriginType[] = ['project', 'addon', 'system'];

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  message: string;
  translations: string;
  data: string;
  origin: string;
  origin_type: string;
  origin_id: string | null;
  href: string | null;
  project_id: string | null;
  actor_id: string | null;
  addon_identifier: string | null;
  source_event_id: string | null;
  created_at: string;
  read_at: string | null;
  actor_username: string | null;
  actor_avatar: string | null;
}

export interface CreateNotificationInput {
  userId: string;
  kind: string;
  message: string;
  translations?: Record<string, string>;
  data?: Record<string, unknown>;
  origin: string;
  originType: NotificationOriginType;
  originId?: string | null;
  href?: string | null;
  projectId?: string | null;
  actorId?: string | null;
  addonIdentifier?: string | null;
  sourceEventId?: string | null;
  createdAt?: string;
}

export interface AddonNotificationRequest {
  recipients: readonly string[];
  message: string;
  kind?: string;
  translations?: Record<string, string>;
  data?: Record<string, unknown>;
  href?: string | null;
  sourceEventId?: string | null;
}

export interface AddonNotificationContext {
  projectId: string;
  actorId: string | null;
  addonIdentifier: string;
  addonName: string;
}

/** A scalar-only view of notification data; objects/arrays are dropped. */
function sanitizeData(raw: Record<string, unknown> | undefined): Record<string, NotificationValue> {
  if (!raw) return {};
  const out: Record<string, NotificationValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.length === 0 || key.length > 64) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 2000);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}

function sanitizeTranslations(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [locale, template] of Object.entries(raw)) {
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(locale)) continue;
    if (typeof template !== 'string' || template.trim().length === 0) continue;
    out[locale] = template.slice(0, 2000);
  }
  return out;
}

function cleanText(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new DomainError(422, 'validation_failed', `${label} is required.`);
  if (trimmed.length > max) {
    throw new DomainError(422, 'validation_failed', `${label} is too long.`);
  }
  return trimmed;
}

/** Internal application paths only. A protocol-relative URL is not allowed. */
export function safeNotificationHref(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const href = value.trim();
  if (href.length === 0 || href.length > 2048) return null;
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null;
  return href;
}

function parseTranslations(raw: string): Record<string, string> {
  const parsed = parseJsonObject(raw);
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(parsed)) {
    if (typeof value === 'string') out[locale] = value;
  }
  return out;
}

function parseData(raw: string): NotificationData {
  const parsed = parseJsonObject(raw);
  const out: NotificationData = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (value === null) {
      out[key] = null;
    }
  }
  return out;
}

function mapRow(row: NotificationRow): NotificationItem {
  const actor: NotificationActor | null =
    row.actor_id && row.actor_username
      ? { id: row.actor_id, username: row.actor_username, avatar: row.actor_avatar }
      : null;
  const originType = ORIGIN_TYPES.includes(row.origin_type as NotificationOriginType)
    ? (row.origin_type as NotificationOriginType)
    : 'system';
  return {
    id: row.id,
    kind: row.kind,
    message: row.message,
    translations: parseTranslations(row.translations),
    data: parseData(row.data),
    origin: row.origin,
    originType,
    originId: row.origin_id,
    href: safeNotificationHref(row.href),
    projectId: row.project_id,
    addonIdentifier: row.addon_identifier,
    actor,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/**
 * Projects whose notifications the user can currently see. This is
 * `canReadProject`, deliberately not `isActiveProject`: a notification about a
 * project that was just trashed or archived still matters, and the project page
 * remains available for a trashed project. Archived-hidden pages can still be
 * opened via Show archived.
 */
function readableProjectIds(db: BetterSqliteDatabase, user: AccessUser): string[] {
  const ctx = loadAccessContext(db, user);
  const ids: string[] = [];
  for (const [projectId, role] of ctx.roleById) {
    if (role !== null) ids.push(projectId);
  }
  return ids;
}

function projectFilter(projectIds: readonly string[], column: string): string {
  if (projectIds.length === 0) return `${column} IS NULL`;
  const placeholders = projectIds.map(() => '?').join(',');
  return `(${column} IS NULL OR ${column} IN (${placeholders}))`;
}

function canUserReadProject(
  db: BetterSqliteDatabase,
  userId: string,
  projectId: string,
): boolean {
  const row = db
    .prepare('SELECT app_role, show_archived FROM users WHERE id = ?')
    .get(userId) as { app_role: string; show_archived: number } | undefined;
  if (!row) return false;
  const ctx = loadAccessContext(db, {
    id: userId,
    appRole: row.app_role as AccessUser['appRole'],
    showArchived: row.show_archived === 1,
  });
  return canReadProject(ctx, projectId);
}

/** Keeps at most NOTIFICATION_RETENTION rows per recipient, deleting old read rows first. */
export function pruneNotifications(db: BetterSqliteDatabase, userId: string): void {
  db.prepare(
    `DELETE FROM notifications
      WHERE user_id = ?
        AND read_at IS NOT NULL
        AND id NOT IN (
          SELECT id FROM notifications
           WHERE user_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?
        )`,
  ).run(userId, userId, NOTIFICATION_RETENTION);
}

/** Inserts one notification; returns null when the recipient cannot see the project. */
export function createNotification(
  db: BetterSqliteDatabase,
  input: CreateNotificationInput,
): string | null {
  if (input.projectId && !canUserReadProject(db, input.userId, input.projectId)) {
    return null;
  }
  if (input.sourceEventId) {
    const duplicate = db
      .prepare(
        'SELECT 1 AS found FROM notifications WHERE user_id = ? AND source_event_id = ?',
      )
      .get(input.userId, input.sourceEventId);
    if (duplicate) return null;
  }

  const id = newId();
  const createdAt = input.createdAt ?? nowIso();
  const origin = cleanText(input.origin, 300, 'Notification origin');
  db.prepare(
    `INSERT INTO notifications
       (id, user_id, kind, message, translations, data, origin, origin_type, origin_id,
        href, project_id, actor_id, addon_identifier, source_event_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    cleanText(input.kind, 120, 'Notification kind'),
    cleanText(input.message, 2000, 'Notification message'),
    JSON.stringify(sanitizeTranslations(input.translations)),
    JSON.stringify(sanitizeData(input.data)),
    origin,
    input.originType,
    input.originId ?? null,
    safeNotificationHref(input.href),
    input.projectId ?? null,
    input.actorId ?? null,
    input.addonIdentifier ?? null,
    input.sourceEventId ?? null,
    createdAt,
  );
  pruneNotifications(db, input.userId);
  return id;
}

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

export interface ListNotificationsOptions {
  limit?: number;
  cursor?: string | null;
}

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Cursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = raw.indexOf('|');
    if (separator <= 0) return null;
    return { createdAt: raw.slice(0, separator), id: raw.slice(separator + 1) };
  } catch {
    return null;
  }
}

function listLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) return NOTIFICATION_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

export function countUnreadNotifications(
  db: BetterSqliteDatabase,
  user: AccessUser,
): number {
  const projectIds = readableProjectIds(db, user);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM notifications n
        WHERE n.user_id = ?
          AND n.read_at IS NULL
          AND ${projectFilter(projectIds, 'n.project_id')}`,
    )
    .get(user.id, ...projectIds) as { count: number };
  return row.count;
}

/** Newest-first page plus the recipient's unread count. */
export function listNotifications(
  db: BetterSqliteDatabase,
  user: AccessUser,
  options: ListNotificationsOptions = {},
): NotificationPage {
  const projectIds = readableProjectIds(db, user);
  const limit = listLimit(options.limit);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const filter = projectFilter(projectIds, 'n.project_id');

  const rows = (
    cursor
      ? db
          .prepare(
            `SELECT n.*, u.username AS actor_username, u.avatar AS actor_avatar
               FROM notifications n
               LEFT JOIN users u ON u.id = n.actor_id
              WHERE n.user_id = ?
                AND ${filter}
                AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))
              ORDER BY n.created_at DESC, n.id DESC
              LIMIT ?`,
          )
          .all(
            user.id,
            ...projectIds,
            cursor.createdAt,
            cursor.createdAt,
            cursor.id,
            limit,
          )
      : db
          .prepare(
            `SELECT n.*, u.username AS actor_username, u.avatar AS actor_avatar
               FROM notifications n
               LEFT JOIN users u ON u.id = n.actor_id
              WHERE n.user_id = ?
                AND ${filter}
              ORDER BY n.created_at DESC, n.id DESC
              LIMIT ?`,
          )
          .all(user.id, ...projectIds, limit)
  ) as NotificationRow[];

  const last = rows.at(-1);
  return {
    notifications: rows.map(mapRow),
    nextCursor: rows.length === limit && last ? encodeCursor(last.created_at, last.id) : null,
    unreadCount: countUnreadNotifications(db, user),
  };
}

/**
 * Marks visible notifications read. With no `ids`, marks every visible unread
 * notification (the panel-close behaviour). Unknown/foreign ids are ignored.
 */
export function markNotificationsRead(
  db: BetterSqliteDatabase,
  user: AccessUser,
  ids?: readonly string[],
): { unreadCount: number } {
  const projectIds = readableProjectIds(db, user);
  const filter = projectFilter(projectIds, 'project_id');
  const readAt = nowIso();
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE notifications
          SET read_at = ?
        WHERE user_id = ?
          AND read_at IS NULL
          AND ${filter}
          AND id IN (${placeholders})`,
    ).run(readAt, user.id, ...projectIds, ...ids);
  } else if (!ids) {
    db.prepare(
      `UPDATE notifications
          SET read_at = ?
        WHERE user_id = ?
          AND read_at IS NULL
          AND ${filter}`,
    ).run(readAt, user.id, ...projectIds);
  }
  return { unreadCount: countUnreadNotifications(db, user) };
}

/* ------------------------------------------------------------------------- */
/* Project watches                                                           */
/* ------------------------------------------------------------------------- */

export function isProjectWatched(
  db: BetterSqliteDatabase,
  userId: string,
  projectId: string,
): boolean {
  const row = db
    .prepare('SELECT 1 AS found FROM project_watches WHERE user_id = ? AND project_id = ?')
    .get(userId, projectId);
  return row !== undefined;
}

/** Toggle (null) or set an explicit watch. Watching never grants access. */
export function setProjectWatch(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  watch: boolean | null,
): { watching: boolean } {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  const currently = isProjectWatched(db, user.id, projectId);
  const next = watch === null ? !currently : watch;
  if (next === currently) return { watching: currently };
  if (next) {
    if (isTrashedProject(ctx, projectId)) {
      throw new DomainError(
        409,
        'trashed_read_only',
        'Restore this project before watching it.',
      );
    }
    db.prepare(
      'INSERT OR IGNORE INTO project_watches (user_id, project_id, created_at) VALUES (?, ?, ?)',
    ).run(user.id, projectId, nowIso());
  } else {
    db.prepare(
      'DELETE FROM project_watches WHERE user_id = ? AND project_id = ?',
    ).run(user.id, projectId);
  }
  return { watching: next };
}

/* ------------------------------------------------------------------------- */
/* Watch fan-out                                                             */
/* ------------------------------------------------------------------------- */

export interface WatchAuditEvent {
  id: string;
  projectId: string;
  actorId: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
}

interface NotificationProjectRow {
  title: string;
  parent_id: string | null;
}

function targetTitle(
  db: BetterSqliteDatabase,
  targetId: string | null,
  fallback: string | null,
): string | null {
  if (!targetId) return fallback;
  const row = db
    .prepare('SELECT title FROM projects WHERE id = ?')
    .get(targetId) as { title: string } | undefined;
  return row?.title ?? fallback;
}

function watchFallbackMessage(
  event: WatchAuditEvent,
  actor: string,
  projectTitle: string,
  childTitle: string | null,
): string {
  const oldValue = event.oldValue ?? '';
  const newValue = event.newValue ?? '';
  switch (event.action) {
    case 'project.created':
      return `${actor} created “${projectTitle}”.`;
    case 'project.renamed':
      return `${actor} renamed the project to “${newValue || projectTitle}”.`;
    case 'project.status_changed':
      return oldValue && newValue
        ? `${actor} changed status from “${oldValue}” to “${newValue}”.`
        : `${actor} changed the status.`;
    case 'project.archived':
      return `${actor} archived “${projectTitle}”.`;
    case 'project.unarchived':
      return `${actor} unarchived “${projectTitle}”.`;
    case 'project.trashed':
      return `${actor} moved “${projectTitle}” to Trash.`;
    case 'project.restored':
      return `${actor} restored “${projectTitle}” from Trash.`;
    case 'project.moved':
      return newValue
        ? `${actor} moved “${projectTitle}” to “${newValue}”.`
        : `${actor} moved “${projectTitle}”.`;
    case 'project.priority_changed':
      return `${actor} reordered “${projectTitle}”.`;
    case 'project.inbox_released':
      return `${actor} released “${projectTitle}” from Inbox.`;
    case 'project.child_created':
      return `${actor} created “${childTitle || 'a child project'}” in “${projectTitle}”.`;
    case 'project.child_trashed':
      return `${actor} moved “${childTitle || 'a child project'}” to Trash.`;
    case 'workflow.updated':
      return `${actor} updated the child workflow of “${projectTitle}”.`;
    case 'project.addon_value_changed':
      return event.field
        ? `${actor} updated ${event.field} on “${projectTitle}”.`
        : `${actor} updated “${projectTitle}”.`;
    default:
      return `${actor} updated “${projectTitle}”.`;
  }
}

/**
 * Called by the audit writer after the event row is inserted. Every watcher of
 * the event's own project receives one notification; the actor is skipped.
 * Child edits belong to the child project, so their watchers are independent.
 */
export function notifyProjectWatchers(
  db: BetterSqliteDatabase,
  event: WatchAuditEvent,
): void {
  const project = db
    .prepare('SELECT title, parent_id FROM projects WHERE id = ?')
    .get(event.projectId) as NotificationProjectRow | undefined;
  if (!project) return;

  const watchers = db
    .prepare('SELECT user_id FROM project_watches WHERE project_id = ?')
    .all(event.projectId) as Array<{ user_id: string }>;
  if (watchers.length === 0) return;

  const actorRow = event.actorId
    ? (db.prepare('SELECT username FROM users WHERE id = ?').get(event.actorId) as
        | { username: string }
        | undefined)
    : undefined;
  const actor = actorRow ? formatPersonName(actorRow.username) : 'Someone';
  const childTitle = targetTitle(db, event.targetId, event.newValue);
  const href =
    event.action === 'project.archived' && project.parent_id
      ? `/p/${project.parent_id}`
      : `/p/${event.projectId}`;
  const data = {
    actorName: actor,
    projectTitle: project.title,
    field: event.field,
    oldValue: event.oldValue,
    newValue: event.newValue,
    targetTitle: childTitle,
    detail: event.detail,
  };

  for (const watcher of watchers) {
    if (event.actorId && watcher.user_id === event.actorId) continue;
    try {
      createNotification(db, {
        userId: watcher.user_id,
        kind: event.action,
        message: watchFallbackMessage(event, actor, project.title, childTitle),
        data,
        origin: project.title,
        originType: 'project',
        originId: event.projectId,
        href,
        projectId: event.projectId,
        actorId: event.actorId,
        sourceEventId: event.id,
        createdAt: event.createdAt,
      });
    } catch (error) {
      // A notification problem must never roll back the project write.
      console.error('[kapo:notifications] watch notification failed', error);
    }
  }
}

/**
 * Delivers notifications requested by an add-on. The linked project (when
 * present) is checked for every recipient, so a notification to a non-member is
 * impossible. Invalid requests are logged and skipped rather than surfacing in
 * the add-on's save request.
 */
export function deliverAddonNotifications(
  db: BetterSqliteDatabase,
  context: AddonNotificationContext,
  requests: readonly AddonNotificationRequest[],
): void {
  for (const request of requests) {
    for (const userId of new Set(request.recipients)) {
      try {
        createNotification(db, {
          userId,
          kind: request.kind ?? `addon.${context.addonIdentifier}`,
          message: request.message,
          translations: request.translations,
          data: request.data,
          origin: context.addonName,
          originType: 'addon',
          originId: context.addonIdentifier,
          href: request.href === undefined ? `/p/${context.projectId}` : request.href,
          projectId: context.projectId,
          actorId: context.actorId,
          addonIdentifier: context.addonIdentifier,
          sourceEventId: request.sourceEventId,
        });
      } catch (error) {
        console.error(
          `[kapo:notifications] "${context.addonIdentifier}" notification failed`,
          error,
        );
      }
    }
  }
}
