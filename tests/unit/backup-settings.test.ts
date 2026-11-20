import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getApplicationSettings,
  SettingsError,
  updateApplicationSettings,
} from '@/server/domain/settings';

/** Backup settings defaults/validation unit tests (issue #13). */

const databases: BetterSqliteDatabase[] = [];

function memoryDb(): BetterSqliteDatabase {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  databases.push(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function expectSettingsError(run: () => unknown): SettingsError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SettingsError);
    return error as SettingsError;
  }
  throw new Error('Expected a SettingsError to be thrown.');
}

describe('backup settings defaults', () => {
  it('defaults to enabled, 02:00 local, retention 3', () => {
    const settings = getApplicationSettings(memoryDb());
    expect(settings.backupEnabled).toBe(true);
    expect(settings.backupStartTime).toBe('02:00');
    expect(settings.backupRetention).toBe(3);
  });

  it('normalises corrupt stored values back to the defaults', () => {
    const db = memoryDb();
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run('backup_enabled', 'perhaps');
    insert.run('backup_start_time', '99:99');
    insert.run('backup_retention', '999');

    const settings = getApplicationSettings(db);
    expect(settings.backupEnabled).toBe(true);
    expect(settings.backupStartTime).toBe('02:00');
    expect(settings.backupRetention).toBe(3);
  });
});

describe('updateApplicationSettings backup validation', () => {
  it('persists a valid enabled/time/retention update', () => {
    const db = memoryDb();
    const settings = updateApplicationSettings(db, {
      backupEnabled: false,
      backupStartTime: '03:30',
      backupRetention: 7,
    });
    expect(settings.backupEnabled).toBe(false);
    expect(settings.backupStartTime).toBe('03:30');
    expect(settings.backupRetention).toBe(7);
  });

  it('rejects retention outside 1–30 and non-integers', () => {
    const db = memoryDb();
    for (const value of [0, 31, -1, 2.5]) {
      const error = expectSettingsError(() =>
        updateApplicationSettings(db, { backupRetention: value }),
      );
      expect(error.status).toBe(422);
      expect(error.fields?.backupRetention).toMatch(/1 and 30/);
    }
  });

  it('rejects malformed start times', () => {
    const db = memoryDb();
    for (const value of ['24:00', '2:00', '02:60', '02:00:00', '', 1200]) {
      const error = expectSettingsError(() =>
        updateApplicationSettings(db, { backupStartTime: value }),
      );
      expect(error.status).toBe(422);
      expect(error.fields?.backupStartTime).toMatch(/00:00 and 23:59/);
    }
  });

  it('rejects a non-boolean enabled value', () => {
    const db = memoryDb();
    const error = expectSettingsError(() =>
      updateApplicationSettings(db, { backupEnabled: 'yes' }),
    );
    expect(error.status).toBe(422);
    expect(error.fields?.backupEnabled).toBeDefined();
  });
});
