import type { AppRole, CollectionView, ProjectRole, Status } from './types';

/**
 * Serializable view models shared by the project server pages and the client
 * components. They intentionally contain no SQL/domain imports so they can be
 * used from either environment.
 */

export interface ActorRef {
  id: string;
  username: string;
  avatar: string | null;
}

export interface ProjectLink {
  id: string;
  title: string;
}

export interface ProjectCard {
  id: string;
  seq: number;
  displayId: string;
  title: string;
  statusId: string | null;
  statusName: string | null;
  priority: number;
  inbox: boolean;
  archived: boolean;
  trashed: boolean;
  reporter: ActorRef;
  parentId: string | null;
  parent: ProjectLink | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithParent extends ProjectCard {
  parentId: string | null;
  /** True when the viewer is a project Admin (bulk move/trash capability). */
  canAdmin?: boolean;
}

/** Core fields that can be placed in the main area or the properties sidebar. */
export const PROJECT_FIELD_KEYS = [
  'projectId',
  'parent',
  'reporter',
  'status',
  'created',
  'updated',
] as const;

export type ProjectFieldKey = (typeof PROJECT_FIELD_KEYS)[number];

export const PROJECT_FIELD_LABELS: Record<ProjectFieldKey, string> = {
  projectId: 'Project ID',
  parent: 'Parent',
  reporter: 'Reporter',
  status: 'Status',
  created: 'Created',
  updated: 'Updated',
};

/**
 * Configurable per-view property slots (product.md §5/§11, PO P2).
 *
 * Only core fields are allowed in the MVP; add-on field slots are deferred with
 * the add-on registry (docs/add-ons.md) and will extend this list later.
 */
export const VIEW_FIELD_KEYS = ['status', 'parent', 'reporter', 'created', 'id'] as const;
export type ViewFieldKey = (typeof VIEW_FIELD_KEYS)[number];

export const VIEW_FIELD_LABELS: Record<ViewFieldKey, string> = {
  status: 'Status',
  parent: 'Parent',
  reporter: 'Reporter',
  created: 'Created',
  id: 'Project ID',
};

export type ViewFields = Record<CollectionView, ViewFieldKey[]>;

export const DEFAULT_VIEW_FIELDS: ViewFields = {
  kanban: [],
  card: [],
  tree: ['status'],
  list: [],
};

export interface ProjectLayoutTemplate {
  main: ProjectFieldKey[];
  sidebar: ProjectFieldKey[];
}

export const DEFAULT_LAYOUT_TEMPLATE: ProjectLayoutTemplate = {
  main: ['projectId', 'parent', 'reporter'],
  sidebar: ['status', 'reporter'],
};

export type ProjectAccessMode = 'inherit' | 'custom';

export interface ProjectSettingsData {
  access: ProjectAccessMode;
  inherit_layout: boolean;
  child_position: 'below' | 'above';
  default_view: CollectionView;
  enabled_views: CollectionView[];
  hidden_statuses: string[];
  skip_inbox: boolean;
  layout_template: ProjectLayoutTemplate | null;
  view_fields: ViewFields;
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
}

export interface ActivityPageData {
  events: ActivityEvent[];
  nextCursor: string | null;
}

export interface ProjectPageHeader {
  id: string;
  seq: number;
  displayId: string;
  title: string;
  statusId: string | null;
  statusName: string | null;
  priority: number;
  inbox: boolean;
  archived: boolean;
  trashed: boolean;
  trashedAt: string | null;
  purgeDeadline: string | null;
  createdAt: string;
  updatedAt: string;
  reporter: ActorRef;
  createdBy: ActorRef;
  parent: ProjectLink | null;
  isRoot: boolean;
  favorite: boolean;
  effectiveRole: ProjectRole;
  canEdit: boolean;
  canAdmin: boolean;
  canCreateChild: boolean;
  canMove: boolean;
  /**
   * True when this project (or one of its ancestors) is archived, so turning
   * Show archived off would hide it from the viewer.
   */
  hiddenWhenArchivedOff: boolean;
  /**
   * Where to send the viewer when this project would become hidden: the
   * nearest readable ancestor that is not archived-hidden, else Root, or the
   * dashboard when Root is unreadable. Never points at an ancestor the viewer
   * cannot read.
   */
  fallbackHref: string;
}

export interface ProjectPageData {
  project: ProjectPageHeader;
  rootId: string | null;
  breadcrumb: ProjectLink[];
  /** Workflow this project defines for its children. */
  statuses: Status[];
  /** Workflow that owns this project's own status (null for Root). */
  parentStatuses: Status[];
  children: ProjectCard[];
  /** Flat, depth-first descendants with parent ids for the Tree view. */
  descendants: ProjectWithParent[];
  activity: ActivityPageData;
  settings: ProjectSettingsData;
  /** Layout for this project's own fields (own template or inherited). */
  layout: ProjectLayoutTemplate;
  showArchived: boolean;
}

export interface MoveDestination {
  id: string;
  title: string;
  path: string;
  isRoot: boolean;
  statuses: Status[];
}

export interface MoveInfo {
  project: {
    id: string;
    title: string;
    currentStatusId: string | null;
    currentStatusName: string | null;
    currentParentId: string | null;
    currentParentTitle: string | null;
  };
  destinations: MoveDestination[];
}

export interface RestoreCandidate {
  projectId: string;
  title: string;
  parentTitle: string;
  statusId: string | null;
  statusName: string | null;
  invalid: boolean;
  statuses: Status[];
}

export interface RestoreInfo {
  project: { id: string; title: string; actionId: string | null };
  candidates: RestoreCandidate[];
  requiresMapping: boolean;
}

export interface TrashActor {
  id: string;
  username: string;
  avatar: string | null;
}

export interface TrashItem {
  id: string;
  displayId: string;
  title: string;
  parentId: string | null;
  parentTitle: string | null;
  trashedAt: string | null;
  purgeDeadline: string | null;
  statusName: string | null;
  archived: boolean;
  canRestore: boolean;
  actionId: string | null;
  actionCreatedAt: string | null;
  trashedBy: TrashActor | null;
}

/** One Trash card: an action group, its lead project and what it also trashed. */
export interface TrashGroup {
  actionId: string | null;
  actor: TrashActor | null;
  actionCreatedAt: string | null;
  /** True when this action only contains this one project. */
  separate: boolean;
  lead: TrashItem;
  alsoTrashed: TrashItem[];
}

export interface InboxItem {
  project: ProjectCard;
  parentTitle: string | null;
  startStatusId: string | null;
  startStatusName: string | null;
  canRelease: boolean;
}

export interface SearchMatch {
  field: string;
  text: string;
}

export interface SearchResultItem {
  id: string;
  title: string;
  parentTitle: string | null;
  directAccess: boolean;
  archived: boolean;
  statusName: string | null;
  match: SearchMatch;
}

export interface WorkflowViewData {
  statuses: Status[];
  usage: Record<string, { live: number; trashed: number }>;
  retired: Array<{ id: string; name: string; position: number }>;
}

export interface ProjectMemberView {
  userId: string;
  username: string;
  role: ProjectRole;
  appRole: AppRole;
  descendantGrants: number;
}

export interface MembersData {
  members: ProjectMemberView[];
  canManage: boolean;
  cascadeImpact: number;
  access: ProjectAccessMode;
  isRoot: boolean;
}
