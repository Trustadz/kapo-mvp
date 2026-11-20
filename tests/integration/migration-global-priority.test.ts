import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/server/db/migrate';

const SOURCE_MIGRATIONS = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');
const workDir = fs.mkdtempSync(path.join(process.cwd(), 'data', 'migration-global-priority-'));
const migrationsDir = path.join(workDir, 'migrations');
const databasePath = path.join(workDir, 'legacy.db');
fs.mkdirSync(migrationsDir);
fs.copyFileSync(
  path.join(SOURCE_MIGRATIONS, '001_init.sql'),
  path.join(migrationsDir, '001_init.sql'),
);

const NOW = '2026-01-01T00:00:00.000Z';

interface LegacyProject {
  id: string;
  seq: number;
  title: string;
  parentId: string | null;
  priority: number;
}

/** The documented seed tree, but with the old per-parent priority values. */
const LEGACY_PROJECTS: LegacyProject[] = [
  { id: 'root', seq: 1, title: 'Root', parentId: null, priority: 0 },
  { id: 'home', seq: 2, title: 'Home improvement', parentId: 'root', priority: 0 },
  { id: 'renovate', seq: 3, title: 'Renovate basement', parentId: 'home', priority: 0 },
  { id: 'paint', seq: 4, title: 'Paint hallway', parentId: 'home', priority: 1 },
  { id: 'household', seq: 5, title: 'Household', parentId: 'root', priority: 1 },
  { id: 'porch', seq: 6, title: 'Paint porch', parentId: 'household', priority: 0 },
  { id: 'boiler', seq: 7, title: 'Book boiler service', parentId: 'household', priority: 1 },
  { id: 'personal', seq: 8, title: 'Personal', parentId: 'root', priority: 2 },
];

/**
 * 003 turns the old per-parent `priority` values into one app-wide sequence
 * (issue #53): every project gets a unique 0..N-1 position, and each parent's
 * current child order is preserved.
 */
describe('003 global project priority', () => {
  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('renumbers a legacy per-parent database into one global 0..N-1 sequence', () => {
    const db = new Database(databasePath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrationsDir);

    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, app_role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('u1', 'legacy', 'legacy@example.com', 'x', 'admin', NOW);

    const insertStatus = db.prepare(
      `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const insertProject = db.prepare(
      `INSERT INTO projects (
         id, seq, title, reporter_id, parent_id, status_id, priority, inbox, archived,
         addon_data, settings, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, 'u1', ?, ?, ?, 0, 0, '{}', '{}', 'u1', ?, ?)`,
    );
    const insertLegacyProject = (project: LegacyProject): void => {
      insertProject.run(
        project.id,
        project.seq,
        project.title,
        project.parentId,
        project.parentId ? 'root-start' : null,
        project.priority,
        NOW,
        NOW,
      );
    };

    // Root must exist before its workflow, and the children need that status.
    insertLegacyProject(LEGACY_PROJECTS[0]!);
    insertStatus.run('root-start', 'root', 'To do', 0, 1, 0);
    insertStatus.run('root-done', 'root', 'Done', 1, 0, 1);
    for (const project of LEGACY_PROJECTS.slice(1)) insertLegacyProject(project);

    // Sanity check: legacy values repeat across parents.
    expect(
      (
        db
          .prepare('SELECT COUNT(DISTINCT priority) AS count FROM projects')
          .get() as { count: number }
      ).count,
    ).toBeLessThan(LEGACY_PROJECTS.length);

    fs.copyFileSync(
      path.join(SOURCE_MIGRATIONS, '003_global_project_priority.sql'),
      path.join(migrationsDir, '003_global_project_priority.sql'),
    );
    const result = runMigrations(db, migrationsDir);
    expect(result.applied).toEqual(['003_global_project_priority.sql']);

    const rows = db
      .prepare('SELECT id, parent_id, priority FROM projects ORDER BY priority ASC')
      .all() as Array<{ id: string; parent_id: string | null; priority: number }>;
    // Global order: old priority ASC, then seq ASC.
    expect(rows.map((row) => row.id)).toEqual([
      'root',
      'home',
      'renovate',
      'porch',
      'paint',
      'household',
      'boiler',
      'personal',
    ]);
    expect(rows.map((row) => row.priority)).toEqual(
      LEGACY_PROJECTS.map((_, index) => index),
    );

    // Each parent's child order is the global order restricted to its children,
    // and still matches the old within-parent priority order.
    const byId = new Map(rows.map((row) => [row.id, row]));
    const childOrder = (parentId: string): number[] =>
      rows.filter((row) => row.parent_id === parentId).map((row) => row.priority);
    expect(childOrder('root')).toEqual([1, 5, 7]);
    expect(childOrder('home')).toEqual([2, 4]);
    expect(childOrder('household')).toEqual([3, 6]);
    for (const parentId of ['root', 'home', 'household']) {
      const original = LEGACY_PROJECTS.filter((project) => project.parentId === parentId)
        .sort((a, b) => a.priority - b.priority || a.seq - b.seq)
        .map((project) => byId.get(project.id)!.priority);
      expect(childOrder(parentId)).toEqual(original);
    }

    db.close();
  });

  it('is a no-op on a fresh database', () => {
    const freshPath = path.join(workDir, 'fresh.db');
    const db = new Database(freshPath);
    db.pragma('foreign_keys = ON');
    const result = runMigrations(db, SOURCE_MIGRATIONS);
    expect(result.applied).toContain('003_global_project_priority.sql');
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }).count,
    ).toBe(0);
    db.close();
  });
});
