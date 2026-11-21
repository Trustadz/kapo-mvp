import { DASHBOARD_WIDGETS, type DashboardWidgetId } from './types';

/**
 * Client-safe dashboard payload types and runtime guards.
 *
 * The Home widgets fetch their own payload so one failing widget can show a
 * local Retry without taking down the rest of Home (dashboard.md).
 */

export type InboxReadiness = 'ready' | 'needs-properties';

export interface DashboardInboxItem {
  id: string;
  title: string;
  parentId: string;
  /** Null when the viewer may read the project but not its parent. */
  parentTitle: string | null;
  statusName: string | null;
  readiness: InboxReadiness;
  readinessText: string;
}

export interface DashboardInboxWidget {
  id: 'inbox';
  total: number;
  items: DashboardInboxItem[];
  openHref: string;
}

export interface DashboardRecentEvent {
  id: string;
  actorName: string;
  projectId: string;
  projectTitle: string;
  /** Audit action constant; clients format the sentence in their locale. */
  action: string;
  /** Human title of a child project target, when the event has one. */
  targetTitle: string | null;
  /** Kept for API compatibility; clients prefer the structured fields. */
  summary: string;
  createdAt: string;
  href: string;
  /** Set when an MCP client (the user's AI agent) made the change. */
  via: { channel: string; agent: string } | null;
}

export interface DashboardRecentWidget {
  id: 'recent';
  items: DashboardRecentEvent[];
}

export type DashboardWidgetPayload = DashboardInboxWidget | DashboardRecentWidget;

export const DASHBOARD_WIDGET_LABELS: Record<DashboardWidgetId, string> = {
  inbox: 'Inbox',
  recent: 'Recent changes',
};

export function isDashboardWidgetId(value: string): value is DashboardWidgetId {
  return (DASHBOARD_WIDGETS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isInboxItem(value: unknown): value is DashboardInboxItem {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.title) &&
    isString(value.parentId) &&
    (value.parentTitle === null || isString(value.parentTitle)) &&
    (value.statusName === null || isString(value.statusName)) &&
    (value.readiness === 'ready' || value.readiness === 'needs-properties') &&
    isString(value.readinessText)
  );
}

function isRecentEvent(value: unknown): value is DashboardRecentEvent {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.actorName) &&
    isString(value.projectId) &&
    isString(value.projectTitle) &&
    isString(value.action) &&
    (value.targetTitle === null || isString(value.targetTitle)) &&
    isString(value.summary) &&
    isString(value.createdAt) &&
    isString(value.href) &&
    (value.via === undefined ||
      value.via === null ||
      (isRecord(value.via) && isString(value.via.channel) && isString(value.via.agent)))
  );
}

/** Validates a widget payload before rendering; a malformed payload becomes a
 * local widget error with Retry rather than crashing Home. */
export function isDashboardWidgetPayload(value: unknown): value is DashboardWidgetPayload {
  if (!isRecord(value)) return false;
  if (value.id === 'inbox') {
    return (
      typeof value.total === 'number' &&
      Number.isFinite(value.total) &&
      value.total >= 0 &&
      Array.isArray(value.items) &&
      value.items.every(isInboxItem) &&
      isString(value.openHref)
    );
  }
  if (value.id === 'recent') {
    return Array.isArray(value.items) && value.items.every(isRecentEvent);
  }
  return false;
}
