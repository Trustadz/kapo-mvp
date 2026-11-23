/**
 * Client-safe notification types and presentation helpers.
 *
 * The server stores event-time data; the client decides how to render it. Core
 * audit kinds are localized from the message catalog, while add-on
 * notifications can supply their own `translations` map and fall back to the
 * plain `message`.
 */
import type { Locale } from '@/i18n/config';
import { interpolate, t, type Vars } from '@/i18n/translate';
import { formatPersonName } from '@/lib/format';

export const NOTIFICATION_PREVIEW_LIMIT = 6;
export const NOTIFICATION_PAGE_LIMIT = 30;

export const NOTIFICATION_ORIGIN_TYPES = ['project', 'addon', 'system'] as const;
export type NotificationOriginType = (typeof NOTIFICATION_ORIGIN_TYPES)[number];

export type NotificationValue = string | number | boolean | null;
export type NotificationData = Record<string, NotificationValue>;

export interface NotificationActor {
  id: string;
  username: string;
  avatar: string | null;
}

export interface NotificationItem {
  id: string;
  /** Core audit action (`project.renamed`, …) or an add-on-defined kind. */
  kind: string;
  /** Plain-text fallback, also used for unknown kinds. */
  message: string;
  /** Optional locale → template map supplied by an add-on. */
  translations: Record<string, string>;
  /** Values available to `{placeholder}` interpolation. */
  data: NotificationData;
  /** Human-readable source: project title or add-on name. */
  origin: string;
  originType: NotificationOriginType;
  originId: string | null;
  /** Internal application path, or null for a non-clickable notification. */
  href: string | null;
  projectId: string | null;
  addonIdentifier: string | null;
  actor: NotificationActor | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  notifications: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

function stringValue(value: NotificationValue | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function notificationVars(item: NotificationItem, locale: Locale): Vars {
  const actor = item.actor
    ? formatPersonName(item.actor.username)
    : stringValue(item.data.actorName) || t(locale, 'common.someone');
  return {
    ...item.data,
    actor,
    origin: item.origin,
  };
}

function coreMessage(item: NotificationItem, locale: Locale, vars: Vars): string | null {
  const actor = vars.actor;
  const oldValue = stringValue(item.data.oldValue);
  const newValue = stringValue(item.data.newValue);
  const field = stringValue(item.data.field);
  const targetTitle = stringValue(item.data.targetTitle) || newValue;

  switch (item.kind) {
    case 'project.created':
      return t(locale, 'notifications.created', { actor, title: item.origin });
    case 'project.renamed':
      return t(locale, 'notifications.renamed', {
        actor,
        title: newValue || item.origin,
      });
    case 'project.status_changed':
      return oldValue && newValue
        ? t(locale, 'notifications.statusChangedFromTo', {
            actor,
            old: oldValue,
            new: newValue,
          })
        : t(locale, 'notifications.statusChanged', { actor });
    case 'project.archived':
      return t(locale, 'notifications.archived', { actor });
    case 'project.unarchived':
      return t(locale, 'notifications.unarchived', { actor });
    case 'project.trashed':
      return t(locale, 'notifications.trashed', { actor });
    case 'project.restored':
      return t(locale, 'notifications.restored', { actor });
    case 'project.moved':
      return newValue
        ? t(locale, 'notifications.movedTo', { actor, destination: newValue })
        : t(locale, 'notifications.moved', { actor });
    case 'project.priority_changed':
      return t(locale, 'notifications.priorityChanged', { actor });
    case 'project.inbox_released':
      return t(locale, 'notifications.inboxReleased', { actor });
    case 'project.child_created':
      return t(locale, 'notifications.childCreated', {
        actor,
        title: targetTitle || t(locale, 'notifications.aChildProject'),
      });
    case 'project.child_trashed':
      return t(locale, 'notifications.childTrashed', {
        actor,
        title: targetTitle || t(locale, 'notifications.aChildProject'),
      });
    case 'workflow.updated':
      return t(locale, 'notifications.workflowUpdated', { actor });
    case 'project.addon_value_changed':
      if (!field) return t(locale, 'notifications.updatedProject', { actor });
      if (oldValue && newValue) {
        return t(locale, 'notifications.fieldChangedFromTo', {
          actor,
          field,
          old: oldValue,
          new: newValue,
        });
      }
      if (newValue) {
        return t(locale, 'notifications.fieldSet', {
          actor,
          field,
          value: newValue,
        });
      }
      if (oldValue) {
        return t(locale, 'notifications.fieldCleared', {
          actor,
          field,
          value: oldValue,
        });
      }
      return t(locale, 'notifications.fieldChanged', { actor, field });
    default:
      return null;
  }
}

/**
 * Renders a notification for the active locale.
 *
 * Add-on translations win over core rendering so an add-on can own its copy.
 * Unknown kinds use the stored message (with `data` interpolation), which keeps
 * older notifications readable after the core vocabulary grows.
 */
export function notificationText(item: NotificationItem, locale: Locale): string {
  const vars = notificationVars(item, locale);
  const translated =
    item.translations[locale] ??
    (locale === 'en' ? undefined : item.translations.en);
  if (translated) return interpolate(translated, vars);
  const core = coreMessage(item, locale, vars);
  if (core !== null) return core;
  return interpolate(item.message, vars);
}

/** The icon used by the notification list for a core audit kind. */
export function notificationIcon(item: NotificationItem): string {
  switch (item.kind) {
    case 'project.renamed':
      return 'edit';
    case 'project.status_changed':
      return 'swap_horiz';
    case 'project.archived':
    case 'project.unarchived':
      return 'archive';
    case 'project.trashed':
    case 'project.child_trashed':
      return 'delete';
    case 'project.restored':
      return 'restore';
    case 'project.moved':
      return 'drive_file_move';
    case 'project.priority_changed':
      return 'low_priority';
    case 'project.inbox_released':
      return 'inbox';
    case 'project.child_created':
      return 'add';
    case 'workflow.updated':
      return 'account_tree';
    case 'project.addon_value_changed':
      return 'edit_note';
    case 'project.created':
      return 'add';
    default:
      if (item.originType === 'addon') return 'extension';
      if (item.originType === 'system') return 'campaign';
      return 'notifications';
  }
}
