import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { AuditVia } from '@/lib/audit';
import { newId, nowIso } from '@/server/db/util';
import { notifyProjectWatchers } from './notifications';

/**
 * Append-only activity history (build-spec §6 rule 10, product.md §4).
 *
 * Vocabulary lives in `@/lib/audit`; the database stores the raw action string
 * so the log stays readable when the vocabulary grows. There is deliberately no
 * update or delete function: the schema trigger rejects updates.
 */

export interface AuditActorInput {
  id: string;
  via?: AuditVia;
}

export interface AuditEventInput {
  projectId: string;
  actor: AuditActorInput | null;
  action: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  targetId?: string | null;
  detail?: string | null;
  createdAt?: string;
}

/** Records one event. Call inside the transaction that made the change. */
export function recordAuditEvent(db: BetterSqliteDatabase, event: AuditEventInput): string {
  const id = newId();
  const createdAt = event.createdAt ?? nowIso();
  db.prepare(
    `INSERT INTO audit_events
       (id, project_id, actor_id, action, field, old_value, new_value, target_id, detail, created_at,
        via_channel, via_agent, via_token_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    event.projectId,
    event.actor?.id ?? null,
    event.action,
    event.field ?? null,
    event.oldValue ?? null,
    event.newValue ?? null,
    event.targetId ?? null,
    event.detail ?? null,
    createdAt,
    event.actor?.via?.channel ?? null,
    event.actor?.via?.agent ?? null,
    event.actor?.via?.tokenId ?? null,
  );

  // Watch notifications are part of the same write path so no history entry can
  // bypass them. A failure here is isolated: it must never roll back the change.
  try {
    notifyProjectWatchers(db, {
      id,
      projectId: event.projectId,
      actorId: event.actor?.id ?? null,
      action: event.action,
      field: event.field ?? null,
      oldValue: event.oldValue ?? null,
      newValue: event.newValue ?? null,
      targetId: event.targetId ?? null,
      detail: event.detail ?? null,
      createdAt,
    });
  } catch (error) {
    console.error('[kapo:notifications] watch fan-out failed', error);
  }

  return id;
}

export interface ActivityActor {
  id: string;
  username: string;
  avatar: string | null;
}

export interface ActivityEvent {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  detail: string | null;
  createdAt: string;
  actor: ActivityActor | null;
  target: { id: string; title: string } | null;
  /** Non-null when an MCP client (a user's AI agent) made the change. */
  via: { channel: string; agent: string } | null;
}

export interface ActivityPage {
  events: ActivityEvent[];
  nextCursor: string | null;
}

export const ACTIVITY_PAGE_SIZE = 8;

interface ActivityRow {
  id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  detail: string | null;
  created_at: string;
  target_id: string | null;
  actor_id: string | null;
  actor_username: string | null;
  actor_avatar: string | null;
  via_channel: string | null;
  via_agent: string | null;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = raw.indexOf('|');
    if (separator <= 0) return null;
    return { createdAt: raw.slice(0, separator), id: raw.slice(separator + 1) };
  } catch {
    return null;
  }
}

/**
 * Newest-first page of a project's own history. `cursor` is the opaque value
 * from the previous page, powering "Load older activity" (product.md §4).
 */
interface TargetDisclosure {
  /** Whether the target object (and its snapshot title) may be rendered. */
  visible: boolean;
  /** Whether the write-time title snapshot must be scrubbed too. */
  redactSnapshot: boolean;
}

function targetDisclosure(
  options: ListActivityOptions,
  targetId: string,
): TargetDisclosure {
  const exists = options.targetExists ? options.targetExists(targetId) : true;
  // Purged target: it is not a live access leak, so keep the AR-048 snapshot.
  if (!exists) return { visible: true, redactSnapshot: false };
  const readable = options.canReadTarget ? options.canReadTarget(targetId) : true;
  return readable
    ? { visible: true, redactSnapshot: false }
    : { visible: false, redactSnapshot: true };
}

export interface ListActivityOptions {
  limit?: number;
  cursor?: string | null;
  /**
   * Permission predicate for `target_id`. When provided, a target title is
   * only exposed if the viewer can currently read the target project, so a
   * privately scoped child title never leaks through its parent's history
   * (AR-029 + access modes).
   */
  canReadTarget?: (targetProjectId: string) => boolean;
  /**
   * Predicate for whether the target project still exists. Purged targets keep
   * their write-time snapshot (AR-048); hidden-but-existing targets do not.
   */
  targetExists?: (targetProjectId: string) => boolean;
}

export function listActivity(
  db: BetterSqliteDatabase,
  projectId: string,
  options: ListActivityOptions = {},
): ActivityPage {
  const limit = Math.min(Math.max(options.limit ?? ACTIVITY_PAGE_SIZE, 1), 50);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;

  const rows = (
    cursor
      ? db
          .prepare(
            `SELECT e.id, e.action, e.field, e.old_value, e.new_value, e.detail, e.created_at,
                    e.target_id, e.actor_id, e.via_channel, e.via_agent,
                    u.username AS actor_username, u.avatar AS actor_avatar
               FROM audit_events e
               LEFT JOIN users u ON u.id = e.actor_id
              WHERE e.project_id = ?
                AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))
              ORDER BY e.created_at DESC, e.id DESC
              LIMIT ?`,
          )
          .all(projectId, cursor.createdAt, cursor.createdAt, cursor.id, limit)
      : db
          .prepare(
            `SELECT e.id, e.action, e.field, e.old_value, e.new_value, e.detail, e.created_at,
                    e.target_id, e.actor_id, e.via_channel, e.via_agent,
                    u.username AS actor_username, u.avatar AS actor_avatar
               FROM audit_events e
               LEFT JOIN users u ON u.id = e.actor_id
              WHERE e.project_id = ?
              ORDER BY e.created_at DESC, e.id DESC
              LIMIT ?`,
          )
          .all(projectId, limit)
  ) as ActivityRow[];

  const events: ActivityEvent[] = rows.map((row) => {
    let oldValue = row.old_value;
    let newValue = row.new_value;
    let target: ActivityEvent['target'] = null;

    if (row.target_id) {
      const disclosure = targetDisclosure(options, row.target_id);
      if (disclosure.visible) {
        // Child events render the write-time title snapshot (`new_value`),
        // never a live join, so a renamed/purged target stays stable
        // (AR-029/AR-048).
        target = { id: row.target_id, title: newValue ?? 'a child project' };
      }
      if (disclosure.redactSnapshot) {
        // The target still exists but the viewer cannot read it: null the
        // target *and* every title snapshot so no title reaches the JSON or
        // the Activity UI ("a child project" is rendered instead).
        oldValue = null;
        newValue = null;
      }
    }

    return {
      id: row.id,
      action: row.action,
      field: row.field,
      oldValue,
      newValue,
      detail: row.detail,
      createdAt: row.created_at,
      actor:
        row.actor_id && row.actor_username
          ? { id: row.actor_id, username: row.actor_username, avatar: row.actor_avatar }
          : null,
      target,
      via:
        row.via_channel && row.via_agent
          ? { channel: row.via_channel, agent: row.via_agent }
          : null,
    };
  });

  const last = rows.at(-1);
  const nextCursor =
    rows.length === limit && last ? encodeCursor(last.created_at, last.id) : null;

  return { events, nextCursor };
}
