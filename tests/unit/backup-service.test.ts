import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backupDirPath,
  listBackups,
  pruneBackups,
  resolveBackupDir,
} from '@/server/backup/service';

/** Rolling backup pruning/destination unit tests (issue #13). */

const scratchDirs: string[] = [];

function scratchDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'data', `backup-unit-${label}-`));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.KAPO_BACKUP_DIR;
});

describe('pruneBackups', () => {
  it('keeps the newest N backups and removes only recognised names', () => {
    const dir = scratchDir('prune');
    for (const name of [
      'kapo-20260101-020000',
      'kapo-20260102-020000',
      'kapo-20260103-020000',
      'kapo-20260104-020000',
      'kapo-20260105-020000',
    ]) {
      fs.mkdirSync(path.join(dir, name));
    }
    fs.mkdirSync(path.join(dir, 'keep-me'));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'operator notes');
    fs.mkdirSync(path.join(dir, '.tmp-kapo-interrupted'));

    const removed = pruneBackups(dir, 3);

    expect(removed.sort()).toEqual(['kapo-20260101-020000', 'kapo-20260102-020000']);
    expect(listBackups(dir).map((backup) => backup.name)).toEqual([
      'kapo-20260105-020000',
      'kapo-20260104-020000',
      'kapo-20260103-020000',
    ]);
    expect(fs.existsSync(path.join(dir, 'keep-me'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.tmp-kapo-interrupted'))).toBe(true);
  });

  it('treats a retention below one as one', () => {
    const dir = scratchDir('clamp');
    fs.mkdirSync(path.join(dir, 'kapo-20260101-020000'));
    fs.mkdirSync(path.join(dir, 'kapo-20260102-020000'));

    expect(pruneBackups(dir, 0)).toEqual(['kapo-20260101-020000']);
    expect(listBackups(dir).map((backup) => backup.name)).toEqual(['kapo-20260102-020000']);
  });
});

describe('listBackups', () => {
  it('returns newest first and ignores unrelated entries', () => {
    const dir = scratchDir('list');
    fs.mkdirSync(path.join(dir, 'kapo-20260101-020000'));
    fs.mkdirSync(path.join(dir, 'kapo-20260103-020000'));
    fs.mkdirSync(path.join(dir, 'kapo-20260102-020000'));
    fs.mkdirSync(path.join(dir, '.tmp-kapo-running'));

    const names = listBackups(dir).map((backup) => backup.name);
    expect(names).toEqual([
      'kapo-20260103-020000',
      'kapo-20260102-020000',
      'kapo-20260101-020000',
    ]);
  });

  it('returns an empty list for a missing destination', () => {
    expect(listBackups(path.join(scratchDir('missing'), 'absent'))).toEqual([]);
  });
});

describe('backup destination', () => {
  it('honours KAPO_BACKUP_DIR and creates it on demand', () => {
    const parent = scratchDir('destination');
    const configured = path.join(parent, 'nested', 'backups');
    process.env.KAPO_BACKUP_DIR = configured;

    expect(backupDirPath()).toBe(configured);
    expect(fs.existsSync(configured)).toBe(false);
    expect(resolveBackupDir()).toBe(configured);
    expect(fs.statSync(configured).isDirectory()).toBe(true);
  });

  it('resolves a relative KAPO_BACKUP_DIR against the working directory', () => {
    const relative = path.join('data', 'backup-relative-test');
    process.env.KAPO_BACKUP_DIR = relative;
    expect(backupDirPath()).toBe(path.resolve(process.cwd(), relative));
  });
});
