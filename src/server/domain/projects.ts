import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { AUDIT_ACTIONS, AUDIT_FIELDS } from '@/lib/audit';
import type { CollectionView, Status } from '@/lib/types';
import { COLLECTION_VIEWS } from '@/lib/types';
import { cleanTitle, validateProjectTitle } from '@/lib/validation';
import {
  DEFAULT_CHILD_WORKFLOW,
  DEFAULT_PROJECT_SETTINGS,
  insertWorkflow,
  type ProjectSettingsDefaults,
} from '@/server/db/bootstrap';
import { indexProject } from '@/server/db/search';
import { newId, nowIso, parseJsonObject } from '@/server/db/util';
import {
  DEFAULT_LAYOUT_TEMPLATE,
  DEFAULT_VIEW_FIELDS,
  filterAvailableAddonRefs,
  isStoredProjectFieldKey,
  isStoredViewFieldKey,
  type ActivityPageData,
  type ActorRef,
  type MoveDestination,
  type MoveInfo,
  type ProjectCard,
  type ProjectFieldKey,
  type ProjectLayoutTemplate,
  type ProjectLink,
  type ProjectPageData,
  type ProjectSettingsData,
  type ProjectWithParent,
  type ViewFieldKey,
  type ViewFields,
} from '@/lib/projects';
import { availableAddonFieldRefs, isAddonFieldRef } from '@/lib/addons';
import { listActivity, recordAuditEvent } from './audit';
import { assertInboxExitAllowed } from './addon-hooks';
import {
  getProjectAddonCardFields,
  getProjectAddonsForPage,
  reindexProjectAddonSearch,
  reindexProjectAddonSearchSubtree,
} from './project-addons';
import {
  DomainError,
  accessibleAncestors,
  canAdminProject,
  canEditProject,
  canReadProject,
  getRole,
  isActiveProject,
  isArchivedHidden,
  isReadOnlyViewer,
  isRootProject,
  isTrashedProject,
  cloneGrantMap,
  descendantIdsOf,
  effectiveRolesByUser,
  loadAccessUsers,
  loadAccessContext,
  loadGrantMap,
  loadProjectTree,
  readableChildIds,
  roleRank,
  type AccessUser,
} from './permissions';
import { ensureWorkflow, listWorkflow } from './workflow';

/**
 * Project lifecycle core (build-spec §6 rules 1, 4, 7–9; product.md §3–§5).
 *
 * Every mutation validates server-side, writes the audit event and FTS row in
 * the same transaction, and re-checks permissions through the permission
 * engine. `projects.priority` is one app-wide sequence shared by every user
 * (issue #53); it is only unique within a parent at the database level, so the
 * write paths here keep it globally unique. Priority writes are two-phase
 * because UNIQUE(parent_id, priority) is immediate.
 */

export const PROJECT_COLUMNS = `
  p.id, p.seq, p.title, p.reporter_id, p.parent_id, p.status_id, p.priority,
  p.inbox, p.archived, p.trashed_at, p.trash_action_id, p.purge_deadline,
  p.addon_data, p.settings, p.created_by, p.created_at, p.updated_at,
  reporter.username AS reporter_username, reporter.avatar AS reporter_avatar,
  creator.username AS creator_username, creator.avatar AS creator_avatar,
  parent.title AS parent_title, status.name AS status_name
`;

interface ProjectRow {
  id: string;
  seq: number;
  title: string;
  reporter_id: string;
  parent_id: string | null;
  status_id: string | null;
  priority: number;
  inbox: number;
  archived: number;
  trashed_at: string | null;
  trash_action_id: string | null;
  purge_deadline: string | null;
  addon_data: string;
  settings: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  reporter_username: string;
  reporter_avatar: string | null;
  creator_username: string;
  creator_avatar: string | null;
  parent_title: string | null;
  status_name: string | null;
}

const PROJECT_FROM = `
  FROM projects p
  JOIN users reporter ON reporter.id = p.reporter_id
  JOIN users creator ON creator.id = p.created_by
  LEFT JOIN projects parent ON parent.id = p.parent_id
  LEFT JOIN statuses status ON status.id = p.status_id
`;

export function displayId(seq: number): string {
  return `KAP-${seq}`;
}

function actorFromRow(
  id: string,
  username: string,
  avatar: string | null,
): ActorRef {
  return { id, username, avatar };
}

function rowReporter(row: ProjectRow): ActorRef {
  return actorFromRow(row.reporter_id, row.reporter_username, row.reporter_avatar);
}

function rowCreator(row: ProjectRow): ActorRef {
  return actorFromRow(row.created_by, row.creator_username, row.creator_avatar);
}

function rowParent(row: ProjectRow): ProjectLink | null {
  if (!row.parent_id || row.parent_title === null) return null;
  return { id: row.parent_id, title: row.parent_title };
}

export function getProjectRow(
  db: BetterSqliteDatabase,
  projectId: string,
): ProjectRow | null {
  const row = db
    .prepare(`SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE p.id = ?`)
    .get(projectId) as ProjectRow | undefined;
  return row ?? null;
}

function requireProjectRow(db: BetterSqliteDatabase, projectId: string): ProjectRow {
  const row = getProjectRow(db, projectId);
  if (!row) throw new DomainError(404, 'not_found', 'Project not found.');
  return row;
}

export function mapProjectCard(row: ProjectRow): ProjectCard {
  return {
    id: row.id,
    seq: row.seq,
    displayId: displayId(row.seq),
    title: row.title,
    statusId: row.status_id,
    statusName: row.status_name,
    priority: row.priority,
    inbox: row.inbox === 1,
    archived: row.archived === 1,
    trashed: row.trashed_at !== null,
    reporter: rowReporter(row),
    parentId: row.parent_id,
    parent: rowParent(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProjectCard(
  db: BetterSqliteDatabase,
  projectId: string,
): ProjectCard | null {
  const row = getProjectRow(db, projectId);
  return row ? mapProjectCard(row) : null;
}

/* ------------------------------------------------------------------------- */
/* Project settings                                                          */
/* ------------------------------------------------------------------------- */

function toCollectionView(value: unknown): CollectionView | null {
  return typeof value === 'string' && (COLLECTION_VIEWS as readonly string[]).includes(value)
    ? (value as CollectionView)
    : null;
}

/**
 * View-property keys that were retired from the selectable options (#4). Stored
 * settings may still contain them, so both reading and validation drop them
 * without reordering the surrounding fields or failing the request.
 */
const RETIRED_VIEW_FIELD_KEYS: ReadonlySet<string> = new Set(['priority']);

function parseViewFields(value: unknown): ViewFields {
  const views: ViewFields = {
    kanban: [...DEFAULT_VIEW_FIELDS.kanban],
    card: [...DEFAULT_VIEW_FIELDS.card],
    tree: [...DEFAULT_VIEW_FIELDS.tree],
    list: [...DEFAULT_VIEW_FIELDS.list],
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return views;
  const candidate = value as Record<string, unknown>;
  for (const view of COLLECTION_VIEWS) {
    const raw = candidate[view];
    if (!Array.isArray(raw)) continue;
    const fields: ViewFieldKey[] = [];
    for (const entry of raw) {
      if (
        typeof entry === 'string' &&
        !RETIRED_VIEW_FIELD_KEYS.has(entry) &&
        isStoredViewFieldKey(entry) &&
        !fields.includes(entry)
      ) {
        fields.push(entry);
      }
    }
    views[view] = fields;
  }
  return views;
}

function parseLayoutTemplate(value: unknown): ProjectLayoutTemplate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as { main?: unknown; sidebar?: unknown };
  const clean = (raw: unknown): ProjectFieldKey[] => {
    if (!Array.isArray(raw)) return [];
    const keys: ProjectFieldKey[] = [];
    for (const entry of raw) {
      if (isStoredProjectFieldKey(entry) && !keys.includes(entry)) {
        keys.push(entry);
      }
    }
    return keys;
  };
  const template = { main: clean(candidate.main), sidebar: clean(candidate.sidebar) };
  if (template.main.length === 0 && template.sidebar.length === 0) return null;
  return template;
}

/** Normalises a projects.settings JSON column into the known shape. */
export function parseProjectSettings(raw: string | null | undefined): ProjectSettingsData {
  const parsed = parseJsonObject(raw);
  const enabledViews: CollectionView[] = [];
  if (Array.isArray(parsed.enabled_views)) {
    for (const entry of parsed.enabled_views) {
      const view = toCollectionView(entry);
      if (view && !enabledViews.includes(view)) enabledViews.push(view);
    }
  }
  if (enabledViews.length === 0) enabledViews.push(...(DEFAULT_PROJECT_SETTINGS.enabled_views as CollectionView[]));

  let defaultView = toCollectionView(parsed.default_view);
  if (!defaultView || !enabledViews.includes(defaultView)) defaultView = enabledViews[0] ?? 'kanban';

  const hiddenStatuses: string[] = [];
  if (Array.isArray(parsed.hidden_statuses)) {
    for (const entry of parsed.hidden_statuses) {
      if (typeof entry === 'string' && !hiddenStatuses.includes(entry)) hiddenStatuses.push(entry);
    }
  }

  return {
    access: parsed.access === 'custom' ? 'custom' : 'inherit',
    inherit_layout: parsed.inherit_layout !== false,
    child_position: parsed.child_position === 'above' ? 'above' : 'below',
    default_view: defaultView,
    enabled_views: enabledViews,
    hidden_statuses: hiddenStatuses,
    skip_inbox: parsed.skip_inbox === true,
    layout_template: parseLayoutTemplate(parsed.layout_template),
    view_fields: parseViewFields(parsed.view_fields),
  };
}

function readRawSettings(db: BetterSqliteDatabase, projectId: string): Record<string, unknown> {
  const row = db.prepare('SELECT settings FROM projects WHERE id = ?').get(projectId) as
    | { settings: string }
    | undefined;
  return parseJsonObject(row?.settings);
}

function writeRawSettings(
  db: BetterSqliteDatabase,
  projectId: string,
  settings: Record<string, unknown>,
): void {
  db.prepare('UPDATE projects SET settings = ? WHERE id = ?').run(
    JSON.stringify(settings),
    projectId,
  );
}

function effectiveLayoutTemplate(
  db: BetterSqliteDatabase,
  projectId: string,
  settings: ProjectSettingsData,
): ProjectLayoutTemplate {
  if (settings.inherit_layout) {
    const row = db.prepare('SELECT parent_id, settings FROM projects WHERE id = ?').get(projectId) as
      | { parent_id: string | null; settings: string }
      | undefined;
    if (row?.parent_id) {
      const parentRow = db.prepare('SELECT settings FROM projects WHERE id = ?').get(row.parent_id) as
        | { settings: string }
        | undefined;
      if (parentRow) {
        const parentSettings = parseProjectSettings(parentRow.settings);
        if (parentSettings.layout_template) return parentSettings.layout_template;
      }
    }
  }
  return settings.layout_template ?? DEFAULT_LAYOUT_TEMPLATE;
}

export interface UpdateProjectSettingsInput {
  access?: unknown;
  view_fields?: unknown;
  inherit_layout?: unknown;
  child_position?: unknown;
  default_view?: unknown;
  enabled_views?: unknown;
  hidden_statuses?: unknown;
  skip_inbox?: unknown;
  layout_template?: unknown;
}

export function getProjectSettings(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): ProjectSettingsData {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) throw new DomainError(404, 'not_found', 'Project not found.');
  const row = requireProjectRow(db, projectId);
  const settings = parseProjectSettings(row.settings);
  // Root is always custom (build-spec §6 rule 2).
  return row.parent_id === null ? { ...settings, access: 'custom' } : settings;
}

export function updateProjectSettings(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  input: UpdateProjectSettingsInput,
): ProjectSettingsData {
  const ctx = loadAccessContext(db, user);
  const row = getProjectRow(db, projectId);
  if (!row || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'Restore this project before changing its settings.');
  }
  if (!canAdminProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You must be a project Admin to change settings.');
  }

  const current = parseProjectSettings(row.settings);
  const isRoot = row.parent_id === null;
  if (isRoot) current.access = 'custom';
  const fields: Record<string, string> = {};

  const next: ProjectSettingsData = { ...current };

  if (input.access !== undefined) {
    if (input.access !== 'inherit' && input.access !== 'custom') {
      fields.access = 'Choose an access mode.';
    } else if (isRoot && input.access === 'inherit') {
      fields.access = 'Root always uses Custom access.';
    } else {
      next.access = input.access;
    }
  }

  if (input.inherit_layout !== undefined) {
    if (typeof input.inherit_layout !== 'boolean') fields.inherit_layout = 'Choose whether to inherit the layout.';
    else next.inherit_layout = input.inherit_layout;
  }

  if (input.child_position !== undefined) {
    if (input.child_position !== 'below' && input.child_position !== 'above') {
      fields.child_position = 'Choose where child projects appear.';
    } else {
      next.child_position = input.child_position;
    }
  }

  if (input.enabled_views !== undefined) {
    const views: CollectionView[] = [];
    if (Array.isArray(input.enabled_views)) {
      for (const entry of input.enabled_views) {
        const view = toCollectionView(entry);
        if (view && !views.includes(view)) views.push(view);
      }
    }
    if (views.length === 0) fields.enabled_views = 'Keep at least one collection view enabled.';
    else next.enabled_views = views;
  }

  if (input.default_view !== undefined) {
    const view = toCollectionView(input.default_view);
    if (!view) fields.default_view = 'Choose a default view.';
    else next.default_view = view;
  }

  if (next.enabled_views.length > 0 && !next.enabled_views.includes(next.default_view)) {
    fields.default_view = 'The default view must be enabled.';
    next.default_view = next.enabled_views[0] as CollectionView;
  }

  if (input.layout_template !== undefined) {
    if (input.layout_template === null) {
      next.layout_template = null;
    } else {
      const template = parseLayoutTemplate(input.layout_template);
      if (!template) fields.layout_template = 'Choose at least one field for the layout.';
      else next.layout_template = template;
    }
  }

  if (input.view_fields !== undefined) {
    if (typeof input.view_fields !== 'object' || input.view_fields === null || Array.isArray(input.view_fields)) {
      fields.view_fields = 'Choose view properties per view.';
    } else {
      const candidate = input.view_fields as Record<string, unknown>;
      const nextViewFields: ViewFields = {
        kanban: [...next.view_fields.kanban],
        card: [...next.view_fields.card],
        tree: [...next.view_fields.tree],
        list: [...next.view_fields.list],
      };
      for (const view of COLLECTION_VIEWS) {
        if (!(view in candidate)) continue;
        const raw = candidate[view];
        if (!Array.isArray(raw)) {
          fields.view_fields = 'Each view needs a list of properties.';
          break;
        }
        const list: ViewFieldKey[] = [];
        for (const entry of raw) {
          // Retired keys are dropped silently so legacy payloads keep working.
          if (typeof entry === 'string' && RETIRED_VIEW_FIELD_KEYS.has(entry)) continue;
          if (!isStoredViewFieldKey(entry)) {
            fields.view_fields =
              'Only supported core properties or add-on fields can be shown in views.';
            break;
          }
          if (!list.includes(entry)) list.push(entry);
        }
        if (fields.view_fields) break;
        nextViewFields[view] = list;
      }
      if (!fields.view_fields) next.view_fields = nextViewFields;
    }
  }

  if (input.skip_inbox !== undefined) {
    if (typeof input.skip_inbox !== 'boolean') fields.skip_inbox = 'Choose the Inbox behaviour.';
    else next.skip_inbox = input.skip_inbox;
  }

  if (input.hidden_statuses !== undefined) {
    const ids: string[] = [];
    if (!Array.isArray(input.hidden_statuses)) {
      fields.hidden_statuses = 'Choose which statuses to hide.';
    } else {
      const validStatuses = new Set(listWorkflow(db, projectId).map((status) => status.id));
      for (const entry of input.hidden_statuses) {
        if (typeof entry !== 'string' || !validStatuses.has(entry)) {
          fields.hidden_statuses = 'Only statuses in this workflow can be hidden.';
          break;
        }
        if (!ids.includes(entry)) ids.push(entry);
      }
      if (!fields.hidden_statuses) next.hidden_statuses = ids;
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new DomainError(422, 'validation_failed', 'Check the highlighted settings.', fields);
  }

  const raw = readRawSettings(db, projectId);
  const merged: Record<string, unknown> = {
    ...raw,
    // Access mode is only changed through the Members API, which validates the
    // cascade and last-Admin invariants; settings writes preserve it.
    access: next.access,
    inherit_layout: next.inherit_layout,
    child_position: next.child_position,
    default_view: next.default_view,
    enabled_views: next.enabled_views,
    hidden_statuses: next.hidden_statuses,
    skip_inbox: next.skip_inbox,
    layout_template: next.layout_template,
    view_fields: next.view_fields,
  };
  const transaction = db.transaction(() => {
    writeRawSettings(db, projectId, merged);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), projectId);
  });
  transaction();
  return parseProjectSettings(JSON.stringify(merged));
}

/* ------------------------------------------------------------------------- */
/* Page data                                                                 */
/* ------------------------------------------------------------------------- */

const ACTIVITY_INITIAL_LIMIT = 8;

export function getProjectPageData(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): ProjectPageData | null {
  const ctx = loadAccessContext(db, user);
  const row = getProjectRow(db, projectId);
  if (!row) return null;
  if (!canReadProject(ctx, projectId)) return null;
  if (!ctx.user.showArchived && isArchivedHidden(ctx, projectId)) return null;

  const isRoot = row.parent_id === null;
  const trashed = row.trashed_at !== null;
  const favoriteRow = db
    .prepare('SELECT 1 AS favorite FROM favorites WHERE user_id = ? AND project_id = ?')
    .get(user.id, projectId) as { favorite: number } | undefined;

  const parentReadable = row.parent_id !== null && canReadProject(ctx, row.parent_id);
  const parentLink = parentReadable && row.parent_title !== null
    ? { id: row.parent_id as string, title: row.parent_title }
    : null;

  // Archived visibility is inherited from ancestors, so turning Show archived
  // off can hide a project even when it is not archived itself. The fallback
  // must be a place the viewer can actually land on: an accessible ancestor
  // that is not archived-hidden, else Root (or the dashboard if Root itself is
  // unreadable). Only readable ancestors are considered, so no inaccessible
  // branch of the tree is exposed.
  const hiddenWhenArchivedOff = isArchivedHidden(ctx, projectId);
  const ancestors = accessibleAncestors(ctx, projectId);
  const nearestVisibleAncestor = [...ancestors]
    .reverse()
    .find((ancestor) => !isArchivedHidden(ctx, ancestor.id));
  const fallbackHref = nearestVisibleAncestor
    ? `/p/${nearestVisibleAncestor.id}`
    : ctx.rootId && canReadProject(ctx, ctx.rootId) && !isArchivedHidden(ctx, ctx.rootId)
      ? `/p/${ctx.rootId}`
      : '/';

  // Add-on availability drives which stored layout/view refs are displayed.
  // Stale refs to disabled or unregistered add-ons stay in the JSON settings but
  // are ignored here, so re-enabling the add-on restores the field placement.
  const addons = getProjectAddonsForPage(db, user, projectId);
  const availableAddonRefs = availableAddonFieldRefs(addons.items);
  const pageSettings = parseProjectSettings(row.settings);
  if (pageSettings.layout_template) {
    pageSettings.layout_template = {
      main: filterAvailableAddonRefs(pageSettings.layout_template.main, availableAddonRefs),
      sidebar: filterAvailableAddonRefs(pageSettings.layout_template.sidebar, availableAddonRefs),
    };
  }
  pageSettings.view_fields = {
    kanban: filterAvailableAddonRefs(pageSettings.view_fields.kanban, availableAddonRefs),
    card: filterAvailableAddonRefs(pageSettings.view_fields.card, availableAddonRefs),
    tree: filterAvailableAddonRefs(pageSettings.view_fields.tree, availableAddonRefs),
    list: filterAvailableAddonRefs(pageSettings.view_fields.list, availableAddonRefs),
  };
  const settings = pageSettings;
  const effectiveLayout = effectiveLayoutTemplate(db, projectId, settings);
  const layout: ProjectLayoutTemplate = {
    main: filterAvailableAddonRefs(effectiveLayout.main, availableAddonRefs),
    sidebar: filterAvailableAddonRefs(effectiveLayout.sidebar, availableAddonRefs),
  };

  // Only project add-on fields referenced by a view property need to reach the
  // child cards; this keeps the payload (and user/select resolution) scoped.
  const viewAddonRefs = new Set<string>();
  for (const view of COLLECTION_VIEWS) {
    for (const key of settings.view_fields[view]) {
      if (isAddonFieldRef(key)) viewAddonRefs.add(key);
    }
  }
  const withAddonFields = (card: ProjectCard): ProjectCard => {
    const addonFields = getProjectAddonCardFields(db, card.id, viewAddonRefs);
    return addonFields.length > 0 ? { ...card, addonFields } : card;
  };

  // Read-only page path (AR-032/AR-052): never seeds a workflow here.
  const statuses = listWorkflow(db, projectId);
  const parentStatuses = row.parent_id ? listWorkflow(db, row.parent_id) : [];

  const childRows = db
    .prepare(`SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE p.parent_id = ? ORDER BY p.priority ASC, p.seq ASC`)
    .all(projectId) as ProjectRow[];
  const children = childRows
    .filter((childRow) => isActiveProject(ctx, childRow.id))
    .map(mapProjectCard)
    .map(withAddonFields);

  const descendants: ProjectWithParent[] = [];
  const collectDescendants = (parentId: string) => {
    const rows = db
      .prepare(`SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE p.parent_id = ? ORDER BY p.priority ASC, p.seq ASC`)
      .all(parentId) as ProjectRow[];
    for (const childRow of rows) {
      if (!isActiveProject(ctx, childRow.id)) continue;
      descendants.push({
        ...withAddonFields(mapProjectCard(childRow)),
        parentId: childRow.parent_id,
        canAdmin: canAdminProject(ctx, childRow.id),
      });
      collectDescendants(childRow.id);
    }
  };
  collectDescendants(projectId);

  const activity = listActivity(db, projectId, {
    limit: ACTIVITY_INITIAL_LIMIT,
    canReadTarget: (targetId) => canReadProject(ctx, targetId),
    targetExists: (targetId) => ctx.projectById.has(targetId),
  }) as ActivityPageData;

  const role = getRole(ctx, projectId);
  const canEdit = canEditProject(ctx, projectId);
  const canAdmin = canAdminProject(ctx, projectId);

  return {
    project: {
      id: row.id,
      seq: row.seq,
      displayId: displayId(row.seq),
      title: row.title,
      statusId: row.status_id,
      statusName: row.status_name,
      priority: row.priority,
      inbox: row.inbox === 1,
      archived: row.archived === 1,
      trashed,
      trashedAt: row.trashed_at,
      purgeDeadline: row.purge_deadline,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reporter: rowReporter(row),
      createdBy: rowCreator(row),
      parent: parentLink,
      isRoot,
      favorite: favoriteRow !== undefined,
      effectiveRole: role as ProjectPageData['project']['effectiveRole'],
      canEdit,
      canAdmin,
      canCreateChild: canEdit,
      canMove: canAdmin && !isRoot && !trashed,
      hiddenWhenArchivedOff,
      fallbackHref,
    },
    rootId: ctx.rootId,
    breadcrumb: ancestors.map((ancestor) => ({
      id: ancestor.id,
      title: ancestor.title,
    })),
    statuses,
    parentStatuses,
    children,
    descendants,
    activity,
    settings,
    layout,
    addons,
    showArchived: ctx.user.showArchived,
  };
}

/* ------------------------------------------------------------------------- */
/* Create                                                                    */
/* ------------------------------------------------------------------------- */

export interface CreateProjectInput {
  parentId: string;
  title: string;
}

export function createProject(
  db: BetterSqliteDatabase,
  user: AccessUser,
  input: CreateProjectInput,
): ProjectCard {
  const titleError = validateProjectTitle(input.title);
  if (titleError) {
    throw new DomainError(422, 'validation_failed', 'Check the highlighted fields.', {
      title: titleError,
    });
  }
  const title = cleanTitle(input.title);
  const ctx = loadAccessContext(db, user);
  const parent = getProjectRow(db, input.parentId);
  if (!parent || !canReadProject(ctx, input.parentId)) {
    throw new DomainError(404, 'not_found', 'Parent project not found.');
  }
  if (isTrashedProject(ctx, input.parentId)) {
    throw new DomainError(409, 'trashed_read_only', 'Restore the parent project before adding children.');
  }
  if (!canEditProject(ctx, input.parentId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to the parent project.');
  }

  const parentSettings = parseProjectSettings(parent.settings);
  const createdAt = nowIso();

  const transaction = db.transaction((): ProjectCard => {
    const workflow = ensureWorkflow(db, input.parentId);
    const start = workflow.find((status) => status.isStart) ?? workflow[0];
    if (!start) throw new DomainError(500, 'workflow_invalid', 'The parent workflow has no statuses.');
    const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM projects').get() as {
      seq: number;
    };
    const maxPriority = db
      .prepare('SELECT COALESCE(MAX(priority), -1) AS priority FROM projects')
      .get() as { priority: number };
    const projectId = newId();
    db.prepare(
      `INSERT INTO projects (
         id, seq, title, reporter_id, parent_id, status_id, priority, inbox, archived,
         trashed_at, trash_action_id, purge_deadline, addon_data, settings,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
    ).run(
      projectId,
      maxSeq.seq + 1,
      title,
      user.id,
      input.parentId,
      start.id,
      maxPriority.priority + 1,
      parentSettings.skip_inbox ? 0 : 1,
      JSON.stringify(DEFAULT_PROJECT_SETTINGS),
      user.id,
      createdAt,
      createdAt,
    );

    // Every project owns its children's workflow from creation so read paths
    // never need to seed one (AR-032).
    insertWorkflow(db, projectId, DEFAULT_CHILD_WORKFLOW);

    // New projects initially inherit the parent's explicit grants; the creator
    // is additionally made Admin (product.md §6).
    db.prepare(
      `INSERT OR IGNORE INTO project_roles (project_id, user_id, role)
       SELECT ?, user_id, role FROM project_roles WHERE project_id = ?`,
    ).run(projectId, input.parentId);
    db.prepare(
      `INSERT INTO project_roles (project_id, user_id, role) VALUES (?, ?, 'admin')
       ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'admin'`,
    ).run(projectId, user.id);

    reindexProjectAddonSearch(db, projectId);
    recordAuditEvent(db, {
      projectId,
      actorId: user.id,
      action: AUDIT_ACTIONS.projectCreated,
      detail: `Project created under ${parent.title}`,
      createdAt,
    });
    recordAuditEvent(db, {
      projectId: input.parentId,
      actorId: user.id,
      action: AUDIT_ACTIONS.childCreated,
      targetId: projectId,
      newValue: title,
      detail: 'Child project created',
      createdAt,
    });
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(createdAt, input.parentId);

    const created = getProjectRow(db, projectId);
    if (!created) throw new DomainError(500, 'internal', 'Could not create the project.');
    return mapProjectCard(created);
  });

  return transaction();
}

/* ------------------------------------------------------------------------- */
/* Update                                                                    */
/* ------------------------------------------------------------------------- */

export interface UpdateProjectInput {
  title?: unknown;
  statusId?: unknown;
  archived?: unknown;
}

export interface UpdateProjectResult {
  project: ProjectCard;
}

export function updateProject(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  input: UpdateProjectInput,
): UpdateProjectResult {
  const ctx = loadAccessContext(db, user);
  const row = getProjectRow(db, projectId);
  if (!row || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'This project is in Trash and is read-only.');
  }
  const canEdit = canEditProject(ctx, projectId);
  const canAdmin = canAdminProject(ctx, projectId);
  const isRoot = isRootProject(ctx, projectId);

  const fields: Record<string, string> = {};
  let nextTitle = row.title;
  let nextStatusId = row.status_id;
  let statusChanged = false;
  let nextArchived = row.archived === 1;
  let archivedChanged = false;
  let titleChanged = false;

  if (input.title !== undefined) {
    if (!canEdit) throw new DomainError(403, 'forbidden', 'You need edit access to rename this project.');
    if (typeof input.title !== 'string') fields.title = 'Enter a project title.';
    else {
      const error = validateProjectTitle(input.title);
      if (error) fields.title = error;
      else {
        const cleaned = cleanTitle(input.title);
        if (cleaned !== row.title) {
          nextTitle = cleaned;
          titleChanged = true;
        }
      }
    }
  }

  if (input.statusId !== undefined) {
    if (isRoot) {
      throw new DomainError(422, 'validation_failed', 'Root has no status.');
    }
    if (!canEdit) throw new DomainError(403, 'forbidden', 'You need edit access to change status.');
    if (typeof input.statusId !== 'string' || !input.statusId) {
      fields.status = 'Choose a status.';
    } else {
      const parentWorkflow = row.parent_id ? listWorkflow(db, row.parent_id) : [];
      const target = parentWorkflow.find((status) => status.id === input.statusId);
      if (!target) fields.status = 'Choose a status from the parent workflow.';
      else if (target.id !== row.status_id) {
        nextStatusId = target.id;
        statusChanged = true;
      }
    }
  }

  if (input.archived !== undefined) {
    if (!canAdmin) throw new DomainError(403, 'forbidden', 'You must be a project Admin to archive.');
    if (isRoot) throw new DomainError(422, 'validation_failed', 'Root cannot be archived.');
    if (typeof input.archived !== 'boolean') fields.archived = 'Choose archive state.';
    else if (input.archived !== (row.archived === 1)) {
      nextArchived = input.archived;
      archivedChanged = true;
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new DomainError(422, 'validation_failed', 'Check the highlighted fields.', fields);
  }

  if (!titleChanged && !statusChanged && !archivedChanged) {
    return { project: mapProjectCard(row) };
  }

  if (statusChanged && row.inbox === 1) {
    // Any status change exits the Inbox (rule 6); add-ons may validate first.
    assertInboxExitAllowed(db, projectId);
  }
  const timestamp = nowIso();
  const statusNameBefore =
    row.status_name ??
    (row.status_id
      ? (db.prepare('SELECT name FROM statuses WHERE id = ?').get(row.status_id) as { name: string } | undefined)?.name ?? null
      : null);
  const statusNameAfter = nextStatusId
    ? (db.prepare('SELECT name FROM statuses WHERE id = ?').get(nextStatusId) as { name: string } | undefined)?.name ?? null
    : null;

  const transaction = db.transaction(() => {
    db.prepare(
      'UPDATE projects SET title = ?, status_id = ?, archived = ?, inbox = ?, updated_at = ? WHERE id = ?',
    ).run(
      nextTitle,
      nextStatusId,
      nextArchived ? 1 : 0,
      statusChanged ? 0 : row.inbox,
      timestamp,
      projectId,
    );

    if (titleChanged) {
      recordAuditEvent(db, {
        projectId,
        actorId: user.id,
        action: AUDIT_ACTIONS.projectRenamed,
        field: AUDIT_FIELDS.title,
        oldValue: row.title,
        newValue: nextTitle,
        createdAt: timestamp,
      });
      reindexProjectAddonSearch(db, projectId);
    }
    if (statusChanged) {
      recordAuditEvent(db, {
        projectId,
        actorId: user.id,
        action: AUDIT_ACTIONS.projectStatusChanged,
        field: AUDIT_FIELDS.status,
        oldValue: statusNameBefore,
        newValue: statusNameAfter,
        // Status ids are snapshotted for forward-compatible reporting (AR-033).
        detail: JSON.stringify({ fromId: row.status_id, toId: nextStatusId }),
        createdAt: timestamp,
      });
      reindexProjectAddonSearch(db, projectId);
    }
    if (archivedChanged) {
      recordAuditEvent(db, {
        projectId,
        actorId: user.id,
        action: nextArchived ? AUDIT_ACTIONS.projectArchived : AUDIT_ACTIONS.projectUnarchived,
        field: AUDIT_FIELDS.archived,
        oldValue: nextArchived ? 'Active' : 'Archived',
        newValue: nextArchived ? 'Archived' : 'Active',
        createdAt: timestamp,
      });
    }
  });
  transaction();

  const updated = getProjectRow(db, projectId);
  if (!updated) throw new DomainError(500, 'internal', 'Could not update the project.');
  return { project: mapProjectCard(updated) };
}

/* ------------------------------------------------------------------------- */
/* Favorites                                                                 */
/* ------------------------------------------------------------------------- */

export function setProjectFavorite(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  favorite: boolean | null,
): { favorite: boolean } {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  const existing = db
    .prepare('SELECT 1 AS favorite FROM favorites WHERE user_id = ? AND project_id = ?')
    .get(user.id, projectId) as { favorite: number } | undefined;
  const currentlyFavorite = existing !== undefined;
  const next = favorite === null ? !currentlyFavorite : favorite;
  if (next === currentlyFavorite) return { favorite: currentlyFavorite };
  if (next) {
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, project_id) VALUES (?, ?)').run(
      user.id,
      projectId,
    );
  } else {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND project_id = ?').run(user.id, projectId);
  }
  return { favorite: next };
}

/* ------------------------------------------------------------------------- */
/* Reorder (global project priority)                                         */
/* ------------------------------------------------------------------------- */

export interface ReorderInput {
  statusId?: unknown;
  beforeId?: unknown;
}

export function reorderProject(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  input: ReorderInput,
): ProjectCard {
  const ctx = loadAccessContext(db, user);
  const row = getProjectRow(db, projectId);
  if (!row || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'This project is in Trash and is read-only.');
  }
  if (!canEditProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to reorder projects.');
  }
  if (row.parent_id === null) {
    throw new DomainError(422, 'validation_failed', 'Root cannot be reordered.');
  }

  let nextStatusId = row.status_id;
  let statusChanged = false;
  if (input.statusId !== undefined) {
    if (typeof input.statusId !== 'string' || !input.statusId) {
      throw new DomainError(422, 'validation_failed', 'Choose a status.');
    }
    const workflow = listWorkflow(db, row.parent_id);
    const target = workflow.find((status) => status.id === input.statusId);
    if (!target) {
      throw new DomainError(422, 'validation_failed', 'Choose a status from the parent workflow.');
    }
    if (target.id !== row.status_id) {
      nextStatusId = target.id;
      statusChanged = true;
    }
  }

  const beforeId = input.beforeId === undefined ? null : input.beforeId;
  let beforeRow: { id: string } | null = null;
  if (beforeId !== null) {
    if (typeof beforeId !== 'string' || !beforeId) {
      throw new DomainError(422, 'validation_failed', 'Choose a valid position.');
    }
    if (beforeId === projectId) return mapProjectCard(row);
    // Issue #53: beforeId may be any readable project in the tree, not only a
    // sibling. Unreadable or trashed targets are not valid drop positions.
    const candidate = db
      .prepare('SELECT id FROM projects WHERE id = ?')
      .get(beforeId) as { id: string } | undefined;
    if (!candidate || !canReadProject(ctx, beforeId)) {
      throw new DomainError(422, 'validation_failed', 'Choose a valid position.');
    }
    if (isTrashedProject(ctx, beforeId)) {
      throw new DomainError(422, 'validation_failed', 'That project is in Trash.');
    }
    beforeRow = candidate;
  }

  if (statusChanged && row.inbox === 1) {
    // Any status change exits the Inbox (rule 6); add-ons may validate first.
    // Exactly one gate per command (AR-053).
    assertInboxExitAllowed(db, projectId);
  }
  const timestamp = nowIso();
  const statusNameBefore =
    row.status_name ??
    (row.status_id
      ? (db.prepare('SELECT name FROM statuses WHERE id = ?').get(row.status_id) as { name: string } | undefined)?.name ?? null
      : null);
  const statusNameAfter = nextStatusId
    ? (db.prepare('SELECT name FROM statuses WHERE id = ?').get(nextStatusId) as { name: string } | undefined)?.name ?? null
    : null;

  const transaction = db.transaction(() => {
    const globalOrder = db
      .prepare('SELECT id FROM projects ORDER BY priority ASC, seq ASC')
      .all() as Array<{ id: string }>;
    const ordered = globalOrder.map((project) => project.id).filter((id) => id !== projectId);
    let insertIndex = ordered.length;
    if (beforeRow) {
      const index = ordered.indexOf(beforeRow.id);
      if (index >= 0) insertIndex = index;
    }
    ordered.splice(insertIndex, 0, projectId);

    // Two-phase rewrite of the whole global sequence: offset every row, then
    // assign 0..N-1 with the dragged project in its new slot. Every other
    // project keeps its relative order.
    db.prepare('UPDATE projects SET priority = priority + 1000000').run();
    const assign = db.prepare('UPDATE projects SET priority = ? WHERE id = ?');
    ordered.forEach((id, index) => {
      assign.run(index, id);
    });
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, projectId);

    if (statusChanged) {
      db.prepare('UPDATE projects SET status_id = ?, inbox = 0 WHERE id = ?').run(nextStatusId, projectId);
    }

    const priorIndex = globalOrder.findIndex((project) => project.id === projectId);
    recordAuditEvent(db, {
      projectId,
      actorId: user.id,
      action: AUDIT_ACTIONS.projectPriorityChanged,
      field: AUDIT_FIELDS.priority,
      oldValue: priorIndex >= 0 ? String(priorIndex + 1) : null,
      newValue: String(insertIndex + 1),
      createdAt: timestamp,
    });
    if (statusChanged) {
      recordAuditEvent(db, {
        projectId,
        actorId: user.id,
        action: AUDIT_ACTIONS.projectStatusChanged,
        field: AUDIT_FIELDS.status,
        oldValue: statusNameBefore,
        newValue: statusNameAfter,
        detail: JSON.stringify({ fromId: row.status_id, toId: nextStatusId }),
        createdAt: timestamp,
      });
    }
    reindexProjectAddonSearch(db, projectId);
  });
  transaction();

  const updated = getProjectRow(db, projectId);
  if (!updated) throw new DomainError(500, 'internal', 'Could not reorder the project.');
  return mapProjectCard(updated);
}

/* ------------------------------------------------------------------------- */
/* Move (reparent + explicit status mapping)                                 */
/* ------------------------------------------------------------------------- */

export interface MoveInput {
  destinationId?: unknown;
  mapping?: unknown;
}

function parseStatusMapping(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const mapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 0) mapping[key] = value;
  }
  return mapping;
}

export function getMoveInfo(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): MoveInfo {
  const ctx = loadAccessContext(db, user);
  const row = getProjectRow(db, projectId);
  if (!row || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'Restore this project before moving it.');
  }
  // AR-045 decision: move requires project Admin; an application Admin does
  // not bypass another project's access controls.
  if (!canAdminProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You must be a project Admin to move this project.');
  }
  if (row.parent_id === null) {
    throw new DomainError(422, 'validation_failed', 'Root cannot be moved.');
  }

  const descendants = new Set<string>([projectId]);
  const collect = (parentId: string) => {
    const children = db.prepare('SELECT id FROM projects WHERE parent_id = ?').all(parentId) as Array<{
      id: string;
    }>;
    for (const child of children) {
      descendants.add(child.id);
      collect(child.id);
    }
  };
  collect(projectId);

  const destinations: MoveDestination[] = [];
  for (const project of ctx.projectById.values()) {
    if (descendants.has(project.id)) continue;
    if (!isActiveProject(ctx, project.id)) continue;
    if (!canEditProject(ctx, project.id)) continue;
    const destinationRow = getProjectRow(db, project.id);
    if (!destinationRow) continue;
    // Read-only (AR-032): destinations without a workflow cannot receive a
    // mapped status, and the current parent is not a destination (AR-039).
    const statuses = listWorkflow(db, project.id);
    if (statuses.length === 0) continue;
    if (project.id === row.parent_id) continue;
    const path = [...accessibleAncestors(ctx, project.id).map((ancestor) => ancestor.title), destinationRow.title].join(' / ');
    destinations.push({
      id: destinationRow.id,
      title: destinationRow.title,
      path,
      isRoot: destinationRow.parent_id === null,
      statuses,
    });
  }
  destinations.sort((a, b) => a.path.localeCompare(b.path));

  return {
    project: {
      id: row.id,
      title: row.title,
      currentStatusId: row.status_id,
      currentStatusName: row.status_name,
      currentParentId: row.parent_id,
      currentParentTitle: row.parent_title,
    },
    destinations,
  };
}

/**
 * Validates the simulated (post-move) subtree still has at least one Admin.
 * Shared by every reparent operation (Move and Inbox Change parent).
 */
export function assertMoveKeepsAdmin(
  db: BetterSqliteDatabase,
  projectId: string,
  destinationId: string,
): void {
  const tree = loadProjectTree(db);
  const moved = tree.get(projectId);
  if (!moved) return;
  const simulated = new Map(tree);
  simulated.set(projectId, { ...moved, parentId: destinationId });
  const grants = cloneGrantMap(loadGrantMap(db));
  const users = loadAccessUsers(db);
  const effective = effectiveRolesByUser(simulated, grants, users);
  const subtree = [projectId, ...descendantIdsOf(simulated, projectId)];
  const losing = subtree.filter((id) =>
    users.every((user) => effective.get(user.id)?.get(id) !== 'admin'),
  );
  if (losing.length > 0) {
    const names = losing.map((id) => simulated.get(id)?.title ?? id);
    throw new DomainError(
      409,
      'last_admin',
      `Moving this project would leave these projects without an Admin: ${names.join(', ')}.`,
    );
  }
}

export function moveProject(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  input: MoveInput,
): ProjectCard {
  const ctx = loadAccessContext(db, user);
  const row = getProjectRow(db, projectId);
  if (!row || !canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'Restore this project before moving it.');
  }
  if (row.parent_id === null) {
    throw new DomainError(422, 'validation_failed', 'Root cannot be moved.');
  }
  if (!canAdminProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You must be a project Admin to move this project.');
  }

  const destinationId = typeof input.destinationId === 'string' ? input.destinationId : '';
  if (!destinationId) {
    throw new DomainError(422, 'validation_failed', 'Choose a destination project.', {
      destinationId: 'Choose a destination project.',
    });
  }
  const destination = getProjectRow(db, destinationId);
  if (!destination || !canReadProject(ctx, destinationId)) {
    throw new DomainError(404, 'not_found', 'Destination project not found.');
  }
  if (isTrashedProject(ctx, destinationId)) {
    throw new DomainError(409, 'trashed_read_only', 'The destination project is in Trash.');
  }
  if (!canEditProject(ctx, destinationId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to the destination project.');
  }
  if (destinationId === projectId) {
    throw new DomainError(422, 'validation_failed', 'A project cannot be moved inside itself.', {
      destinationId: 'Choose a different destination.',
    });
  }

  // Cycle rejection: the destination must not be the moved project or a descendant.
  let cursor: string | null = destinationId;
  let guard = 0;
  while (cursor && guard < 500) {
    if (cursor === projectId) {
      throw new DomainError(422, 'validation_failed', 'A project cannot be moved inside its own subtree.', {
        destinationId: 'Choose a destination outside this project.',
      });
    }
    const current: { parent_id: string | null } | undefined = db
      .prepare('SELECT parent_id FROM projects WHERE id = ?')
      .get(cursor) as { parent_id: string | null } | undefined;
    cursor = current?.parent_id ?? null;
    guard += 1;
  }

  if (destinationId === row.parent_id) {
    throw new DomainError(422, 'validation_failed', 'This project is already under that parent.', {
      destinationId: 'Choose a different parent.',
    });
  }

  const destinationWorkflow = ensureWorkflow(db, destinationId);
  const mapping = parseStatusMapping(input.mapping);
  const oldStatusId = row.status_id;
  if (!oldStatusId) {
    throw new DomainError(422, 'validation_failed', 'This project has no status to map.');
  }
  const mappedStatusId = mapping[oldStatusId];
  const mappedStatus = destinationWorkflow.find((status) => status.id === mappedStatusId);
  if (!mappedStatus) {
    throw new DomainError(
      422,
      'mapping_required',
      'Map the current status to a status in the destination workflow. Status names are not matched automatically.',
      { mapping: 'Choose a destination status for this project.' },
    );
  }

  if (row.inbox === 1) {
    assertInboxExitAllowed(db, projectId);
  }

  // The moved project and its descendants must still have an effective Admin
  // after the reparent (AR-035).
  assertMoveKeepsAdmin(db, projectId, destinationId);

  const timestamp = nowIso();
  const oldStatusName =
    row.status_name ??
    (db.prepare('SELECT name FROM statuses WHERE id = ?').get(oldStatusId) as { name: string } | undefined)?.name ??
    null;
  const oldParentTitle = row.parent_title ?? 'previous parent';

  const transaction = db.transaction(() => {
    // Issue #53: reparenting keeps the project's global priority position; the
    // sibling order in the destination is the global sequence restricted to
    // its children.
    db.prepare(
      'UPDATE projects SET parent_id = ?, status_id = ?, inbox = 0, updated_at = ? WHERE id = ?',
    ).run(destinationId, mappedStatus.id, timestamp, projectId);

    recordAuditEvent(db, {
      projectId,
      actorId: user.id,
      action: AUDIT_ACTIONS.projectMoved,
      field: AUDIT_FIELDS.parent,
      oldValue: oldParentTitle,
      newValue: destination.title,
      createdAt: timestamp,
    });
    recordAuditEvent(db, {
      projectId,
      actorId: user.id,
      action: AUDIT_ACTIONS.projectStatusChanged,
      field: AUDIT_FIELDS.status,
      oldValue: oldStatusName,
      newValue: mappedStatus.name,
      detail: JSON.stringify({ fromId: oldStatusId, toId: mappedStatus.id }),
      createdAt: timestamp,
    });
    reindexProjectAddonSearchSubtree(db, projectId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, destinationId);
  });
  transaction();

  const updated = getProjectRow(db, projectId);
  if (!updated) throw new DomainError(500, 'internal', 'Could not move the project.');
  return mapProjectCard(updated);
}

/* ------------------------------------------------------------------------- */
/* Bulk move (Tree multiselect)                                              */
/* ------------------------------------------------------------------------- */

export interface BulkMoveInput {
  destinationId?: unknown;
  mapping?: unknown;
}

export interface BulkMoveResult {
  moved: ProjectCard[];
  destination: ProjectLink;
}

/**
 * Moves several projects to one destination atomically (product.md §4/§5 Tree
 * multiselect). Every distinct old status in use must be mapped explicitly, all
 * projects with the same old status receive the chosen status, and the whole
 * operation is validated before any write so it cannot partially succeed.
 */
export function moveProjects(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectIds: readonly string[],
  input: BulkMoveInput,
): BulkMoveResult {
  const ids = [...new Set(projectIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) {
    throw new DomainError(422, 'validation_failed', 'Choose at least one project to move.');
  }
  const ctx = loadAccessContext(db, user);
  const destinationId = typeof input.destinationId === 'string' ? input.destinationId : '';
  if (!destinationId) {
    throw new DomainError(422, 'validation_failed', 'Choose a destination project.', {
      destinationId: 'Choose a destination project.',
    });
  }
  if (ids.includes(destinationId)) {
    throw new DomainError(422, 'validation_failed', 'The destination cannot be part of the selection.');
  }
  const destination = getProjectRow(db, destinationId);
  if (!destination || !canReadProject(ctx, destinationId)) {
    throw new DomainError(404, 'not_found', 'Destination project not found.');
  }
  if (isTrashedProject(ctx, destinationId)) {
    throw new DomainError(409, 'trashed_read_only', 'The destination project is in Trash.');
  }
  if (!canEditProject(ctx, destinationId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to the destination project.');
  }

  const rows: ProjectRow[] = [];
  const notAdmin: string[] = [];
  for (const projectId of ids) {
    const row = getProjectRow(db, projectId);
    if (!row || !canReadProject(ctx, projectId)) {
      throw new DomainError(404, 'not_found', 'One of the selected projects no longer exists.');
    }
    if (isTrashedProject(ctx, projectId)) {
      throw new DomainError(409, 'trashed_read_only', 'One of the selected projects is in Trash.');
    }
    if (row.parent_id === null) {
      throw new DomainError(422, 'validation_failed', 'Root cannot be moved.');
    }
    // AR-045 decision: bulk move requires project Admin on every affected project.
    if (!canAdminProject(ctx, projectId)) notAdmin.push(row.title);
    // Cycle rejection: the destination must not be inside any moved project.
    let cursor: string | null = destinationId;
    let guard = 0;
    while (cursor && guard < 500) {
      if (cursor === projectId) {
        throw new DomainError(
          422,
          'validation_failed',
          `A project cannot be moved inside its own subtree (${row.title}).`,
        );
      }
      const current: { parent_id: string | null } | undefined = db
        .prepare('SELECT parent_id FROM projects WHERE id = ?')
        .get(cursor) as { parent_id: string | null } | undefined;
      cursor = current?.parent_id ?? null;
      guard += 1;
    }
    rows.push(row);
  }
  if (notAdmin.length > 0) {
    throw new DomainError(
      403,
      'forbidden',
      `You must be a project Admin for: ${notAdmin.join(', ')}.`,
    );
  }

  const destinationWorkflow = ensureWorkflow(db, destinationId);
  const mapping = parseStatusMapping(input.mapping);
  const missing: string[] = [];
  const resolved = new Map<string, Status>();
  for (const row of rows) {
    const statusId = row.status_id;
    if (!statusId) {
      throw new DomainError(422, 'validation_failed', `“${row.title}” has no status to map.`);
    }
    if (resolved.has(statusId)) continue;
    const target = destinationWorkflow.find((status) => status.id === mapping[statusId]);
    if (!target) {
      missing.push(row.status_name ?? 'Unknown status');
      continue;
    }
    resolved.set(statusId, target);
  }
  if (missing.length > 0) {
    throw new DomainError(
      422,
      'mapping_required',
      `Map every old status before moving. Missing: ${[...new Set(missing)].join(', ')}.`,
      { mapping: 'Choose a destination status for every old status in use.' },
    );
  }

  for (const row of rows) {
    if (row.inbox === 1) assertInboxExitAllowed(db, row.id);
    assertMoveKeepsAdmin(db, row.id, destinationId);
  }

  const timestamp = nowIso();
  const transaction = db.transaction(() => {
    // Issue #53: every moved project keeps its existing global priority; only
    // the parent (and mapped status) changes.
    const update = db.prepare(
      `UPDATE projects
          SET parent_id = ?, status_id = ?, inbox = 0, updated_at = ?
        WHERE id = ?`,
    );
    for (const row of rows) {
      const target = resolved.get(row.status_id as string);
      if (!target) continue;
      if (row.parent_id === destinationId) {
        // Already a direct child: keep its global priority, apply the status map.
        db.prepare('UPDATE projects SET status_id = ?, inbox = 0, updated_at = ? WHERE id = ?').run(
          target.id,
          timestamp,
          row.id,
        );
      } else {
        update.run(destinationId, target.id, timestamp, row.id);
        recordAuditEvent(db, {
          projectId: row.id,
          actorId: user.id,
          action: AUDIT_ACTIONS.projectMoved,
          field: AUDIT_FIELDS.parent,
          oldValue: row.parent_title ?? 'previous parent',
          newValue: destination.title,
          createdAt: timestamp,
        });
      }
      recordAuditEvent(db, {
        projectId: row.id,
        actorId: user.id,
        action: AUDIT_ACTIONS.projectStatusChanged,
        field: AUDIT_FIELDS.status,
        oldValue: row.status_name,
        newValue: target.name,
        detail: JSON.stringify({ fromId: row.status_id, toId: target.id }),
        createdAt: timestamp,
      });
      reindexProjectAddonSearchSubtree(db, row.id);
    }
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, destinationId);
  });
  transaction();

  const moved: ProjectCard[] = [];
  for (const row of rows) {
    const updated = getProjectRow(db, row.id);
    if (updated) moved.push(mapProjectCard(updated));
  }
  return {
    moved,
    destination: { id: destination.id, title: destination.title },
  };
}

/* ------------------------------------------------------------------------- */
/* Small read helpers used by other domains / pages                          */
/* ------------------------------------------------------------------------- */

export function getInboxStartStatus(
  db: BetterSqliteDatabase,
  parentId: string,
): Status | null {
  const workflow = listWorkflow(db, parentId);
  return workflow.find((status) => status.isStart) ?? null;
}

export function isProjectRoot(db: BetterSqliteDatabase, projectId: string): boolean {
  const row = db.prepare('SELECT parent_id FROM projects WHERE id = ?').get(projectId) as
    | { parent_id: string | null }
    | undefined;
  return row?.parent_id === null;
}

export function canCreateChildIn(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): boolean {
  const ctx = loadAccessContext(db, user);
  return canEditProject(ctx, projectId) && !isTrashedProject(ctx, projectId);
}

export function isEditableRole(role: string | null): boolean {
  return role === 'admin' || role === 'user';
}

export function effectiveRankForProject(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): number {
  const ctx = loadAccessContext(db, user);
  const role = getRole(ctx, projectId);
  void db;
  return roleRank(role);
}

export function isViewerReadOnly(user: AccessUser): boolean {
  return isReadOnlyViewer(user) || user.appRole === 'viewer';
}

export type { ProjectSettingsDefaults, ProjectCard, ProjectLink, ProjectPageData, ProjectWithParent };
export { readableChildIds };
