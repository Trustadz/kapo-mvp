/**
 * Shared, client-safe domain types.
 *
 * These mirror the persistence schema in src/server/db/migrations/001_init.sql
 * but never contain server-only imports, so pages and components can use them.
 */

export type AppRole = 'admin' | 'user' | 'viewer';
export type ProjectRole = 'admin' | 'user' | 'viewer';
export type Appearance = 'light' | 'dark' | 'system';

export const APP_ROLES: readonly AppRole[] = ['admin', 'user', 'viewer'];
export const PROJECT_ROLES: readonly ProjectRole[] = ['admin', 'user', 'viewer'];
export const APPEARANCES: readonly Appearance[] = ['light', 'dark', 'system'];

export const APPEARANCE_LABELS: Record<Appearance, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Application Admin',
  user: 'Application User',
  viewer: 'Application Viewer',
};

/**
 * Role line shown under the account name in the shell account menu. The design
 * uses the short application-role names here ("Application Admin", "User",
 * "Viewer") while longer labels remain available for profile/users surfaces.
 */
export const ACCOUNT_ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Application Admin',
  user: 'User',
  viewer: 'Viewer',
};

export interface User {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  appRole: AppRole;
  landingPage: string;
  appearance: Appearance;
  dashboard: DashboardPreference[];
  showArchived: boolean;
  createdAt: string;
}

/** The authenticated user shape exposed to the shell and pages. */
export type AuthUser = User;

export interface ProjectSummary {
  id: string;
  seq: number;
  title: string;
  reporterId: string;
  parentId: string | null;
  statusId: string | null;
  priority: number;
  inbox: boolean;
  archived: boolean;
  trashedAt: string | null;
  purgeDeadline: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Status {
  id: string;
  parentId: string;
  name: string;
  position: number;
  isStart: boolean;
  isFinish: boolean;
}

export interface FavoriteProject {
  id: string;
  title: string;
}

export const COLLECTION_VIEWS = ['kanban', 'card', 'tree', 'list'] as const;
export type CollectionView = (typeof COLLECTION_VIEWS)[number];

export const COLLECTION_VIEW_LABELS: Record<CollectionView, string> = {
  kanban: 'Kanban',
  card: 'Card',
  tree: 'Tree',
  list: 'List',
};

/**
 * Dashboard widget identifiers. "completed-last-week" is intentionally absent:
 * build-spec §1 cuts it from this iteration.
 */
export const DASHBOARD_WIDGETS = ['inbox', 'recent'] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number];

export function isKnownDashboardWidgetId(value: string): value is DashboardWidgetId {
  return (DASHBOARD_WIDGETS as readonly string[]).includes(value);
}

/**
 * Stored dashboard preference. `id` is intentionally a plain string so widget
 * ids the running build does not know (a future add-on widget, or
 * "completed-last-week" if it returns) survive a read/save round-trip. Only
 * known ids are rendered and edited; unknown ids are preserved in the JSON
 * column (dashboard.md, docs/architecture-review.md AR-002/AR-044).
 */
export interface DashboardPreference {
  id: string;
  visible: boolean;
}

/** A preference verified to reference a widget this build can render. */
export interface KnownDashboardPreference extends DashboardPreference {
  id: DashboardWidgetId;
}

/** JSON column hydration helpers ------------------------------------------ */

export function parseDashboard(raw: unknown): DashboardPreference[] {
  if (!raw) return DEFAULT_DASHBOARD;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return DEFAULT_DASHBOARD;
    }
  }
  if (!Array.isArray(value)) return DEFAULT_DASHBOARD;
  const seen = new Set<string>();
  const items: DashboardPreference[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { id?: unknown; visible?: unknown };
    if (
      typeof candidate.id === 'string' &&
      candidate.id.length > 0 &&
      candidate.id.length <= 64 &&
      !seen.has(candidate.id)
    ) {
      seen.add(candidate.id);
      items.push({
        id: candidate.id,
        visible: candidate.visible !== false,
      });
    }
  }
  return items;
}

export const DEFAULT_DASHBOARD: DashboardPreference[] = [
  { id: 'inbox', visible: true },
  { id: 'recent', visible: true },
];
