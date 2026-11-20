import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup, listBackups } from '@/server/backup/service';
import { insertDefaultSettings } from '@/server/db/bootstrap';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import { createUser, type FixtureUser } from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, request, signIn, signOut } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';

/**
 * Rolling backups (issue #13): consistent DB snapshot + uploads, retention,
 * and the Admin-only backup settings exposed by /api/settings.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const settingsRoute = await import('@/app/api/settings/route');
const settingsGet = () => settingsRoute.GET(request('/api/settings'), EMPTY_CONTEXT);
const settingsPut = (req: Request) => settingsRoute.PUT(req, EMPTY_CONTEXT);

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;
let regular: FixtureUser;
let viewer: FixtureUser;

const backupDirs: string[] = [];

function scratchBackupDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'data', `backup-it-${label}-`));
  backupDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'backup' });
  db = test.db;
  insertDefaultSettings(db);
  admin = await createUser(db, { username: 'backup-admin', appRole: 'admin' });
  regular = await createUser(db, { username: 'backup-user', appRole: 'user' });
  viewer = await createUser(db, { username: 'backup-viewer', appRole: 'viewer' });
  fs.writeFileSync(path.join(test.uploadDir, 'avatar-admin.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.mkdirSync(path.join(test.uploadDir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(test.uploadDir, 'nested', 'note.txt'), 'uploads copy');
});

beforeEach(() => {
  resetRequestContext();
  signIn(db, admin.id);
});

afterAll(() => {
  test.cleanup();
  for (const dir of backupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('createBackup', () => {
  it('writes a consistent database snapshot and copies uploads', async () => {
    const backupDir = scratchBackupDir('consistent');
    const result = await createBackup({
      db,
      databaseFile: test.filename,
      uploadsDir: test.uploadDir,
      backupDir,
      retention: 3,
      now: new Date(2026, 0, 2, 2, 0, 0),
    });

    expect(result.name).toBe('kapo-20260102-020000');
    expect(result.uploadsIncluded).toBe(true);
    expect(fs.existsSync(path.join(result.path, 'kapo.db'))).toBe(true);
    expect(fs.existsSync(path.join(result.path, 'kapo.db-wal'))).toBe(false);
    expect(fs.readFileSync(path.join(result.path, 'uploads', 'avatar-admin.png'))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(
      fs.readFileSync(path.join(result.path, 'uploads', 'nested', 'note.txt'), 'utf8'),
    ).toBe('uploads copy');

    // Restore verification: open the backup with better-sqlite3 and read a
    // known row without touching the live database.
    const restored = new Database(path.join(result.path, 'kapo.db'), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(
        restored.prepare('SELECT username, app_role FROM users WHERE id = ?').get(admin.id),
      ).toEqual({ username: 'backup-admin', app_role: 'admin' });
      expect(restored.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({
        count: 0,
      });
    } finally {
      restored.close();
    }
  });

  it('succeeds when the uploads directory does not exist', async () => {
    const backupDir = scratchBackupDir('no-uploads');
    const result = await createBackup({
      db,
      uploadsDir: path.join(backupDir, 'missing-uploads'),
      backupDir,
      retention: 3,
      now: new Date(2026, 0, 2, 3, 0, 0),
    });

    expect(result.uploadsIncluded).toBe(false);
    expect(fs.existsSync(path.join(result.path, 'uploads'))).toBe(false);
  });

  it('prunes the oldest backups to the configured retention', async () => {
    const backupDir = scratchBackupDir('retention');
    for (let second = 0; second < 4; second += 1) {
      await createBackup({
        db,
        uploadsDir: test.uploadDir,
        backupDir,
        retention: 3,
        now: new Date(2026, 0, 2, 2, 0, second),
      });
    }

    const names = listBackups(backupDir).map((backup) => backup.name);
    expect(names).toEqual([
      'kapo-20260102-020003',
      'kapo-20260102-020002',
      'kapo-20260102-020001',
    ]);
    expect(fs.existsSync(path.join(backupDir, 'kapo-20260102-020000'))).toBe(false);
  });

  it('removes its temporary folder when the database snapshot fails', async () => {
    const backupDir = scratchBackupDir('failure');
    const failingDb = {
      backup: async () => {
        throw new Error('snapshot failed');
      },
    } as unknown as BetterSqliteDatabase;

    await expect(
      createBackup({
        db: failingDb,
        uploadsDir: test.uploadDir,
        backupDir,
        retention: 3,
      }),
    ).rejects.toThrow('snapshot failed');

    expect(fs.readdirSync(backupDir)).toEqual([]);
  });
});

describe('GET/PUT /api/settings backup fields', () => {
  it('is Admin only for reads and writes', async () => {
    for (const actor of [regular, viewer]) {
      signIn(db, actor.id);
      expect((await settingsGet()).status).toBe(403);
      expect(
        (
          await settingsPut(
            request('/api/settings', {
              method: 'PUT',
              body: { backupRetention: 5 },
            }),
          )
        ).status,
      ).toBe(403);
    }
  });

  it('returns the backup defaults and persists a valid update', async () => {
    const initial = await settingsGet();
    const initialPayload = await json<{
      settings: { backupEnabled: boolean; backupStartTime: string; backupRetention: number };
    }>(initial);
    expect(initialPayload.settings).toMatchObject({
      backupEnabled: true,
      backupStartTime: '02:00',
      backupRetention: 3,
    });

    const updated = await settingsPut(
      request('/api/settings', {
        method: 'PUT',
        body: { backupEnabled: false, backupStartTime: '03:30', backupRetention: 7 },
      }),
    );
    expect(updated.status).toBe(200);
    const updatedPayload = await json<{
      settings: { backupEnabled: boolean; backupStartTime: string; backupRetention: number };
    }>(updated);
    expect(updatedPayload.settings).toMatchObject({
      backupEnabled: false,
      backupStartTime: '03:30',
      backupRetention: 7,
    });

    // Restore defaults for the remaining tests in this file.
    await settingsPut(
      request('/api/settings', {
        method: 'PUT',
        body: { backupEnabled: true, backupStartTime: '02:00', backupRetention: 3 },
      }),
    );
  });

  it('rejects invalid backup settings with field errors', async () => {
    const badRetention = await settingsPut(
      request('/api/settings', {
        method: 'PUT',
        body: { backupRetention: 0 },
      }),
    );
    expect(badRetention.status).toBe(422);
    const retentionPayload = await json<{ error: { fields: Record<string, string> } }>(
      badRetention,
    );
    expect(retentionPayload.error.fields.backupRetention).toMatch(/1 and 30/);

    const badTime = await settingsPut(
      request('/api/settings', {
        method: 'PUT',
        body: { backupStartTime: '25:00' },
      }),
    );
    expect(badTime.status).toBe(422);
    const timePayload = await json<{ error: { fields: Record<string, string> } }>(badTime);
    expect(timePayload.error.fields.backupStartTime).toMatch(/00:00 and 23:59/);

    const badEnabled = await settingsPut(
      request('/api/settings', {
        method: 'PUT',
        body: { backupEnabled: 'yes' },
      }),
    );
    expect(badEnabled.status).toBe(422);
    const enabledPayload = await json<{ error: { fields: Record<string, string> } }>(badEnabled);
    expect(enabledPayload.error.fields.backupEnabled).toBeDefined();
  });
});
