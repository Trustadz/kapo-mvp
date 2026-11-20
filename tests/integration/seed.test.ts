import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, resetSingleton } from '@/server/db';
import { verifyPassword } from '@/server/auth/password';
import { createTestDatabase, type TestDatabase } from '../helpers/db';

/**
 * `npm run db:seed` into a temp database (build-spec §10).
 *
 * The script runs as a child process with DATABASE_PATH pointed at a throwaway
 * file, so ./data/kapo.db is never touched. Documented mock data: 4 users,
 * 13 projects, Root workflow To do/In progress/Done, Home improvement = KAP-104,
 * three Inbox projects, tristan's three favorites and 15 activity events.
 */

let test: TestDatabase;
let childOutput = '';

function runSeed(databasePath: string): void {
  childOutput = execFileSync('npm', ['run', 'db:seed'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

describe('db:seed', () => {
  beforeAll(() => {
    test = createTestDatabase({ label: 'seed' });
    // The harness opens the file; close it so the seed script is the only
    // writer, then reopen after the run.
    test.db.close();
    resetSingleton();
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${test.filename}${suffix}`, { force: true });
    }
  });

  afterAll(() => {
    test.cleanup();
  });

  it('seeds the documented mock household into a temp database', async () => {
    runSeed(test.filename);
    expect(childOutput).toMatch(/Kapo seed complete/);
    expect(childOutput).toContain('4 users');

    const db = openDatabase({ filename: test.filename, fresh: true });

    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

    expect(count('users')).toBe(4);
    expect(count('projects')).toBe(13);
    expect(count('statuses')).toBe(28);
    // Every project owns a child workflow, including leaves that have no
    // children yet, so any project can receive a child immediately.
    const projectsWithoutWorkflow = db
      .prepare(
        `SELECT p.title AS title FROM projects p
          WHERE NOT EXISTS (SELECT 1 FROM statuses s WHERE s.parent_id = p.id)`,
      )
      .all() as Array<{ title: string }>;
    expect(projectsWithoutWorkflow).toEqual([]);
    expect(count('favorites')).toBe(3);
    expect(count('audit_events')).toBe(15);
    expect(count('project_search')).toBe(13);

    // Accounts and roles.
    const users = db
      .prepare('SELECT username, app_role FROM users ORDER BY username')
      .all() as Array<{ username: string; app_role: string }>;
    expect(users).toEqual([
      { username: 'alex', app_role: 'viewer' },
      { username: 'jules', app_role: 'user' },
      { username: 'maya', app_role: 'user' },
      { username: 'tristan', app_role: 'admin' },
    ]);

    // One Root, no parent/status, and its documented workflow.
    const roots = db
      .prepare('SELECT id, title, seq, parent_id, status_id FROM projects WHERE parent_id IS NULL')
      .all() as Array<{ id: string; title: string; seq: number; parent_id: null; status_id: null }>;
    expect(roots).toHaveLength(1);
    expect(roots[0]?.title).toBe('Root');
    const rootWorkflow = db
      .prepare(
        'SELECT name, position, is_start, is_finish FROM statuses WHERE parent_id = ? ORDER BY position',
      )
      .all(roots[0]!.id) as Array<{
      name: string;
      position: number;
      is_start: number;
      is_finish: number;
    }>;
    expect(rootWorkflow).toEqual([
      { name: 'To do', position: 0, is_start: 1, is_finish: 0 },
      { name: 'In progress', position: 1, is_start: 0, is_finish: 0 },
      { name: 'Done', position: 2, is_start: 0, is_finish: 1 },
    ]);

    // KAP-104 is the reference project page (Home improvement).
    const home = db
      .prepare('SELECT seq, title FROM projects WHERE title = ?')
      .get('Home improvement') as { seq: number; title: string } | undefined;
    expect(home?.seq).toBe(104);
    expect(`KAP-${home!.seq}`).toBe('KAP-104');

    // The documented tree.
    const parentByTitle = new Map(
      (
        db
          .prepare(
            `SELECT child.title AS title, parent.title AS parent_title
               FROM projects child JOIN projects parent ON parent.id = child.parent_id`,
          )
          .all() as Array<{ title: string; parent_title: string }>
      ).map((row) => [row.title, row.parent_title]),
    );
    expect(Object.fromEntries(parentByTitle)).toMatchObject({
      'Home improvement': 'Root',
      'Renovate basement': 'Home improvement',
      'Find contractor': 'Renovate basement',
      'Paint hallway': 'Home improvement',
      'Install hall shelf': 'Home improvement',
      'Garden beds': 'Home improvement',
      'Fix kitchen tap': 'Home improvement',
      'Household': 'Root',
      'Paint porch': 'Household',
      'Book boiler service': 'Household',
      'Personal': 'Root',
      'Plan weekend trip': 'Personal',
    });

    // Inbox: Book boiler service, Plan weekend trip, Renovate basement.
    const inbox = db
      .prepare("SELECT title FROM projects WHERE inbox = 1 AND trashed_at IS NULL ORDER BY title")
      .all() as Array<{ title: string }>;
    expect(inbox.map((row) => row.title)).toEqual([
      'Book boiler service',
      'Plan weekend trip',
      'Renovate basement',
    ]);

    // Favorites: Home improvement, Household, Personal for tristan.
    const favorites = db
      .prepare(
        `SELECT p.title AS title FROM favorites f
           JOIN projects p ON p.id = f.project_id
           JOIN users u ON u.id = f.user_id
          WHERE u.username = 'tristan' ORDER BY p.title`,
      )
      .all() as Array<{ title: string }>;
    expect(favorites.map((row) => row.title)).toEqual([
      'Home improvement',
      'Household',
      'Personal',
    ]);

    // Every seeded password is kapo1234.
    const hashes = db.prepare('SELECT password_hash FROM users').all() as Array<{
      password_hash: string;
    }>;
    const verifications = await Promise.all(
      hashes.map((row) => verifyPassword('kapo1234', row.password_hash)),
    );
    expect(verifications).toEqual([true, true, true, true]);
    for (const row of hashes) expect(row.password_hash.startsWith('scrypt$')).toBe(true);

    // FTS is populated and searchable.
    const hits = db
      .prepare("SELECT title FROM project_search WHERE project_search MATCH 'basement'")
      .all() as Array<{ title: string }>;
    expect(hits.map((row) => row.title)).toEqual(['Renovate basement']);

    db.close();
  });

  it('is idempotent: re-running replaces rather than duplicates data', () => {
    runSeed(test.filename);
    const db = openDatabase({ filename: test.filename, fresh: true });
    const projects = db.prepare('SELECT COUNT(*) AS count FROM projects').get() as {
      count: number;
    };
    const users = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    expect(users.count).toBe(4);
    expect(projects.count).toBe(13);
    db.close();
  });
});
