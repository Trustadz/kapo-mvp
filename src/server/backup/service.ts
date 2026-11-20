import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  DEFAULT_BACKUP_RETENTION,
  MAX_BACKUP_RETENTION,
  MIN_BACKUP_RETENTION,
} from '@/server/db/bootstrap';
import { getDb } from '@/server/db/connection';
import { databasePath, uploadDir } from '@/server/db/paths';

/**
 * Rolling backup service (issue #13).
 *
 * A backup is a timestamped folder containing a consistent SQLite snapshot and
 * a copy of the uploads directory:
 *
 *   <backup-dir>/kapo-YYYYMMDD-HHMMSS/kapo.db
 *   <backup-dir>/kapo-YYYYMMDD-HHMMSS/uploads/...
 *
 * The database is captured with better-sqlite3's online backup API rather than
 * copying the live WAL file; the destination is then switched to rollback
 * journal mode so the snapshot is a self-contained single file. Everything is
 * written to a temporary folder first and renamed into place only after the
 * database and uploads are complete, so an interrupted run never looks like a
 * valid backup. Retention pruning removes only folders matching the backup
 * naming scheme, never arbitrary content of the destination directory.
 */

const SYSTEM_BACKUP_DIR = '/backup';
const TEMP_PREFIX = '.tmp-kapo-';
const BACKUP_NAME_PATTERN = /^kapo-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?$/;

export const MIN_RETAINED_BACKUPS = MIN_BACKUP_RETENTION;

export interface BackupSummary {
  name: string;
  path: string;
  /** Local creation time derived from the folder name. */
  createdAt: string;
}

export interface BackupResult extends BackupSummary {
  databaseFile: string;
  databaseBytes: number;
  uploadsIncluded: boolean;
  pruned: string[];
}

export interface CreateBackupOptions {
  /** Source connection; defaults to the application singleton. */
  db?: BetterSqliteDatabase;
  /** Source database file (only used for error reporting). */
  databaseFile?: string;
  /** Uploads directory; defaults to UPLOAD_DIR. */
  uploadsDir?: string;
  /** Destination directory; defaults to KAPO_BACKUP_DIR / /backup. */
  backupDir?: string;
  /** Number of backups to keep after a successful run. */
  retention?: number;
  /** Clock override for tests and deterministic names. */
  now?: Date;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `kapo-YYYYMMDD-HHMMSS` in the server's local timezone. */
export function formatBackupName(date: Date): string {
  return [
    'kapo-',
    String(date.getFullYear()).padStart(4, '0'),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function parseBackupName(name: string): Date | null {
  const match = BACKUP_NAME_PATTERN.exec(name);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function isUsableDirectory(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function configuredBackupDir(): string | null {
  const configured = process.env.KAPO_BACKUP_DIR?.trim();
  if (!configured) return null;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/**
 * Pure destination resolution (no filesystem writes), for status displays.
 *
 * Docker sets KAPO_BACKUP_DIR=/backup and mounts the backup volume there. A
 * development checkout falls back to ./data/backups only when /backup is not a
 * writable directory. In production, an explicitly configured destination is
 * always used as-is; we never silently write somewhere else.
 */
export function backupDirPath(): string {
  const configured = configuredBackupDir();
  if (configured) return configured;
  if (isUsableDirectory(SYSTEM_BACKUP_DIR)) return SYSTEM_BACKUP_DIR;
  if (process.env.NODE_ENV === 'production') return SYSTEM_BACKUP_DIR;
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), 'data', 'backups');
}

/** Resolves the destination and creates it if necessary (throws when unusable). */
export function resolveBackupDir(): string {
  const dir = backupDirPath();
  try {
    fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new Error(
      `Backup destination is not writable: ${dir}. Set KAPO_BACKUP_DIR to a writable directory.`,
    );
  }
  return dir;
}

function uniqueBackupName(dir: string, date: Date): string {
  const base = formatBackupName(date);
  if (!fs.existsSync(path.join(dir, base))) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  throw new Error(`Could not allocate a unique backup name for ${base}.`);
}

/**
 * Converts the online-backup destination into a self-contained rollback-journal
 * database. This checkpoints/removes any WAL sidecars so restoring a backup only
 * needs the single `kapo.db` file.
 */
function finalizeBackupDatabase(file: string): void {
  const db = new Database(file);
  try {
    db.pragma('journal_mode = DELETE');
  } finally {
    db.close();
  }
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
}

/** Newest-first list of recognised backup folders (never temp folders). */
export function listBackups(dir: string = backupDirPath()): BackupSummary[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const backups: BackupSummary[] = [];
  for (const entry of entries) {
    if (!BACKUP_NAME_PATTERN.test(entry.name)) continue;
    const createdAt = parseBackupName(entry.name);
    if (!createdAt) continue;
    backups.push({
      name: entry.name,
      path: path.join(dir, entry.name),
      createdAt: createdAt.toISOString(),
    });
  }
  backups.sort((a, b) => b.name.localeCompare(a.name));
  return backups;
}

/**
 * Removes all but the newest `keep` backup folders and returns their names.
 * Only names produced by {@link formatBackupName} are touched.
 */
export function pruneBackups(dir: string, keep: number): string[] {
  const limit = Math.max(MIN_RETAINED_BACKUPS, Math.trunc(keep) || MIN_RETAINED_BACKUPS);
  const names = fs
    .readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true })
    .filter((entry) => BACKUP_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  const removed = names.slice(limit);
  for (const name of removed) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  return removed;
}

/**
 * Captures one backup and prunes old ones. Throws (after cleaning the temporary
 * folder) when the database snapshot or uploads copy fails.
 */
export async function createBackup(options: CreateBackupOptions = {}): Promise<BackupResult> {
  const destination = options.backupDir ?? resolveBackupDir();
  fs.mkdirSync(/* turbopackIgnore: true */ destination, { recursive: true });
  const retention = Math.min(
    Math.max(
      Math.trunc(options.retention ?? DEFAULT_BACKUP_RETENTION) || MIN_RETAINED_BACKUPS,
      MIN_RETAINED_BACKUPS,
    ),
    MAX_BACKUP_RETENTION,
  );
  const now = options.now ?? new Date();
  const sourceDb = options.db ?? getDb();
  const uploads = options.uploadsDir ?? uploadDir();
  const temporary = fs.mkdtempSync(path.join(destination, TEMP_PREFIX));

  try {
    const databaseFile = path.join(temporary, 'kapo.db');
    await sourceDb.backup(databaseFile);
    finalizeBackupDatabase(databaseFile);

    let uploadsIncluded = false;
    if (fs.existsSync(uploads)) {
      if (!fs.statSync(uploads).isDirectory()) {
        throw new Error(`Uploads path is not a directory: ${uploads}`);
      }
      fs.cpSync(uploads, path.join(temporary, 'uploads'), {
        recursive: true,
        force: true,
      });
      uploadsIncluded = true;
    }

    const name = uniqueBackupName(destination, now);
    const finalPath = path.join(destination, name);
    fs.renameSync(temporary, finalPath);

    const databaseBytes = fs.statSync(path.join(finalPath, 'kapo.db')).size;
    let pruned: string[] = [];
    try {
      pruned = pruneBackups(destination, retention);
    } catch (error) {
      // A completed backup stays valid even if pruning failed; the next
      // successful run retries it.
      console.error('[kapo:backup] retention pruning failed', error);
    }

    return {
      name,
      path: finalPath,
      createdAt: now.toISOString(),
      databaseFile: path.join(finalPath, 'kapo.db'),
      databaseBytes,
      uploadsIncluded,
      pruned,
    };
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    const source = options.databaseFile ?? databasePath();
    console.error(`[kapo:backup] failed to back up ${source} into ${destination}`, error);
    throw error;
  }
}
