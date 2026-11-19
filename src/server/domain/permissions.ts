import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { AppRole, ProjectRole } from '@/lib/types';
import type { ProjectAccessMode } from '@/lib/projects';
import { parseJsonObject } from '@/server/db/util';

/**
 * Project permission engine (build-spec §6 rules 2–3, product.md §6).
 *
 * Rules implemented here (build-spec §6 rule 2, access modes):
 *  - every project has `settings.access` = `inherit` (default) or `custom`.
 *  - inherit: effective role = explicit row if present, else the parent's
 *    effective role (recursively).
 *  - custom: explicit rows only, no walk-up. A custom project with only the
 *    chosen users is private even from application Admins.
 *  - Root is custom with explicit grants plus the implicit Admin for app Admins.
 *  - application Viewers are read-only everywhere, even when a project grant
 *    would allow editing.
 *  - reducing/removing a grant cascades down over existing descendant grants;
 *    increases never propagate. The cascade happens after an acknowledgement
 *    and every affected subtree is validated first: a project must keep one
 *    effective Admin and Root must keep one effective application Admin.
 *
 * This module is framework-free: no React / Next imports and no HTTP types.
 */

export type EffectiveRole = ProjectRole | null;

/** Domain error carrying the HTTP status/code the route layer should return. */
export class DomainError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, user: 2, admin: 3 };

export function roleRank(role: ProjectRole | null | undefined): number {
  return role ? ROLE_RANK[role] : 0;
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return value === 'admin' || value === 'user' || value === 'viewer';
}

/** Minimum roles for the three capabilities the UI exposes. */
export const ROLES_READ: readonly ProjectRole[] = ['admin', 'user', 'viewer'];
export const ROLES_WRITE: readonly ProjectRole[] = ['admin', 'user'];

export interface AccessUser {
  id: string;
  appRole: AppRole;
  showArchived: boolean;
}

export interface PermissionProject {
  id: string;
  parentId: string | null;
  title: string;
  seq: number;
  archived: boolean;
  trashed: boolean;
  access: ProjectAccessMode;
}

export interface AccessContext {
  user: AccessUser;
  projectById: Map<string, PermissionProject>;
  childrenByParent: Map<string, string[]>;
  /** Effective role per project (null = no access). */
  roleById: Map<string, EffectiveRole>;
  /** True when the project or one of its ancestors is archived. */
  archivedHiddenById: Map<string, boolean>;
  rootId: string | null;
}

interface ProjectNodeRow {
  id: string;
  parent_id: string | null;
  title: string;
  seq: number;
  archived: number;
  trashed_at: string | null;
  settings: string;
}

/** Reads `settings.access`; Root is always custom (build-spec §6 rule 2). */
export function parseProjectAccess(
  settingsRaw: string | null | undefined,
  isRoot = false,
): ProjectAccessMode {
  if (isRoot) return 'custom';
  const parsed = parseJsonObject(settingsRaw);
  return parsed.access === 'custom' ? 'custom' : 'inherit';
}

function loadProjectNodes(db: BetterSqliteDatabase): PermissionProject[] {
  const rows = db
    .prepare(
      `SELECT id, parent_id, title, seq, archived, trashed_at, settings
         FROM projects
        ORDER BY seq ASC`,
    )
    .all() as ProjectNodeRow[];
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    seq: row.seq,
    archived: row.archived === 1,
    trashed: row.trashed_at !== null,
    access: parseProjectAccess(row.settings, row.parent_id === null),
  }));
}

function loadUserGrants(
  db: BetterSqliteDatabase,
  userId: string,
): Map<string, ProjectRole> {
  const rows = db
    .prepare('SELECT project_id, role FROM project_roles WHERE user_id = ?')
    .all(userId) as Array<{ project_id: string; role: ProjectRole }>;
  return new Map(rows.map((row) => [row.project_id, row.role]));
}

export function isApplicationAdmin(user: Pick<AccessUser, 'appRole'>): boolean {
  return user.appRole === 'admin';
}

/** Application Viewers are read-only everywhere (product.md §6). */
export function isReadOnlyViewer(user: Pick<AccessUser, 'appRole'>): boolean {
  return user.appRole === 'viewer';
}

/**
 * Loads the whole project tree plus the viewer's effective role on every
 * project. Installs are household-sized; one pass over the tree per request is
 * cheaper and safer than trusting SQL filters in every call site.
 */
export function loadAccessContext(db: BetterSqliteDatabase, user: AccessUser): AccessContext {
  const projects = loadProjectNodes(db);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const grants = loadUserGrants(db, user.id);
  const childrenByParent = new Map<string, string[]>();
  const rootIds: string[] = [];
  for (const project of projects) {
    if (project.parentId === null) {
      rootIds.push(project.id);
      continue;
    }
    const siblings = childrenByParent.get(project.parentId);
    if (siblings) siblings.push(project.id);
    else childrenByParent.set(project.parentId, [project.id]);
  }

  const roleById = new Map<string, EffectiveRole>();
  const archivedHiddenById = new Map<string, boolean>();

  const walk = (projectId: string, inherited: ProjectRole | null, parentArchived: boolean) => {
    const project = projectById.get(projectId);
    if (!project) return;
    const explicit = grants.get(projectId) ?? null;
    let role: ProjectRole | null;
    let passDown: ProjectRole | null;
    if (explicit) {
      role = explicit;
      passDown = explicit;
    } else if (project.parentId === null) {
      // Root fallback: application Admins administer Root; nobody else gains
      // access implicitly (explicit grants only). Root is always custom.
      role = user.appRole === 'admin' ? 'admin' : null;
      passDown = null;
    } else if (project.access === 'custom') {
      // Private boundary: no walk-up, so ancestors (and the Root fallback)
      // cannot grant access here.
      role = null;
      passDown = null;
    } else {
      role = inherited;
      passDown = inherited;
    }
    roleById.set(projectId, role);
    const archivedHidden = parentArchived || project.archived;
    archivedHiddenById.set(projectId, archivedHidden);
    for (const childId of childrenByParent.get(projectId) ?? []) {
      walk(childId, passDown, archivedHidden);
    }
  };

  for (const rootId of rootIds) walk(rootId, null, false);

  return {
    user,
    projectById,
    childrenByParent,
    roleById,
    archivedHiddenById,
    rootId: rootIds[0] ?? null,
  };
}

export function getRole(ctx: AccessContext, projectId: string): EffectiveRole {
  return ctx.roleById.get(projectId) ?? null;
}

export function canReadProject(ctx: AccessContext, projectId: string): boolean {
  return getRole(ctx, projectId) !== null;
}

export function canEditProject(ctx: AccessContext, projectId: string): boolean {
  const role = getRole(ctx, projectId);
  if (!role || !ROLES_WRITE.includes(role)) return false;
  return !isReadOnlyViewer(ctx.user);
}

export function canAdminProject(ctx: AccessContext, projectId: string): boolean {
  const role = getRole(ctx, projectId);
  if (role !== 'admin') return false;
  return !isReadOnlyViewer(ctx.user);
}

export function isRootProject(ctx: AccessContext, projectId: string): boolean {
  return ctx.projectById.get(projectId)?.parentId === null;
}

export function isTrashedProject(ctx: AccessContext, projectId: string): boolean {
  return ctx.projectById.get(projectId)?.trashed ?? false;
}

/** Archived projects (or descendants of archived projects) follow show_archived. */
export function isArchivedHidden(ctx: AccessContext, projectId: string): boolean {
  return ctx.archivedHiddenById.get(projectId) ?? false;
}

/**
 * A project appears in the live UI (navigation, collections, Inbox, search,
 * dashboard) when the viewer can read it, it is not trashed and archived
 * visibility permits it.
 */
export function isActiveProject(ctx: AccessContext, projectId: string): boolean {
  if (!canReadProject(ctx, projectId)) return false;
  const project = ctx.projectById.get(projectId);
  if (!project || project.trashed) return false;
  if (!ctx.user.showArchived && isArchivedHidden(ctx, projectId)) return false;
  return true;
}

/** Visible in the Trash page: readable + trashed (archived visibility applies). */
export function isTrashVisibleProject(ctx: AccessContext, projectId: string): boolean {
  if (!canReadProject(ctx, projectId)) return false;
  const project = ctx.projectById.get(projectId);
  if (!project || !project.trashed) return false;
  if (!ctx.user.showArchived && isArchivedHidden(ctx, projectId)) return false;
  return true;
}

export function visibleProjectIds(ctx: AccessContext): Set<string> {
  const ids = new Set<string>();
  for (const projectId of ctx.projectById.keys()) {
    if (isActiveProject(ctx, projectId)) ids.add(projectId);
  }
  return ids;
}

export function visibleTrashIds(ctx: AccessContext): Set<string> {
  const ids = new Set<string>();
  for (const projectId of ctx.projectById.keys()) {
    if (isTrashVisibleProject(ctx, projectId)) ids.add(projectId);
  }
  return ids;
}

/** Accessible ancestors, root first (used by breadcrumbs and the tree view). */
export function accessibleAncestors(
  ctx: AccessContext,
  projectId: string,
): PermissionProject[] {
  const path: PermissionProject[] = [];
  let current = ctx.projectById.get(projectId);
  let guard = 0;
  while (current && current.parentId && guard < 200) {
    const parent = ctx.projectById.get(current.parentId);
    if (!parent) break;
    if (canReadProject(ctx, parent.id)) path.unshift(parent);
    current = parent;
    guard += 1;
  }
  return path;
}

/** Immediate children the viewer may read (trashed and archived are included — callers filter). */
export function readableChildIds(ctx: AccessContext, parentId: string): string[] {
  const children = ctx.childrenByParent.get(parentId) ?? [];
  return children.filter((childId) => canReadProject(ctx, childId));
}

/** All readable descendants, depth-first. */
export function readableDescendantIds(ctx: AccessContext, projectId: string): string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    for (const childId of ctx.childrenByParent.get(id) ?? []) {
      if (!canReadProject(ctx, childId)) continue;
      result.push(childId);
      visit(childId);
    }
  };
  visit(projectId);
  return result;
}

export function ancestorIds(ctx: AccessContext, projectId: string): string[] {
  const ids: string[] = [];
  let current = ctx.projectById.get(projectId);
  let guard = 0;
  while (current && current.parentId && guard < 200) {
    ids.push(current.parentId);
    current = ctx.projectById.get(current.parentId);
    guard += 1;
  }
  return ids;
}

/* ------------------------------------------------------------------------- */
/* Multi-user simulation for membership changes / last-admin validation      */
/* ------------------------------------------------------------------------- */

export interface ProjectTreeEntry {
  id: string;
  parentId: string | null;
  title: string;
  /** Optional in tests/fixtures; treated as `inherit` when absent. */
  access?: ProjectAccessMode;
}

export type ProjectTree = Map<string, ProjectTreeEntry>;

export type GrantMap = Map<string, Map<string, ProjectRole>>;

export interface AccessUserRow {
  id: string;
  appRole: AppRole;
}

export interface MemberChange {
  userId: string;
  role: ProjectRole | null;
}

export interface CascadeEntry {
  projectId: string;
  title: string;
  from: ProjectRole;
  to: ProjectRole | null;
}

export interface CascadePreview {
  userId: string;
  username: string;
  entries: CascadeEntry[];
}

export function loadProjectTree(db: BetterSqliteDatabase): ProjectTree {
  const rows = db
    .prepare('SELECT id, parent_id, title, settings FROM projects ORDER BY seq ASC')
    .all() as Array<{ id: string; parent_id: string | null; title: string; settings: string }>;
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        parentId: row.parent_id,
        title: row.title,
        access: parseProjectAccess(row.settings, row.parent_id === null),
      },
    ]),
  );
}

export function loadGrantMap(db: BetterSqliteDatabase): GrantMap {
  const rows = db
    .prepare('SELECT project_id, user_id, role FROM project_roles')
    .all() as Array<{ project_id: string; user_id: string; role: ProjectRole }>;
  const map: GrantMap = new Map();
  for (const row of rows) {
    const projectGrants = map.get(row.project_id) ?? new Map<string, ProjectRole>();
    projectGrants.set(row.user_id, row.role);
    map.set(row.project_id, projectGrants);
  }
  return map;
}

export function cloneGrantMap(grants: GrantMap): GrantMap {
  const clone: GrantMap = new Map();
  for (const [projectId, projectGrants] of grants) {
    clone.set(projectId, new Map(projectGrants));
  }
  return clone;
}

export function loadAccessUsers(db: BetterSqliteDatabase): AccessUserRow[] {
  const rows = db.prepare('SELECT id, app_role FROM users ORDER BY username ASC').all() as Array<{
    id: string;
    app_role: AppRole;
  }>;
  return rows.map((row) => ({ id: row.id, appRole: row.app_role }));
}

export function loadUsernames(db: BetterSqliteDatabase): Map<string, string> {
  const rows = db.prepare('SELECT id, username FROM users').all() as Array<{
    id: string;
    username: string;
  }>;
  return new Map(rows.map((row) => [row.id, row.username]));
}

export function treeChildren(tree: ProjectTree): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const entry of tree.values()) {
    if (entry.parentId === null) continue;
    const siblings = children.get(entry.parentId);
    if (siblings) siblings.push(entry.id);
    else children.set(entry.parentId, [entry.id]);
  }
  return children;
}

/**
 * Effective role for one user: explicit grant, else the parent's effective role
 * when the project is `inherit`; a `custom` project stops the walk-up and yields
 * no access (Root keeps the implicit application-Admin fallback).
 */
export function effectiveRoleFor(
  tree: ProjectTree,
  grants: GrantMap,
  user: { id: string; appRole: AppRole },
  projectId: string,
): EffectiveRole {
  const entry = tree.get(projectId);
  if (!entry) return null;
  const explicit = grants.get(projectId)?.get(user.id);
  if (explicit) return explicit;
  if (entry.parentId === null) return user.appRole === 'admin' ? 'admin' : null;
  if ((entry.access ?? 'inherit') === 'custom') return null;
  const parent = tree.get(entry.parentId);
  if (!parent) return null;
  // The implicit application-Admin Admin on Root is Root-only; it never
  // cascades into inherited descendants (build-spec §6 rule 2).
  if (parent.parentId === null && !grants.get(parent.id)?.get(user.id)) return null;
  return effectiveRoleFor(tree, grants, user, entry.parentId);
}

/**
 * The role a user would hold from ancestors when they have explicit `newExplicit`
 * on the project (or none). Used to plan reductions without writing.
 */
function roleWithExplicit(
  tree: ProjectTree,
  grants: GrantMap,
  user: { id: string; appRole: AppRole },
  projectId: string,
  newExplicit: ProjectRole | null,
): EffectiveRole {
  if (newExplicit !== null) return newExplicit;
  const entry = tree.get(projectId);
  if (!entry) return null;
  if (entry.parentId === null) return user.appRole === 'admin' ? 'admin' : null;
  if ((entry.access ?? 'inherit') === 'custom') return null;
  const parent = tree.get(entry.parentId);
  if (!parent) return null;
  // The implicit application-Admin Admin on Root is Root-only; it never
  // cascades into inherited descendants (build-spec §6 rule 2).
  if (parent.parentId === null && !grants.get(parent.id)?.get(user.id)) return null;
  return effectiveRoleFor(tree, grants, user, entry.parentId);
}

/** Effective roles for every user in the installation (simulation helper). */
export function effectiveRolesByUser(
  tree: ProjectTree,
  grants: GrantMap,
  users: readonly AccessUserRow[],
): Map<string, Map<string, EffectiveRole>> {
  const children = treeChildren(tree);
  const result = new Map<string, Map<string, EffectiveRole>>();
  const rootIds = [...tree.values()]
    .filter((entry) => entry.parentId === null)
    .map((entry) => entry.id);
  for (const user of users) {
    const roleByProject = new Map<string, EffectiveRole>();
    const walk = (projectId: string, inherited: ProjectRole | null) => {
      const entry = tree.get(projectId);
      if (!entry) return;
      const explicit = grants.get(projectId)?.get(user.id) ?? null;
      let role: ProjectRole | null;
      let passDown: ProjectRole | null;
      if (explicit) {
        role = explicit;
        passDown = explicit;
      } else if (entry.parentId === null) {
        role = user.appRole === 'admin' ? 'admin' : null;
        passDown = null;
      } else if ((entry.access ?? 'inherit') === 'custom') {
        role = null;
        passDown = null;
      } else {
        role = inherited;
        passDown = inherited;
      }
      roleByProject.set(projectId, role);
      for (const childId of children.get(projectId) ?? []) walk(childId, passDown);
    };
    for (const rootId of rootIds) walk(rootId, null);
    result.set(user.id, roleByProject);
  }
  return result;
}

export function descendantIdsOf(tree: ProjectTree, projectId: string): string[] {
  const children = treeChildren(tree);
  const ids: string[] = [];
  const visit = (id: string) => {
    for (const childId of children.get(id) ?? []) {
      ids.push(childId);
      visit(childId);
    }
  };
  visit(projectId);
  return ids;
}

export interface MemberUpdatePlan {
  nextGrants: GrantMap;
  cascades: CascadePreview[];
  /** Projects in the affected subtree that would end up with no effective Admin. */
  lastAdminViolations: ProjectTreeEntry[];
  /** Root would lose its last effective application Admin. */
  rootAdminViolation: boolean;
}

export interface MemberUpdateOptions {
  /** New access mode for the target project; omit to keep the current mode. */
  access?: ProjectAccessMode;
}

export function planMemberUpdate(
  tree: ProjectTree,
  grants: GrantMap,
  users: readonly AccessUserRow[],
  projectId: string,
  changes: readonly MemberChange[],
  usernames: Map<string, string>,
  options: MemberUpdateOptions = {},
): MemberUpdatePlan {
  const project = tree.get(projectId);
  if (!project) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  // Simulate the access-mode change as well, so switching a project to `custom`
  // cannot silently strip the last Admin (build-spec §6 rule 2/3).
  let workTree = tree;
  if (options.access && options.access !== project.access) {
    workTree = new Map(tree);
    workTree.set(projectId, { ...project, access: options.access });
  }
  const userById = new Map(users.map((user) => [user.id, user]));
  const nextGrants = cloneGrantMap(grants);
  const cascades: CascadePreview[] = [];
  const seen = new Set<string>();

  for (const change of changes) {
    const user = userById.get(change.userId);
    if (!user) {
      throw new DomainError(422, 'validation_failed', 'One of the selected accounts no longer exists.');
    }
    if (seen.has(change.userId)) {
      throw new DomainError(422, 'validation_failed', 'The same account can only appear once.');
    }
    seen.add(change.userId);
    if (change.role !== null && !isProjectRole(change.role)) {
      throw new DomainError(422, 'validation_failed', 'Unknown project role.');
    }

    const currentEffective = effectiveRoleFor(workTree, nextGrants, user, projectId);
    const newEffective = roleWithExplicit(workTree, nextGrants, user, projectId, change.role);

    const projectGrants = nextGrants.get(projectId) ?? new Map<string, ProjectRole>();
    if (change.role === null) projectGrants.delete(user.id);
    else projectGrants.set(user.id, change.role);
    if (projectGrants.size === 0) nextGrants.delete(projectId);
    else nextGrants.set(projectId, projectGrants);

    // Reductions cascade over descendant grants; increases never propagate.
    if (roleRank(newEffective) < roleRank(currentEffective)) {
      const entries: CascadeEntry[] = [];
      for (const descendantId of descendantIdsOf(workTree, projectId)) {
        const descendantGrants = nextGrants.get(descendantId);
        const currentGrant = descendantGrants?.get(user.id);
        if (!descendantGrants || !currentGrant) continue;
        if (roleRank(currentGrant) <= roleRank(newEffective)) continue;
        if (newEffective === null) descendantGrants.delete(user.id);
        else descendantGrants.set(user.id, newEffective);
        if (descendantGrants.size === 0) nextGrants.delete(descendantId);
        entries.push({
          projectId: descendantId,
          title: workTree.get(descendantId)?.title ?? descendantId,
          from: currentGrant,
          to: newEffective,
        });
      }
      if (entries.length > 0) {
        cascades.push({
          userId: user.id,
          username: usernames.get(user.id) ?? 'account',
          entries,
        });
      }
    }
  }

  // Validate the whole affected subtree against the simulated grants.
  const effectiveRoles = effectiveRolesByUser(workTree, nextGrants, users);
  const affected = [projectId, ...descendantIdsOf(workTree, projectId)];
  const lastAdminViolations: ProjectTreeEntry[] = [];
  for (const affectedId of affected) {
    const entry = workTree.get(affectedId);
    if (!entry) continue;
    const adminCount = users.filter(
      (user) => effectiveRoles.get(user.id)?.get(affectedId) === 'admin',
    ).length;
    if (adminCount === 0) lastAdminViolations.push(entry);
  }

  let rootAdminViolation = false;
  const rootEntry = [...workTree.values()].find((entry) => entry.parentId === null);
  if (rootEntry) {
    const appAdmins = users.filter((user) => user.appRole === 'admin');
    const rootAdmins = appAdmins.filter(
      (user) => effectiveRoles.get(user.id)?.get(rootEntry.id) === 'admin',
    );
    if (rootAdmins.length === 0) rootAdminViolation = true;
  }

  return { nextGrants, cascades, lastAdminViolations, rootAdminViolation };
}

export interface ProjectMember {
  userId: string;
  username: string;
  role: ProjectRole;
  appRole: AppRole;
  /** Number of descendants whose explicit grant would be overridden by a reduction. */
  descendantGrants: number;
}

export function listProjectMembers(
  db: BetterSqliteDatabase,
  projectId: string,
): ProjectMember[] {
  const rows = db
    .prepare(
      `SELECT pr.user_id AS userId, pr.role AS role, u.username AS username, u.app_role AS appRole
         FROM project_roles pr
         JOIN users u ON u.id = pr.user_id
        WHERE pr.project_id = ?
        ORDER BY u.username COLLATE NOCASE ASC`,
    )
    .all(projectId) as Array<{
    userId: string;
    role: ProjectRole;
    username: string;
    appRole: AppRole;
  }>;
  const tree = loadProjectTree(db);
  const grants = loadGrantMap(db);

  return rows.map((row) => {
    let descendantGrants = 0;
    for (const descendantId of descendantIdsOf(tree, projectId)) {
      if (grants.get(descendantId)?.has(row.userId)) descendantGrants += 1;
    }
    return { ...row, descendantGrants };
  });
}

export interface ApplyMemberChangeOptions {
  acknowledged: boolean;
  /** Actor's effective role on the project must be admin. */
  actor: AccessUser;
  /** New access mode along with the grant changes (Members settings tab). */
  access?: ProjectAccessMode;
}

export interface ApplyMemberChangeResult {
  members: ProjectMember[];
  cascadedProjects: number;
  access: ProjectAccessMode;
}

export function getProjectAccessMode(
  db: BetterSqliteDatabase,
  projectId: string,
): ProjectAccessMode {
  const row = db.prepare('SELECT parent_id, settings FROM projects WHERE id = ?').get(projectId) as
    | { parent_id: string | null; settings: string }
    | undefined;
  if (!row) throw new DomainError(404, 'not_found', 'Project not found.');
  return parseProjectAccess(row.settings, row.parent_id === null);
}

/** Writes `settings.access` without touching the other settings keys. */
export function writeProjectAccessMode(
  db: BetterSqliteDatabase,
  projectId: string,
  access: ProjectAccessMode,
): void {
  const row = db.prepare('SELECT settings FROM projects WHERE id = ?').get(projectId) as
    | { settings: string }
    | undefined;
  if (!row) throw new DomainError(404, 'not_found', 'Project not found.');
  const settings = parseJsonObject(row.settings);
  settings.access = access;
  db.prepare('UPDATE projects SET settings = ? WHERE id = ?').run(
    JSON.stringify(settings),
    projectId,
  );
}

/**
 * Applies a member change atomically: validates the whole subtree, requires an
 * acknowledgement when grants are cascaded, then writes the explicit grants.
 */
export function applyMemberChanges(
  db: BetterSqliteDatabase,
  projectId: string,
  changes: readonly MemberChange[],
  options: ApplyMemberChangeOptions,
): ApplyMemberChangeResult {
  const tree = loadProjectTree(db);
  if (!tree.has(projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  const grants = loadGrantMap(db);
  const users = loadAccessUsers(db);
  const usernames = loadUsernames(db);
  const actor = users.find((user) => user.id === options.actor.id);
  const actorRole = actor ? effectiveRoleFor(tree, grants, actor, projectId) : null;
  if (actorRole !== 'admin' || isReadOnlyViewer(options.actor)) {
    throw new DomainError(403, 'forbidden', 'You must be a project Admin to change members.');
  }

  const currentAccess = getProjectAccessMode(db, projectId);
  const requestedAccess = options.access ?? currentAccess;
  const isRoot = tree.get(projectId)?.parentId === null;
  if (options.access && options.access !== 'inherit' && options.access !== 'custom') {
    throw new DomainError(422, 'validation_failed', 'Unknown access mode.');
  }
  if (isRoot && requestedAccess === 'inherit') {
    // Root is always custom (build-spec §6 rule 2).
    throw new DomainError(422, 'validation_failed', 'Root always uses Custom access.');
  }

  const plan = planMemberUpdate(tree, grants, users, projectId, changes, usernames, {
    access: requestedAccess,
  });

  if (plan.lastAdminViolations.length > 0 || plan.rootAdminViolation) {
    const names = plan.lastAdminViolations.map((entry) => entry.title).join(', ');
    const message = plan.rootAdminViolation
      ? 'Root must keep at least one application Admin. Add another application Admin first.'
      : `This change would leave these projects without an Admin: ${names}. Add another Admin first.`;
    throw new DomainError(409, 'last_admin', message);
  }

  const becomingCustom = currentAccess === 'inherit' && requestedAccess === 'custom';
  if (becomingCustom && !options.acknowledged) {
    throw new DomainError(
      409,
      'acknowledgement_required',
      'Switching to Custom access stops inheritance, so descendants may lose inherited access. Confirm to continue.',
      { acknowledgement: 'Required' },
    );
  }
  const cascadedProjects = plan.cascades.reduce((total, cascade) => total + cascade.entries.length, 0);
  if (cascadedProjects > 0 && !options.acknowledged) {
    const names = plan.cascades.map((cascade) => cascade.username).join(', ');
    throw new DomainError(
      409,
      'acknowledgement_required',
      `Reducing ${names} also restricts ${cascadedProjects} descendant permission${
        cascadedProjects === 1 ? '' : 's'
      }. Confirm the cascade to continue.`,
      { acknowledgement: 'Required' },
    );
  }

  const apply = db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO project_roles (project_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
    );
    const remove = db.prepare('DELETE FROM project_roles WHERE project_id = ? AND user_id = ?');
    const changedUserIds = new Set(changes.map((change) => change.userId));

    for (const change of changes) {
      if (change.role === null) remove.run(projectId, change.userId);
      else insert.run(projectId, change.userId, change.role);
    }
    for (const cascade of plan.cascades) {
      for (const entry of cascade.entries) {
        if (entry.to === null) remove.run(entry.projectId, cascade.userId);
        else insert.run(entry.projectId, cascade.userId, entry.to);
      }
    }
    if (requestedAccess !== currentAccess) {
      writeProjectAccessMode(db, projectId, requestedAccess);
    }
    void changedUserIds;
  });
  apply();

  return {
    members: listProjectMembers(db, projectId),
    cascadedProjects,
    access: requestedAccess,
  };
}

/**
 * Returns the explicit grant a user holds on a project (not inherited).
 * Used by the settings UI to show overrides.
 */
export function getExplicitGrant(
  db: BetterSqliteDatabase,
  projectId: string,
  userId: string,
): ProjectRole | null {
  const row = db
    .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId) as { role: ProjectRole } | undefined;
  return row?.role ?? null;
}

export interface MemberCandidateInfo {
  id: string;
  username: string;
  appRole: AppRole;
  explicitRole: ProjectRole | null;
  /** Effective role coming from the parent when this project is `inherit`. */
  inheritedRole: ProjectRole | null;
  effectiveRole: ProjectRole | null;
}

/**
 * Every account with its explicit, inherited and effective role on a project.
 * Used by the Members settings tab so an Admin can add or lower a grant with
 * full context ("Inherited: User" vs "Custom access").
 */
export function listMemberCandidates(
  db: BetterSqliteDatabase,
  projectId: string,
): MemberCandidateInfo[] {
  const tree = loadProjectTree(db);
  const entry = tree.get(projectId);
  if (!entry) throw new DomainError(404, 'not_found', 'Project not found.');
  const grants = loadGrantMap(db);
  const users = loadAccessUsers(db);
  const names = loadUsernames(db);
  const explicit = grants.get(projectId) ?? new Map<string, ProjectRole>();
  const isRoot = entry.parentId === null;
  const access = entry.access ?? (isRoot ? 'custom' : 'inherit');

  const candidates: MemberCandidateInfo[] = users.map((user) => {
    const explicitRole = explicit.get(user.id) ?? null;
    let inheritedRole: ProjectRole | null;
    if (isRoot) {
      inheritedRole = explicitRole === null && user.appRole === 'admin' ? 'admin' : null;
    } else {
      inheritedRole = effectiveRoleFor(tree, grants, user, entry.parentId as string);
    }
    const effectiveRole =
      explicitRole ??
      (isRoot
        ? user.appRole === 'admin'
          ? 'admin'
          : null
        : access === 'inherit'
          ? inheritedRole
          : null);
    return {
      id: user.id,
      username: names.get(user.id) ?? user.id,
      appRole: user.appRole,
      explicitRole,
      inheritedRole,
      effectiveRole,
    };
  });
  return candidates.sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
}
