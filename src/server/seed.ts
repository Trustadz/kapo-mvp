import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { hashPassword } from './auth/password';
import { AUDIT_ACTIONS, AUDIT_FIELDS } from '../lib/audit';
import {
  DEFAULT_PROJECT_SETTINGS,
  defaultUserDashboard,
  insertDefaultSettings,
  insertWorkflow,
  type WorkflowStatusRow,
} from './db/bootstrap';
import { indexProject } from './db/search';
import { newId } from './db/util';

/**
 * Mock household data — build-spec §10, exactly.
 *
 * Accounts: tristan (Admin), maya (User), jules (User), alex (Viewer).
 * Root workflow: To do (start), In progress, Done (finish).
 * Project tree: Home improvement → Renovate basement → Find contractor plus
 * Paint hallway, Install hall shelf, Garden beds, Fix kitchen tap;
 * Household → Paint porch, Book boiler service; Personal → Plan weekend trip.
 * Inbox: Book boiler service, Plan weekend trip, Renovate basement.
 * Favorites (tristan): Home improvement, Household, Personal.
 */

export const SEED_PASSWORD = 'kapo1234';

export interface SeedSummary {
  users: number;
  projects: number;
  statuses: number;
  favorites: number;
  auditEvents: number;
  rootProjectId: string;
  adminId: string;
}

interface SeedUser {
  key: 'tristan' | 'maya' | 'jules' | 'alex';
  username: string;
  email: string;
  appRole: 'admin' | 'user' | 'viewer';
}

const SEED_USERS: SeedUser[] = [
  { key: 'tristan', username: 'tristan', email: 'tristan@example.com', appRole: 'admin' },
  { key: 'maya', username: 'maya', email: 'maya@example.com', appRole: 'user' },
  { key: 'jules', username: 'jules', email: 'jules@example.com', appRole: 'user' },
  { key: 'alex', username: 'alex', email: 'alex@example.com', appRole: 'viewer' },
];

interface SeedProject {
  key: string;
  title: string;
  parentKey: string | null;
  reporterKey: SeedUser['key'];
  createdByKey: SeedUser['key'];
  statusIndex: number | null;
  inbox?: boolean;
  seq: number;
  createdAt: string;
  updatedAt: string;
  settings?: Record<string, unknown>;
}

interface SeedEvent {
  projectKey: string;
  actorKey: SeedUser['key'];
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  targetKey?: string;
  detail?: string;
  createdAt: string;
}

function daysAgo(days: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/**
 * Clears seeded tables while respecting foreign keys.
 *
 * Deleting several projects in one statement can trip the immediate RESTRICT
 * from projects.status_id to statuses while a sibling is still being removed,
 * so projects are deleted leaf-first and their statuses cascade safely.
 */
export function clearDatabase(db: BetterSqliteDatabase): void {
  db.exec(`
    DELETE FROM project_search;
    DELETE FROM audit_events;
    DELETE FROM favorites;
    DELETE FROM project_roles;
    DELETE FROM sessions;
  `);

  const leafFirst = db
    .prepare(
      `WITH RECURSIVE depths(id, depth) AS (
         SELECT id, 1 FROM projects WHERE parent_id IS NULL
         UNION ALL
         SELECT p.id, d.depth + 1 FROM projects p JOIN depths d ON p.parent_id = d.id
       )
       SELECT id FROM depths WHERE depth > 1 ORDER BY depth DESC`,
    )
    .all() as Array<{ id: string }>;
  const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?');
  for (const project of leafFirst) deleteProject.run(project.id);

  db.exec(`
    DELETE FROM statuses;
    DELETE FROM projects;
    DELETE FROM trash_actions;
    DELETE FROM users;
    DELETE FROM settings;
    DELETE FROM addons;
  `);
}

export async function seedDatabase(db: BetterSqliteDatabase): Promise<SeedSummary> {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const run = db.transaction((): SeedSummary => {
    clearDatabase(db);
    insertDefaultSettings(db);

    const userIds = new Map<SeedUser['key'], string>();
    const insertUser = db.prepare(
      `INSERT INTO users (
         id, username, email, password_hash, avatar, app_role, landing_page,
         appearance, dashboard, show_archived, created_at
       ) VALUES (?, ?, ?, ?, NULL, ?, 'home', 'system', ?, 0, ?)`,
    );
    const createdAt = daysAgo(4, 9, 0);
    for (const user of SEED_USERS) {
      const userId = newId();
      userIds.set(user.key, userId);
      insertUser.run(
        userId,
        user.username,
        user.email,
        passwordHash,
        user.appRole,
        defaultUserDashboard(),
        createdAt,
      );
    }

    const userId = (key: SeedUser['key']): string => {
      const id = userIds.get(key);
      if (!id) throw new Error(`Unknown seed user ${key}`);
      return id;
    };

    // Project insertion order defines sequence IDs. Home improvement is
    // KAP-104 to match the reference design's project page.
    const projects: SeedProject[] = [
      {
        key: 'root',
        title: 'Root',
        parentKey: null,
        reporterKey: 'tristan',
        createdByKey: 'tristan',
        statusIndex: null,
        seq: 100,
        createdAt: daysAgo(4, 9, 5),
        updatedAt: daysAgo(4, 9, 5),
      },
      {
        key: 'home',
        title: 'Home improvement',
        parentKey: 'root',
        reporterKey: 'tristan',
        createdByKey: 'tristan',
        statusIndex: 0,
        seq: 104,
        createdAt: daysAgo(3, 18, 4),
        updatedAt: daysAgo(2, 10, 42),
      },
      {
        key: 'renovate',
        title: 'Renovate basement',
        parentKey: 'home',
        reporterKey: 'maya',
        createdByKey: 'maya',
        statusIndex: 0,
        inbox: true,
        seq: 105,
        createdAt: daysAgo(3, 17, 20),
        updatedAt: daysAgo(2, 9, 12),
      },
      {
        key: 'contractor',
        title: 'Find contractor',
        parentKey: 'renovate',
        reporterKey: 'jules',
        createdByKey: 'jules',
        statusIndex: 0,
        seq: 106,
        createdAt: daysAgo(2, 9, 10),
        updatedAt: daysAgo(2, 9, 10),
      },
      {
        key: 'paintHallway',
        title: 'Paint hallway',
        parentKey: 'home',
        reporterKey: 'jules',
        createdByKey: 'jules',
        statusIndex: 0,
        seq: 107,
        createdAt: daysAgo(2, 9, 58),
        updatedAt: daysAgo(2, 9, 58),
      },
      {
        key: 'shelf',
        title: 'Install hall shelf',
        parentKey: 'home',
        reporterKey: 'maya',
        createdByKey: 'maya',
        statusIndex: 2,
        seq: 108,
        createdAt: daysAgo(3, 12, 15),
        updatedAt: daysAgo(1, 15, 5),
      },
      {
        key: 'garden',
        title: 'Garden beds',
        parentKey: 'home',
        reporterKey: 'tristan',
        createdByKey: 'tristan',
        statusIndex: 1,
        seq: 109,
        createdAt: daysAgo(3, 11, 30),
        updatedAt: daysAgo(1, 11, 40),
      },
      {
        key: 'tap',
        title: 'Fix kitchen tap',
        parentKey: 'home',
        reporterKey: 'maya',
        createdByKey: 'maya',
        statusIndex: 1,
        seq: 110,
        createdAt: daysAgo(2, 8, 20),
        updatedAt: daysAgo(1, 16, 45),
      },
      {
        key: 'household',
        title: 'Household',
        parentKey: 'root',
        reporterKey: 'maya',
        createdByKey: 'maya',
        statusIndex: 0,
        seq: 111,
        createdAt: daysAgo(3, 9, 30),
        updatedAt: daysAgo(2, 11, 5),
      },
      {
        key: 'porch',
        title: 'Paint porch',
        parentKey: 'household',
        reporterKey: 'tristan',
        createdByKey: 'tristan',
        statusIndex: 0,
        seq: 112,
        createdAt: daysAgo(2, 11, 0),
        updatedAt: daysAgo(2, 11, 0),
      },
      {
        key: 'boiler',
        title: 'Book boiler service',
        parentKey: 'household',
        reporterKey: 'maya',
        createdByKey: 'maya',
        statusIndex: 0,
        inbox: true,
        seq: 113,
        createdAt: daysAgo(2, 10, 15),
        updatedAt: daysAgo(2, 10, 15),
      },
      {
        key: 'personal',
        title: 'Personal',
        parentKey: 'root',
        reporterKey: 'tristan',
        createdByKey: 'tristan',
        statusIndex: 0,
        seq: 114,
        createdAt: daysAgo(3, 8, 45),
        updatedAt: daysAgo(2, 8, 30),
        settings: { access: 'custom' },
      },
      {
        key: 'weekend',
        title: 'Plan weekend trip',
        parentKey: 'personal',
        reporterKey: 'tristan',
        createdByKey: 'tristan',
        statusIndex: 0,
        inbox: true,
        seq: 115,
        createdAt: daysAgo(2, 8, 25),
        updatedAt: daysAgo(2, 8, 25),
      },
    ];

    const projectIds = new Map<string, string>();
    const projectRows = new Map<string, SeedProject>();
    for (const project of projects) projectRows.set(project.key, project);

    const insertProject = db.prepare(
      `INSERT INTO projects (
         id, seq, title, reporter_id, parent_id, status_id, priority, inbox, archived,
         trashed_at, trash_action_id, purge_deadline, addon_data, settings,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
    );

    // Root first, then the rest with each project's parent's start status.
    const workflows = new Map<string, WorkflowStatusRow[]>();
    // Issue #53: one global priority sequence shared by every project. The
    // documented tree order below is the intended global order, so a single
    // counter in insertion order is all the seed needs.
    let nextGlobalPriority = 0;

    const insertProjectRow = (project: SeedProject): void => {
      const parentId = project.parentKey ? (projectIds.get(project.parentKey) ?? null) : null;
      const parentWorkflow = project.parentKey ? (workflows.get(project.parentKey) ?? []) : [];
      const status = project.statusIndex === null ? null : parentWorkflow[project.statusIndex];
      if (status === undefined) {
        throw new Error(`Missing status for ${project.key}`);
      }
      const id = newId();
      projectIds.set(project.key, id);
      insertProject.run(
        id,
        project.seq,
        project.title,
        userId(project.reporterKey),
        parentId,
        status ? status.id : null,
        nextGlobalPriority,
        project.inbox ? 1 : 0,
        JSON.stringify({ ...DEFAULT_PROJECT_SETTINGS, ...(project.settings ?? {}) }),
        userId(project.createdByKey),
        project.createdAt,
        project.updatedAt,
      );
      nextGlobalPriority += 1;

      // Every project owns the workflow for its children, even projects that
      // do not have children yet. A leaf must be able to receive a child
      // immediately, so its default workflow is part of the seed invariant.
      const statuses =
        project.key === 'root' || project.key === 'home'
          ? insertWorkflow(db, id, [
              { name: 'To do', isStart: true },
              { name: 'In progress' },
              { name: 'Done', isFinish: true },
            ])
          : insertWorkflow(db, id, [
              { name: 'To do', isStart: true },
              { name: 'Done', isFinish: true },
            ]);
      workflows.set(project.key, statuses);

      indexProject(db, { projectId: id, title: project.title, body: '' });
    };

    // Insertion order: parents before children, in display order.
    const ordered = [
      'root',
      'home',
      'renovate',
      'contractor',
      'paintHallway',
      'shelf',
      'garden',
      'tap',
      'household',
      'porch',
      'boiler',
      'personal',
      'weekend',
    ];
    for (const key of ordered) {
      const project = projectRows.get(key);
      if (!project) throw new Error(`Unknown seed project ${key}`);
      insertProjectRow(project);
    }

    const projectId = (key: string): string => {
      const id = projectIds.get(key);
      if (!id) throw new Error(`Unknown seed project ${key}`);
      return id;
    };

    // Permissions: shared projects have explicit grants; Personal is private
    // to tristan; creators are explicitly project Admins on their projects.
    const sharedProjectKeys = ['home', 'household'];
    const insertRole = db.prepare(
      'INSERT OR REPLACE INTO project_roles (project_id, user_id, role) VALUES (?, ?, ?)',
    );
    insertRole.run(projectId('root'), userId('maya'), 'user');
    insertRole.run(projectId('root'), userId('jules'), 'user');
    insertRole.run(projectId('root'), userId('alex'), 'viewer');
    for (const key of sharedProjectKeys) {
      insertRole.run(projectId(key), userId('tristan'), 'admin');
      insertRole.run(projectId(key), userId('maya'), 'user');
      insertRole.run(projectId(key), userId('jules'), 'user');
      insertRole.run(projectId(key), userId('alex'), 'viewer');
    }
    insertRole.run(projectId('personal'), userId('tristan'), 'admin');
    for (const project of projects) {
      if (project.key === 'root') continue;
      insertRole.run(projectId(project.key), userId(project.createdByKey), 'admin');
    }

    // Favorites for the Admin demo account.
    const insertFavorite = db.prepare(
      'INSERT OR IGNORE INTO favorites (user_id, project_id) VALUES (?, ?)',
    );
    for (const key of ['home', 'household', 'personal']) {
      insertFavorite.run(userId('tristan'), projectId(key));
    }

    const auditEvents: SeedEvent[] = [
      {
        projectKey: 'root',
        actorKey: 'tristan',
        action: AUDIT_ACTIONS.projectCreated,
        detail: 'Root project created',
        createdAt: daysAgo(4, 9, 5),
      },
      {
        projectKey: 'home',
        actorKey: 'tristan',
        action: AUDIT_ACTIONS.projectCreated,
        detail: 'Project created under Root',
        createdAt: daysAgo(3, 18, 4),
      },
      {
        projectKey: 'home',
        actorKey: 'jules',
        action: AUDIT_ACTIONS.childCreated,
        targetKey: 'paintHallway',
        newValue: 'Paint hallway',
        detail: 'Child project created',
        createdAt: daysAgo(2, 9, 58),
      },
      {
        projectKey: 'home',
        actorKey: 'tristan',
        action: AUDIT_ACTIONS.projectStatusChanged,
        field: AUDIT_FIELDS.status,
        oldValue: 'In progress',
        newValue: 'To do',
        createdAt: daysAgo(2, 10, 26),
      },
      {
        projectKey: 'home',
        actorKey: 'maya',
        action: AUDIT_ACTIONS.projectRenamed,
        field: AUDIT_FIELDS.title,
        oldValue: 'Home updates',
        newValue: 'Home improvement',
        createdAt: daysAgo(2, 10, 42),
      },
      {
        projectKey: 'renovate',
        actorKey: 'maya',
        action: AUDIT_ACTIONS.projectCreated,
        detail: 'Project created under Home improvement',
        createdAt: daysAgo(3, 17, 20),
      },
      {
        projectKey: 'renovate',
        actorKey: 'jules',
        action: AUDIT_ACTIONS.childCreated,
        targetKey: 'contractor',
        newValue: 'Find contractor',
        detail: 'Child project created',
        createdAt: daysAgo(2, 9, 10),
      },
      {
        projectKey: 'garden',
        actorKey: 'tristan',
        action: AUDIT_ACTIONS.projectStatusChanged,
        field: AUDIT_FIELDS.status,
        oldValue: 'To do',
        newValue: 'In progress',
        createdAt: daysAgo(1, 11, 40),
      },
      {
        projectKey: 'shelf',
        actorKey: 'maya',
        action: AUDIT_ACTIONS.projectStatusChanged,
        field: AUDIT_FIELDS.status,
        oldValue: 'In progress',
        newValue: 'Done',
        createdAt: daysAgo(1, 15, 5),
      },
      {
        projectKey: 'tap',
        actorKey: 'maya',
        action: AUDIT_ACTIONS.projectStatusChanged,
        field: AUDIT_FIELDS.status,
        oldValue: 'To do',
        newValue: 'In progress',
        createdAt: daysAgo(1, 16, 45),
      },
      {
        projectKey: 'household',
        actorKey: 'maya',
        action: AUDIT_ACTIONS.projectCreated,
        detail: 'Project created under Root',
        createdAt: daysAgo(3, 9, 30),
      },
      {
        projectKey: 'household',
        actorKey: 'tristan',
        action: AUDIT_ACTIONS.childCreated,
        targetKey: 'porch',
        newValue: 'Paint porch',
        detail: 'Child project created',
        createdAt: daysAgo(2, 11, 0),
      },
      {
        projectKey: 'household',
        actorKey: 'maya',
        action: AUDIT_ACTIONS.childCreated,
        targetKey: 'boiler',
        newValue: 'Book boiler service',
        detail: 'Child project created',
        createdAt: daysAgo(2, 10, 15),
      },
      {
        projectKey: 'personal',
        actorKey: 'tristan',
        action: AUDIT_ACTIONS.projectCreated,
        detail: 'Project created under Root',
        createdAt: daysAgo(3, 8, 45),
      },
      {
        projectKey: 'weekend',
        actorKey: 'tristan',
        action: AUDIT_ACTIONS.projectCreated,
        detail: 'Project created under Personal',
        createdAt: daysAgo(2, 8, 25),
      },
    ];

    const insertEvent = db.prepare(
      `INSERT INTO audit_events (
         id, project_id, actor_id, action, field, old_value, new_value,
         target_id, detail, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of auditEvents) {
      insertEvent.run(
        newId(),
        projectId(event.projectKey),
        userId(event.actorKey),
        event.action,
        event.field ?? null,
        event.oldValue ?? null,
        event.newValue ?? null,
        event.targetKey ? projectId(event.targetKey) : null,
        event.detail ?? null,
        event.createdAt,
      );
    }

    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

    return {
      users: count('users'),
      projects: count('projects'),
      statuses: count('statuses'),
      favorites: count('favorites'),
      auditEvents: count('audit_events'),
      rootProjectId: projectId('root'),
      adminId: userId('tristan'),
    };
  });

  return run();
}

export function seedSummaryLine(summary: SeedSummary): string {
  return [
    `seeded ${summary.users} users`,
    `${summary.projects} projects`,
    `${summary.statuses} statuses`,
    `${summary.auditEvents} activity events`,
    `root ${summary.rootProjectId}`,
  ].join(', ');
}
