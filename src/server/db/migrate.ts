import fs from 'node:fs';
import path from 'node:path';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { migrationsDir } from './paths';
import { nowIso } from './util';

/**
 * Minimal forward-only migration runner.
 *
 * Applied migrations are recorded in schema_migrations and each file runs in
 * its own transaction, so a failed migration leaves the database untouched.
 */

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  current: string[];
}

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  );
`;

export function loadMigrations(directory: string = migrationsDir()): MigrationFile[] {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return entries.map((name) => ({
    name,
    sql: fs.readFileSync(/* turbopackIgnore: true */ path.join(directory, name), 'utf8'),
  }));
}

export function currentMigrationNames(db: BetterSqliteDatabase): string[] {
  db.exec(CREATE_MIGRATIONS_TABLE);
  const rows = db
    .prepare('SELECT name FROM schema_migrations ORDER BY id ASC')
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

export function runMigrations(
  db: BetterSqliteDatabase,
  directory: string = migrationsDir(),
): MigrationResult {
  const migrations = loadMigrations(directory);
  db.exec(CREATE_MIGRATIONS_TABLE);
  const appliedRows = db
    .prepare('SELECT name FROM schema_migrations')
    .all() as Array<{ name: string }>;
  const applied = new Set(appliedRows.map((row) => row.name));

  const record = db.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  );
  const appliedNow: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.name, nowIso());
    });
    apply();
    appliedNow.push(migration.name);
  }

  return {
    applied: appliedNow,
    current: currentMigrationNames(db),
  };
}
