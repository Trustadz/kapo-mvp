import type { AppRole, CollectionView, ProjectRole, Status } from './types';
import {
  isAddonFieldRef,
  type AddonFieldRef,
  type ProjectAddonEditorData,
  type ProjectCardAddonField,
} from './addons';

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
  /**
   * Compact add-on field values available to this project. Populated on the
   * project page's child/descendant cards only; other card endpoints leave it
   * undefined. Unavailable add-ons are never projected.
   */
  addonFields?: ProjectCardAddonField[];
}

export interface ProjectWithParent extends ProjectCard {
  parentId: string | null;
  /** True when the viewer is a project Admin (bulk move/trash capability). */
  canAdmin?: boolean;
}

/* ------------------------------------------------------------------------- */
/* Layout field references                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Core fields that can be placed in the main area or the properties sidebar.
 * Add-on fields are placed alongside them through the opaque
 * `addon:<identifier>:<fieldKey>` reference (see `src/lib/addons.ts`).
 */
export const PROJECT_FIELD_KEYS = [
  'projectId',
  'parent',
  'reporter',
  'status',
  'created',
  'updated',
] as const;

export type CoreProjectFieldKey = (typeof PROJECT_FIELD_KEYS)[number];
export type ProjectFieldKey = CoreProjectFieldKey | AddonFieldRef;

export const PROJECT_FIELD_LABELS: Record<CoreProjectFieldKey, string> = {
  projectId: 'Project ID',
  parent: 'Parent',
  reporter: 'Reporter',
  status: 'Status',
  created: 'Created',
  updated: 'Updated',
};

/**
 * Configurable per-view property slots (product.md §5/§11, PO P2). Core and
 * add-on fields share the same slot list; add-on fields use the opaque ref.
 */
export const VIEW_FIELD_KEYS = ['status', 'parent', 'reporter', 'created', 'id'] as const;

export type CoreViewFieldKey = (typeof VIEW_FIELD_KEYS)[number];
export type ViewFieldKey = CoreViewFieldKey | AddonFieldRef;

export const VIEW_FIELD_LABELS: Record<CoreViewFieldKey, string> = {
  status: 'Status',
  parent: 'Parent',
  reporter: 'Reporter',
  created: 'Created',
  id: 'Project ID',
};

function isCoreProjectFieldKey(value: string): value is CoreProjectFieldKey {
  return (PROJECT_FIELD_KEYS as readonly string[]).includes(value);
}

function isCoreViewFieldKey(value: string): value is CoreViewFieldKey {
  return (VIEW_FIELD_KEYS as readonly string[]).includes(value);
}

/**
 * A stored main-area/sidebar slot is valid when it is a core key or a
 * syntactically valid add-on reference. Availability is checked separately:
 * stale refs to disabled/unregistered add-ons remain stored but are ignored by
 * presentation code.
 */
export function isStoredProjectFieldKey(value: unknown): value is ProjectFieldKey {
  return (
    typeof value === 'string' && (isCoreProjectFieldKey(value) || isAddonFieldRef(value))
  );
}

/** Same contract as `isStoredProjectFieldKey` for per-view property slots. */
export function isStoredViewFieldKey(value: unknown): value is ViewFieldKey {
  return typeof value === 'string' && (isCoreViewFieldKey(value) || isAddonFieldRef(value));
}

/**
 * Drops add-on refs whose add-on field is not effectively available for the
 * project being rendered. Core keys always survive.
 */
export function filterAvailableAddonRefs<T extends string>(
  keys: readonly T[],
  availableAddonRefs: ReadonlySet<string>,
): T[] {
  return keys.filter((key) => !isAddonFieldRef(key) || availableAddonRefs.has(key));
}

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

/**
 * Which project-page composition the project uses.
 *
 * `full` renders the title header, Details, Properties, the child collection
 * and Activity. `children` drops the Details and Properties cards so the page
 * is only the child viewer and project history; Root uses it by default.
 */
export const PROJECT_LAYOUT_MODES = ['full', 'children'] as const;

export type ProjectLayoutMode = (typeof PROJECT_LAYOUT_MODES)[number];

export const DEFAULT_PROJECT_LAYOUT_MODE: ProjectLayoutMode = 'full';

/** The project's stored mode, or the Root-aware default when it has none. */
export function resolveProjectLayoutMode(
  settings: Pick<ProjectSettingsData, 'layout_mode'>,
  isRoot: boolean,
): ProjectLayoutMode {
  return settings.layout_mode ?? (isRoot ? 'children' : DEFAULT_PROJECT_LAYOUT_MODE);
}

/**
 * Default Details card is intentionally empty (PO issue #17): fields are
 * opt-in through the layout settings. The sidebar keeps the two most useful
 * properties, so a default project page is not blank.
 */
export const DEFAULT_LAYOUT_TEMPLATE: ProjectLayoutTemplate = {
  main: [],
  sidebar: ['status', 'reporter'],
};

export type ProjectAccessMode = 'inherit' | 'custom';

export interface ProjectSettingsData {
  access: ProjectAccessMode;
  inherit_layout: boolean;
  child_position: 'below' | 'above';
  /** Null means the default: full for projects, children+history for Root. */
  layout_mode: ProjectLayoutMode | null;
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
  /** Non-null when the change came through an MCP client (the user's AI agent). */
  via: { channel: string; agent: string } | null;
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
  watching: boolean;
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
  /** Registered add-ons that are effectively available for this project. */
  addons: ProjectAddonEditorData;
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
  /** True when the viewer is a project Admin and may reparent the capture. */
  canChangeParent: boolean;
}

/**
 * One row of the application-wide Inbox Tree (issue #54).
 *
 * The server only returns projects the viewer may read and see (active). When a
 * project's parent is not itself returned — because the viewer cannot read it,
 * or it is trashed/archived-hidden — `parentId` is `null` so the row renders as
 * a top-level direct-access entry instead of leaking the parent title.
 */
export interface InboxTreeNode {
  id: string;
  title: string;
  parentId: string | null;
  statusName: string | null;
  inbox: boolean;
  archived: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  /** Global project priority; siblings render in ascending order. */
  priority: number;
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
