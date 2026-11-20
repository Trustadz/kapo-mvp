import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/server/db/migrate';

const SOURCE_MIGRATIONS = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');
const workDir = fs.mkdtempSync(path.join(process.cwd(), 'data', 'migration-workflows-'));
const migrationsDir = path.join(workDir, 'migrations');
const databasePath = path.join(workDir, 'legacy.db');
fs.mkdirSync(migrationsDir);
fs.copyFileSync(
  path.join(SOURCE_MIGRATIONS, '001_init.sql'),
  path.join(migrationsDir, '001_init.sql'),
);

/**
 * 0002 backfills the child workflow for projects that predate the invariant.
 * A leaf project with no statuses must be able to receive a child immediately.
 */
describe('002 project workflow backfill', () => {
  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('adds the default To do / Done workflow to a leaf project with no statuses', () => {
    const db = new Database(databasePath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrationsDir);

    const now = '2026-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, app_role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('u1', 'legacy', 'legacy@example.com', 'x', 'admin', now);

    db.prepare(
      `INSERT INTO projects (
         id, seq, title, reporter_id, parent_id, status_id, priority, inbox, archived,
         addon_data, settings, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('root', 1, 'Root', 'u1', null, null, 0, 0, 0, '{}', '{}', 'u1', now, now);

    const insertStatus = db.prepare(
      `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertStatus.run('root-start', 'root', 'To do', 0, 1, 0);
    insertStatus.run('root-done', 'root', 'Done', 1, 0, 1);

    // The leaf has a valid status of its own (from Root) but no child workflow.
    db.prepare(
      `INSERT INTO projects (
         id, seq, title, reporter_id, parent_id, status_id, priority, inbox, archived,
         addon_data, settings, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('leaf', 2, 'Legacy leaf', 'u1', 'root', 'root-start', 0, 1, 0, '{}', '{}', 'u1', now, now);

    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM statuses WHERE parent_id = ?').get('leaf') as {
        count: number;
      }).count,
    ).toBe(0);

    fs.copyFileSync(
      path.join(SOURCE_MIGRATIONS, '002_backfill_project_workflows.sql'),
      path.join(migrationsDir, '002_backfill_project_workflows.sql'),
    );
    const result = runMigrations(db, migrationsDir);
    expect(result.applied).toEqual(['002_backfill_project_workflows.sql']);

    const leafWorkflow = db
      .prepare(
        'SELECT name, position, is_start, is_finish FROM statuses WHERE parent_id = ? ORDER BY position',
      )
      .all('leaf');
    expect(leafWorkflow).toEqual([
      { name: 'To do', position: 0, is_start: 1, is_finish: 0 },
      { name: 'Done', position: 1, is_start: 0, is_finish: 1 },
    ]);

    // A project that already has a workflow is untouched.
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM statuses WHERE parent_id = ?').get('root') as {
        count: number;
      }).count,
    ).toBe(2);

    db.close();
  });
});
