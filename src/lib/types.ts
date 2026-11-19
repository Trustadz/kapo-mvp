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

export interface DashboardPreference {
  id: DashboardWidgetId;
  visible: boolean;
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
  const seen = new Set<DashboardWidgetId>();
  const items: DashboardPreference[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { id?: unknown; visible?: unknown };
    if (
      typeof candidate.id === 'string' &&
      (DASHBOARD_WIDGETS as readonly string[]).includes(candidate.id) &&
      !seen.has(candidate.id as DashboardWidgetId)
    ) {
      seen.add(candidate.id as DashboardWidgetId);
      items.push({
        id: candidate.id as DashboardWidgetId,
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
