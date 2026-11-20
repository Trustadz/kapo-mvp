import type { MessageKey } from './catalog';
import type {
  Appearance,
  AppRole,
  CollectionView,
  DashboardWidgetId,
} from '@/lib/types';
import type { ProjectFieldKey, ViewFieldKey } from '@/lib/projects';

/**
 * Domain enums → message keys. Keeping the mapping typed means a new status,
 * view or role cannot silently miss a translation.
 */
export const APPEARANCE_MESSAGE_KEYS: Record<Appearance, MessageKey> = {
  light: 'appearance.light',
  dark: 'appearance.dark',
  system: 'appearance.system',
};

export const APP_ROLE_MESSAGE_KEYS: Record<AppRole, MessageKey> = {
  admin: 'roles.applicationAdmin',
  user: 'roles.applicationUser',
  viewer: 'roles.applicationViewer',
};

/** Short role names used in menus and identity lines. */
export const ACCOUNT_ROLE_MESSAGE_KEYS: Record<AppRole, MessageKey> = {
  admin: 'roles.applicationAdmin',
  user: 'roles.user',
  viewer: 'roles.viewer',
};

export const SHORT_ROLE_MESSAGE_KEYS: Record<AppRole, MessageKey> = {
  admin: 'roles.admin',
  user: 'roles.user',
  viewer: 'roles.viewer',
};

export const COLLECTION_VIEW_MESSAGE_KEYS: Record<CollectionView, MessageKey> = {
  kanban: 'views.kanban',
  card: 'views.card',
  tree: 'views.tree',
  list: 'views.list',
};

export const DASHBOARD_WIDGET_MESSAGE_KEYS: Record<DashboardWidgetId, MessageKey> = {
  inbox: 'dashboard.inboxLabel',
  recent: 'dashboard.recentLabel',
};

export const PROJECT_FIELD_MESSAGE_KEYS: Record<ProjectFieldKey, MessageKey> = {
  projectId: 'project.projectId',
  parent: 'project.parent',
  reporter: 'project.reporter',
  status: 'project.status',
  created: 'project.created',
  updated: 'project.updated',
};

export const VIEW_FIELD_MESSAGE_KEYS: Record<ViewFieldKey, MessageKey> = {
  status: 'project.status',
  parent: 'project.parent',
  reporter: 'project.reporter',
  created: 'project.created',
  id: 'project.projectId',
};
