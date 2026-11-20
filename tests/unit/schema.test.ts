import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { newId, nowIso } from '@/server/db/util';
import {
  createTestDatabase,
  type TestDatabase,
} from '../helpers/db';
import {
  createProject,
  createRoot,
  createUser,
  createWorkflow,
  type FixtureUser,
} from '../helpers/fixtures';

/**
 * Schema / invariant tests for 001_init.sql (build-spec §5).
 *
 * These tests write raw SQL on purpose: they prove the database itself rejects
 * invalid states no matter which code path gets there.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;

beforeAll(async () => {
  test = createTestDatabase({ label: 'schema' });
  db = test.db;
  admin = await createUser(db, { username: 'schema-admin', appRole: 'admin' });
});

afterAll(() => {
  test.cleanup();
});

function firstStatus(parentId: string | null): string | null {
  if (!parentId) return null;
  const row = db
    .prepare('SELECT id FROM statuses WHERE parent_id = ? ORDER BY position ASC LIMIT 1')
    .get(parentId) as { id: string } | undefined;
  return row?.id ?? null;
}

function nextGlobalPriority(): number {
  const row = db.prepare('SELECT COALESCE(MAX(priority), -1) AS priority FROM projects').get() as {
    priority: number;
  };
  return row.priority + 1;
}

function insertProjectRow(overrides: Partial<Record<string, unknown>> = {}): void {
  const parent = overrides.parentId as string | undefined;
  const statusId =
    overrides.statusId === undefined
      ? firstStatus(parent ?? null)
      : (overrides.statusId as string | null);
  db.prepare(
    `INSERT INTO projects (
       id, seq, title, reporter_id, parent_id, status_id, priority, inbox, archived,
       addon_data, settings, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '{}', '{}', ?, ?, ?)`,
  ).run(
    (overrides.id as string) ?? newId(),
    (overrides.seq as number) ?? 9000,
    (overrides.title as string) ?? 'Raw project',
    (overrides.reporterId as string) ?? admin.id,
    parent ?? null,
    statusId,
    overrides.priority !== undefined
      ? (overrides.priority as number)
      : parent
        ? nextGlobalPriority()
        : 0,
    (overrides.inbox as number) ?? 1,
    (overrides.createdBy as string) ?? admin.id,
    nowIso(),
    nowIso(),
  );
}

describe('connection configuration', () => {
  it('enables foreign keys, WAL and a busy timeout', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(String(db.pragma('journal_mode', { simple: true }))).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });
});

describe('single Root trigger', () => {
  let rootId: string;

  beforeAll(() => {
    rootId = createRoot(db, admin.id).id;
  });

  it('allows exactly one Root project', () => {
    const roots = db
      .prepare('SELECT COUNT(*) AS count FROM projects WHERE parent_id IS NULL')
      .get() as { count: number };
    expect(roots.count).toBe(1);
  });

  it('rejects a second project with a null parent at insert time', () => {
    expect(() => insertProjectRow()).toThrow(/Only one Root project may exist/);
  });

  it('rejects promoting another project to Root via UPDATE', () => {
    const child = createProject(db, {
      title: 'Promote me',
      parentId: rootId,
      reporterId: admin.id,
      indexSearch: false,
    });
    expect(() =>
      db
        .prepare('UPDATE projects SET parent_id = NULL, status_id = NULL WHERE id = ?')
        .run(child.id),
    ).toThrow(/Only one Root project may exist/);
    const row = db.prepare('SELECT parent_id FROM projects WHERE id = ?').get(child.id) as {
      parent_id: string | null;
    };
    expect(row.parent_id).toBe(rootId);
  });
});

describe('project constraints', () => {
  let rootId: string;

  beforeAll(() => {
    const existing = db.prepare('SELECT id FROM projects WHERE parent_id IS NULL').get() as
      | { id: string }
      | undefined;
    rootId = existing?.id ?? createRoot(db, admin.id).id;
  });

  it('rejects an empty or whitespace-only title', () => {
    expect(() => insertProjectRow({ title: '   ', parentId: rootId })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('rejects a non-unique display sequence', () => {
    const seq = (
      db.prepare('SELECT MAX(seq) AS seq FROM projects').get() as { seq: number }
    ).seq;
    expect(() =>
      insertProjectRow({ seq, title: 'Duplicate seq', parentId: rootId }),
    ).toThrow(/UNIQUE constraint failed: projects.seq/);
  });

  it('keeps parent_id and status_id paired (Root invariants)', () => {
    const project = createProject(db, {
      title: 'Paired project',
      parentId: rootId,
      reporterId: admin.id,
      indexSearch: false,
    });
    // A child without a status is invalid...
    expect(() =>
      db.prepare('UPDATE projects SET status_id = NULL WHERE id = ?').run(project.id),
    ).toThrow(/CHECK constraint failed/);
    // ...and a status without a parent would make a second Root (trigger).
    expect(() =>
      db.prepare('UPDATE projects SET parent_id = NULL WHERE id = ?').run(project.id),
    ).toThrow(/Only one Root project may exist/);
  });

  it('rejects duplicate sibling priorities across statuses', () => {
    const startStatus = db
      .prepare('SELECT id FROM statuses WHERE parent_id = ? AND is_start = 1')
      .get(rootId) as { id: string };
    const doneStatus = db
      .prepare('SELECT id FROM statuses WHERE parent_id = ? AND is_finish = 1')
      .get(rootId) as { id: string };
    const first = createProject(db, {
      title: 'Sibling A',
      parentId: rootId,
      statusId: startStatus.id,
      reporterId: admin.id,
      indexSearch: false,
    });
    expect(first.priority).toBeGreaterThanOrEqual(0);
    expect(() =>
      insertProjectRow({
        title: 'Sibling B',
        parentId: rootId,
        statusId: doneStatus.id,
        priority: first.priority,
      }),
    ).toThrow(/UNIQUE constraint failed: projects.parent_id, projects.priority/);
  });

  it('rejects an unknown reporter (foreign keys are on)', () => {
    expect(() =>
      insertProjectRow({
        title: 'Ghost reporter',
        parentId: rootId,
        reporterId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('cascades project-owned rows when a project is deleted leaf-first', () => {
    const parent = createProject(db, {
      title: 'Will be deleted',
      parentId: rootId,
      reporterId: admin.id,
      indexSearch: false,
    });
    createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
    const child = createProject(db, {
      title: 'Child of deleted',
      parentId: parent.id,
      reporterId: admin.id,
      indexSearch: false,
    });
    const eventId = newId();
    db.prepare(
      `INSERT INTO audit_events (id, project_id, actor_id, action, created_at)
       VALUES (?, ?, ?, 'project.created', ?)`,
    ).run(eventId, child.id, admin.id, nowIso());
    // PostgreSQL-style ON DELETE CASCADE cannot be used for a parent whose
    // children reference its statuses (RESTRICT), so deletion is leaf-first.
    db.prepare('DELETE FROM projects WHERE id = ?').run(child.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(parent.id);
    const remaining = db
      .prepare('SELECT COUNT(*) AS count FROM projects WHERE id IN (?, ?)')
      .get(parent.id, child.id) as { count: number };
    expect(remaining.count).toBe(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE project_id = ?').get(child.id),
    ).toEqual({ count: 0 });
  });

  it('restricts deleting a user who still reports projects', async () => {
    const reporter = await createUser(db, { username: 'restricted-reporter' });
    createProject(db, {
      title: 'Reported project',
      parentId: rootId,
      reporterId: reporter.id,
      createdBy: reporter.id,
      indexSearch: false,
    });
    expect(() => db.prepare('DELETE FROM users WHERE id = ?').run(reporter.id)).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });
});

describe('workflow invariants', () => {
  let rootId: string;
  let ownerId: string;

  beforeAll(() => {
    rootId = (
      db.prepare('SELECT id FROM projects WHERE parent_id IS NULL').get() as { id: string }
    ).id;
    ownerId = createProject(db, {
      title: 'Workflow owner',
      parentId: rootId,
      reporterId: admin.id,
      indexSearch: false,
    }).id;
    createWorkflow(db, ownerId, { names: ['To do', 'Done'] });
  });

  it('allows at most one start status per workflow', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
           VALUES (?, ?, 'Second start', 99, 1, 0)`,
        )
        .run(newId(), ownerId),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('allows at most one finish status per workflow', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
           VALUES (?, ?, 'Second finish', 100, 0, 1)`,
        )
        .run(newId(), ownerId),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects duplicate status names and positions within one workflow', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
           VALUES (?, ?, 'To do', 50, 0, 0)`,
        )
        .run(newId(), ownerId),
    ).toThrow(/UNIQUE constraint failed: statuses.parent_id, statuses.name/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
           VALUES (?, ?, 'Blocked', 0, 0, 0)`,
        )
        .run(newId(), ownerId),
    ).toThrow(/UNIQUE constraint failed: statuses.parent_id, statuses.position/);
  });

  it('rejects an empty status name and invalid flag values', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
           VALUES (?, ?, '  ', 101, 0, 0)`,
        )
        .run(newId(), ownerId),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
           VALUES (?, ?, 'Bad flag', 102, 2, 0)`,
        )
        .run(newId(), ownerId),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('audit log is append-only', () => {
  it('rejects UPDATE on audit_events', () => {
    const rootId = (
      db.prepare('SELECT id FROM projects WHERE parent_id IS NULL').get() as { id: string }
    ).id;
    const eventId = newId();
    db.prepare(
      `INSERT INTO audit_events (
         id, project_id, actor_id, action, field, old_value, new_value, target_id, detail, created_at
       ) VALUES (?, ?, ?, 'project.created', NULL, NULL, NULL, NULL, NULL, ?)`,
    ).run(eventId, rootId, admin.id, nowIso());
    expect(() =>
      db.prepare('UPDATE audit_events SET detail = ? WHERE id = ?').run('tampered', eventId),
    ).toThrow(/audit_events is append-only/);
  });
});

describe('users and sessions constraints', () => {
  it('treats usernames as unique case-insensitively', async () => {
    await createUser(db, { username: 'CaseUser' });
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (id, username, email, password_hash, app_role, created_at)
           VALUES (?, 'caseuser', 'other@example.com', 'x', 'user', ?)`,
        )
        .run(newId(), nowIso()),
    ).toThrow(/UNIQUE constraint failed: users.username/);
  });

  it('rejects unknown role and appearance values', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (id, username, email, password_hash, app_role, created_at)
           VALUES (?, 'RoleUser', 'r@example.com', 'x', 'owner', ?)`,
        )
        .run(newId(), nowIso()),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (id, username, email, password_hash, appearance, created_at)
           VALUES (?, 'ThemeUser', 't@example.com', 'x', 'sepia', ?)`,
        )
        .run(newId(), nowIso()),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects duplicate session token hashes', async () => {
    const user = await createUser(db, { username: 'session-user' });
    const expires = new Date(Date.now() + 60_000).toISOString();
    db.prepare(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(newId(), user.id, 'hash-1', expires, nowIso());
    expect(() =>
      db
        .prepare(
          'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(newId(), user.id, 'hash-1', expires, nowIso()),
    ).toThrow(/UNIQUE constraint failed: sessions.token_hash/);
  });

  it('cascades sessions and favorites when a user is deleted', async () => {
    const disposable = await createUser(db, { username: 'disposable' });
    const rootId = (
      db.prepare('SELECT id FROM projects WHERE parent_id IS NULL').get() as { id: string }
    ).id;
    db.prepare(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(newId(), disposable.id, 'disposable-hash', nowIso(), nowIso());
    db.prepare('INSERT INTO favorites (user_id, project_id) VALUES (?, ?)').run(
      disposable.id,
      rootId,
    );
    db.prepare('DELETE FROM users WHERE id = ?').run(disposable.id);
    const sessions = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .get(disposable.id) as { count: number };
    const favorites = db
      .prepare('SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?')
      .get(disposable.id) as { count: number };
    expect(sessions.count).toBe(0);
    expect(favorites.count).toBe(0);
  });
});

describe('project_roles constraints', () => {
  it('keeps one role per user per project and validates the role', async () => {
    const rootId = (
      db.prepare('SELECT id FROM projects WHERE parent_id IS NULL').get() as { id: string }
    ).id;
    const user = await createUser(db, { username: 'role-user' });
    db.prepare('INSERT INTO project_roles (project_id, user_id, role) VALUES (?, ?, ?)').run(
      rootId,
      user.id,
      'viewer',
    );
    expect(() =>
      db
        .prepare('INSERT INTO project_roles (project_id, user_id, role) VALUES (?, ?, ?)')
        .run(rootId, user.id, 'admin'),
    ).toThrow(/UNIQUE constraint failed/);
    const badRoleUser = await createUser(db, { username: 'bad-role' });
    expect(() =>
      db
        .prepare('INSERT INTO project_roles (project_id, user_id, role) VALUES (?, ?, ?)')
        .run(rootId, badRoleUser.id, 'owner'),
    ).toThrow(/CHECK constraint failed/);
  });
});
