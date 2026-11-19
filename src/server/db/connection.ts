import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { databasePath } from './paths';
import { runMigrations } from './migrate';

/**
 * Singleton SQLite connection.
 *
 * WAL keeps concurrent reads fast, foreign keys are enforced for every
 * connection, and migrations run once before the connection is handed out.
 */

interface GlobalWithDb {
  __kapoDb?: BetterSqliteDatabase;
}

const globalWithDb = globalThis as unknown as GlobalWithDb;

export function configureConnection(db: BetterSqliteDatabase): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
}

export interface OpenDatabaseOptions {
  /** Path to the database file; defaults to DATABASE_PATH or ./data/kapo.db. */
  filename?: string;
  /** Run pending migrations before returning (default true). */
  migrate?: boolean;
  /** Skip the singleton cache and return a fresh connection (scripts/tests). */
  fresh?: boolean;
}

export function openDatabase(options: OpenDatabaseOptions = {}): BetterSqliteDatabase {
  const filename = options.filename ?? databasePath();
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  configureConnection(db);
  if (options.migrate !== false) {
    runMigrations(db);
  }
  return db;
}

export function getDb(): BetterSqliteDatabase {
  if (globalWithDb.__kapoDb?.open) return globalWithDb.__kapoDb;
  const db = openDatabase();
  globalWithDb.__kapoDb = db;
  return db;
}

export function closeDb(): void {
  const db = globalWithDb.__kapoDb;
  if (db?.open) db.close();
  delete globalWithDb.__kapoDb;
}

/** Used by scripts after replacing the database file on disk. */
export function resetSingleton(): void {
  delete globalWithDb.__kapoDb;
}

export type { BetterSqliteDatabase };
