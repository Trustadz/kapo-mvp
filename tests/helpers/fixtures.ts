import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { hashPassword } from '@/server/auth/password';
import {
  createRootProject,
  DEFAULT_PROJECT_SETTINGS,
  insertWorkflow,
  type RootProject,
  type WorkflowStatusRow,
  type WorkflowStatusSeed,
} from '@/server/db/bootstrap';
import { indexProject } from '@/server/db/search';
import { newId, nowIso } from '@/server/db/util';

/**
 * Deterministic fixture builder.
 *
 * Fixtures write rows directly (no domain layer) so tests start from a known
 * state quickly and don't depend on code under test to create their own
 * preconditions. Every helper returns plain ids/rows.
 */

export const FIXTURE_PASSWORD = 'kapo1234';

let cachedHash: Promise<string> | null = null;

export function fixturePasswordHash(): Promise<string> {
  if (!cachedHash) cachedHash = hashPassword(FIXTURE_PASSWORD);
  return cachedHash;
}

export interface CreateUserOptions {
  username?: string;
  email?: string;
  appRole?: 'admin' | 'user' | 'viewer';
  password?: string;
  appearance?: 'light' | 'dark' | 'system';
  landingPage?: string;
  dashboard?: string;
  showArchived?: boolean;
}

export interface FixtureUser {
  id: string;
  username: string;
  email: string;
  appRole: 'admin' | 'user' | 'viewer';
}

let userCounter = 0;

export async function createUser(
  db: BetterSqliteDatabase,
  options: CreateUserOptions = {},
): Promise<FixtureUser> {
  userCounter += 1;
  const username = options.username ?? `user-${userCounter}`;
  const id = newId();
  const passwordHash = await (options.password
    ? hashPassword(options.password)
    : fixturePasswordHash());
  db.prepare(
    `INSERT INTO users (
       id, username, email, password_hash, avatar, app_role, landing_page,
       appearance, dashboard, show_archived, created_at
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    username,
    options.email ?? `${username}@example.com`,
    passwordHash,
    options.appRole ?? 'user',
    options.landingPage ?? 'home',
    options.appearance ?? 'system',
    options.dashboard ?? '[{"id":"inbox","visible":true},{"id":"recent","visible":true}]',
    options.showArchived ? 1 : 0,
    nowIso(),
  );
  return { id, username, email: options.email ?? `${username}@example.com`, appRole: options.appRole ?? 'user' };
}

/** Creates Root plus its workflow (To do / In progress / Done). */
export function createRoot(db: BetterSqliteDatabase, createdBy: string): RootProject {
  return createRootProject(db, createdBy);
}

export interface CreateWorkflowOptions {
  /** Status names if the short form is used. */
  names?: string[];
  statuses?: WorkflowStatusSeed[];
  startName?: string;
}

/**
 * Creates the workflow owned by `parentId` (i.e. the statuses available to its
 * children). Defaults to a sensible To do / In progress / Done workflow.
 */
export function createWorkflow(
  db: BetterSqliteDatabase,
  parentId: string,
  options: CreateWorkflowOptions = {},
): WorkflowStatusRow[] {
  if (options.statuses) return insertWorkflow(db, parentId, options.statuses);
  if (options.names) {
    return insertWorkflow(
      db,
      parentId,
      options.names.map((name, index) => ({
        name,
        isStart: index === 0,
        isFinish: index === options.names!.length - 1 && index > 0,
      })),
    );
  }
  return insertWorkflow(db, parentId, [
    { name: options.startName ?? 'To do', isStart: true },
    { name: 'In progress' },
    { name: 'Done', isFinish: true },
  ]);
}

export function getStatuses(db: BetterSqliteDatabase, parentId: string): WorkflowStatusRow[] {
  const rows = db
    .prepare(
      `SELECT id, parent_id, name, position, is_start, is_finish
         FROM statuses WHERE parent_id = ? ORDER BY position ASC`,
    )
    .all(parentId) as Array<{
    id: string;
    parent_id: string;
    name: string;
    position: number;
    is_start: number;
    is_finish: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    position: row.position,
    isStart: row.is_start === 1,
    isFinish: row.is_finish === 1,
  }));
}

export function getStartStatus(db: BetterSqliteDatabase, parentId: string): WorkflowStatusRow {
  const status = getStatuses(db, parentId).find((candidate) => candidate.isStart);
  if (!status) throw new Error(`No start status for parent ${parentId}`);
  return status;
}

export function getFinishStatus(db: BetterSqliteDatabase, parentId: string): WorkflowStatusRow {
  const status = getStatuses(db, parentId).find((candidate) => candidate.isFinish);
  if (!status) throw new Error(`No finish status for parent ${parentId}`);
  return status;
}

export function getStatusByName(
  db: BetterSqliteDatabase,
  parentId: string,
  name: string,
): WorkflowStatusRow {
  const status = getStatuses(db, parentId).find((candidate) => candidate.name === name);
  if (!status) throw new Error(`No status "${name}" for parent ${parentId}`);
  return status;
}

export interface CreateProjectOptions {
  title?: string;
  parentId: string;
  statusId?: string;
  priority?: number;
  inbox?: boolean;
  archived?: boolean;
  trashedAt?: string | null;
  trashActionId?: string | null;
  purgeDeadline?: string | null;
  reporterId: string;
  createdBy?: string;
  settings?: Record<string, unknown>;
  addonData?: Record<string, unknown>;
  seq?: number;
  createdAt?: string;
  updatedAt?: string;
  /** Maintain the FTS row the same way production writes do (default true). */
  indexSearch?: boolean;
}

export interface FixtureProject {
  id: string;
  seq: number;
  title: string;
  parentId: string;
  statusId: string;
  priority: number;
}

let titleCounter = 0;

function nextSeq(db: BetterSqliteDatabase): number {
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM projects').get() as {
    seq: number;
  };
  return row.seq + 1;
}

function nextPriority(db: BetterSqliteDatabase, parentId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(priority), -1) AS priority FROM projects WHERE parent_id = ?')
    .get(parentId) as { priority: number };
  return row.priority + 1;
}

export function createProject(
  db: BetterSqliteDatabase,
  options: CreateProjectOptions,
): FixtureProject {
  titleCounter += 1;
  const title = options.title ?? `Project ${titleCounter}`;
  const statusId = options.statusId ?? getStartStatus(db, options.parentId).id;
  const createdAt = options.createdAt ?? nowIso();
  const id = newId();
  const seq = options.seq ?? nextSeq(db);
  const priority = options.priority ?? nextPriority(db, options.parentId);
  db.prepare(
    `INSERT INTO projects (
       id, seq, title, reporter_id, parent_id, status_id, priority, inbox, archived,
       trashed_at, trash_action_id, purge_deadline, addon_data, settings,
       created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    seq,
    title,
    options.reporterId,
    options.parentId,
    statusId,
    priority,
    options.inbox === false ? 0 : 1,
    options.archived ? 1 : 0,
    options.trashedAt ?? null,
    options.trashActionId ?? null,
    options.purgeDeadline ?? null,
    JSON.stringify(options.addonData ?? {}),
    JSON.stringify({ ...DEFAULT_PROJECT_SETTINGS, ...(options.settings ?? {}) }),
    options.createdBy ?? options.reporterId,
    createdAt,
    options.updatedAt ?? createdAt,
  );
  if (options.indexSearch !== false) {
    indexProject(db, { projectId: id, title, body: '' });
  }
  return { id, seq, title, parentId: options.parentId, statusId, priority };
}

export function createTrashAction(db: BetterSqliteDatabase, actorId: string): string {
  const id = newId();
  db.prepare('INSERT INTO trash_actions (id, actor_id, created_at) VALUES (?, ?, ?)').run(
    id,
    actorId,
    nowIso(),
  );
  return id;
}

export function grantRole(
  db: BetterSqliteDatabase,
  projectId: string,
  userId: string,
  role: 'admin' | 'user' | 'viewer',
): void {
  db.prepare(
    `INSERT INTO project_roles (project_id, user_id, role) VALUES (?, ?, ?)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(projectId, userId, role);
}

export function removeGrant(db: BetterSqliteDatabase, projectId: string, userId: string): void {
  db.prepare('DELETE FROM project_roles WHERE project_id = ? AND user_id = ?').run(
    projectId,
    userId,
  );
}

export function addFavorite(db: BetterSqliteDatabase, userId: string, projectId: string): void {
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, project_id) VALUES (?, ?)').run(
    userId,
    projectId,
  );
}

export interface FixtureHousehold {
  tristan: FixtureUser;
  maya: FixtureUser;
  jules: FixtureUser;
  alex: FixtureUser;
  root: RootProject;
  home: FixtureProject;
  renovate: FixtureProject;
  contractor: FixtureProject;
  paintHallway: FixtureProject;
  garden: FixtureProject;
  household: FixtureProject;
  porch: FixtureProject;
  personal: FixtureProject;
  weekend: FixtureProject;
}

/**
 * A small but realistic household tree used by permission/search/inbox tests.
 *
 * Root (tristan admin; maya/jules user; alex viewer)
 * ├── Home improvement (tristan admin; maya/jules user; alex viewer)
 * │   ├── Renovate basement (maya admin; inbox)
 * │   │   └── Find contractor
 * │   └── Paint hallway (jules admin — no grant for maya)
 * ├── Household (maya admin)
 * │   └── Paint porch
 * └── Personal (tristan admin, private)
 *     └── Plan weekend trip (inbox)
 */
export async function buildHouseholdFixture(
  db: BetterSqliteDatabase,
): Promise<FixtureHousehold> {
  const tristan = await createUser(db, { username: 'tristan', appRole: 'admin' });
  const maya = await createUser(db, { username: 'maya', appRole: 'user' });
  const jules = await createUser(db, { username: 'jules', appRole: 'user' });
  const alex = await createUser(db, { username: 'alex', appRole: 'viewer' });

  const root = createRoot(db, tristan.id);
  grantRole(db, root.id, maya.id, 'user');
  grantRole(db, root.id, jules.id, 'user');
  grantRole(db, root.id, alex.id, 'viewer');

  // Root's workflow has To do / In progress / Done.
  const home = createProject(db, {
    title: 'Home improvement',
    parentId: root.id,
    reporterId: tristan.id,
  });
  const household = createProject(db, {
    title: 'Household',
    parentId: root.id,
    reporterId: maya.id,
  });
  // Matches the seed: Personal is Custom access, so Root grants do not leak in.
  const personal = createProject(db, {
    title: 'Personal',
    parentId: root.id,
    reporterId: tristan.id,
    settings: { access: 'custom' },
  });
  grantRole(db, home.id, tristan.id, 'admin');
  grantRole(db, home.id, maya.id, 'user');
  grantRole(db, home.id, jules.id, 'user');
  grantRole(db, home.id, alex.id, 'viewer');
  grantRole(db, household.id, maya.id, 'admin');
  grantRole(db, personal.id, tristan.id, 'admin');

  // Home improvement owns a three-column workflow for its children.
  createWorkflow(db, home.id);
  const renovate = createProject(db, {
    title: 'Renovate basement',
    parentId: home.id,
    reporterId: maya.id,
    inbox: true,
  });
  grantRole(db, renovate.id, maya.id, 'admin');
  const paintHallway = createProject(db, {
    title: 'Paint hallway',
    parentId: home.id,
    reporterId: jules.id,
  });
  grantRole(db, paintHallway.id, jules.id, 'admin');

  // Renovate basement owns its own workflow for Find contractor.
  createWorkflow(db, renovate.id, { names: ['To do', 'Done'] });
  const contractor = createProject(db, {
    title: 'Find contractor',
    parentId: renovate.id,
    reporterId: jules.id,
    inbox: false,
  });

  // Household workflow.
  createWorkflow(db, household.id, { names: ['To do', 'Done'] });
  const porch = createProject(db, {
    title: 'Paint porch',
    parentId: household.id,
    reporterId: tristan.id,
  });

  // Personal workflow.
  createWorkflow(db, personal.id, { names: ['To do', 'Done'] });
  const weekend = createProject(db, {
    title: 'Plan weekend trip',
    parentId: personal.id,
    reporterId: jules.id,
    inbox: true,
  });

  addFavorite(db, tristan.id, home.id);
  addFavorite(db, tristan.id, household.id);
  addFavorite(db, tristan.id, personal.id);

  return {
    tristan,
    maya,
    jules,
    alex,
    root,
    home,
    renovate,
    contractor,
    paintHallway,
    garden: paintHallway, // alias kept for readability in some tests
    household,
    porch,
    personal,
    weekend,
  };
}

/** Reads a project row with the snake_case columns used by the schema. */
export interface ProjectRow {
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
}

export function getProjectRow(
  db: BetterSqliteDatabase,
  projectId: string,
): ProjectRow | undefined {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | ProjectRow
    | undefined;
}

export function listProjectRows(
  db: BetterSqliteDatabase,
  parentId: string | null,
): ProjectRow[] {
  const rows = db
    .prepare('SELECT * FROM projects WHERE parent_id IS ? ORDER BY priority ASC')
    .all(parentId) as ProjectRow[];
  return rows;
}

export function getRole(
  db: BetterSqliteDatabase,
  projectId: string,
  userId: string,
): string | null {
  const row = db
    .prepare('SELECT role FROM project_roles WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId) as { role: string } | undefined;
  return row?.role ?? null;
}

export function countAuditEvents(
  db: BetterSqliteDatabase,
  projectId?: string,
): number {
  const row = projectId
    ? (db
        .prepare('SELECT COUNT(*) AS count FROM audit_events WHERE project_id = ?')
        .get(projectId) as { count: number })
    : (db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number });
  return row.count;
}

export type { RootProject, WorkflowStatusRow, WorkflowStatusSeed } from '@/server/db/bootstrap';
