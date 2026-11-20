import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  APP_ROLES,
  COLLECTION_VIEWS,
  type AppRole,
  type CollectionView,
} from '@/lib/types';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_BACKUP_ENABLED,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_BACKUP_START_TIME,
  DEFAULT_TRASH_PURGE_ENABLED,
  MAX_BACKUP_RETENTION,
  MAX_TRASH_RETENTION_DAYS,
  MIN_BACKUP_RETENTION,
  MIN_TRASH_RETENTION_DAYS,
  TRASH_RETENTION_DAYS,
} from '../db/bootstrap';
import { getDb } from '../db/connection';
import { getInstallationName } from '../db/shell-queries';
import { addDaysIso } from '../db/util';

/**
 * Application-wide settings (Admin only): default account role, enabled
 * collection views, automatic trash purge/retention and the rolling backup
 * schedule (issues #13 and #21).
 *
 * Route handlers translate {@link SettingsError} into the build-spec §7 error
 * envelope. Every value read back is normalised so a corrupt row cannot crash a
 * page; writes validate the complete payload before touching the database.
 */

export class SettingsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'SettingsError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

export interface ApplicationSettings {
  defaultAccountRole: AppRole;
  enabledViews: CollectionView[];
  trashPurgeEnabled: boolean;
  trashRetentionDays: number;
  installationName: string;
  backupEnabled: boolean;
  /** Local wall-clock start time, `HH:MM` (24-hour). */
  backupStartTime: string;
  /** Number of most-recent backup folders to keep (1–30). */
  backupRetention: number;
}

const DEFAULT_ENABLED_VIEWS: CollectionView[] = [...COLLECTION_VIEWS];

export const BACKUP_START_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

function isCollectionView(value: string): value is CollectionView {
  return (COLLECTION_VIEWS as readonly string[]).includes(value);
}

export function isValidBackupStartTime(value: string): boolean {
  return BACKUP_START_TIME_PATTERN.test(value);
}

function parseBooleanSetting(raw: string | undefined, fallback: boolean): boolean {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return fallback;
}

function parseTrashRetention(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) &&
    value >= MIN_TRASH_RETENTION_DAYS &&
    value <= MAX_TRASH_RETENTION_DAYS
    ? value
    : TRASH_RETENTION_DAYS;
}

function parseBackupRetention(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) &&
    value >= MIN_BACKUP_RETENTION &&
    value <= MAX_BACKUP_RETENTION
    ? value
    : DEFAULT_BACKUP_RETENTION;
}

function readSetting(db: BetterSqliteDatabase, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function parseEnabledViews(raw: string | undefined): CollectionView[] {
  if (!raw) return DEFAULT_ENABLED_VIEWS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return DEFAULT_ENABLED_VIEWS;
  }
  if (!Array.isArray(parsed)) return DEFAULT_ENABLED_VIEWS;
  const views: CollectionView[] = [];
  for (const entry of parsed) {
    if (typeof entry === 'string' && isCollectionView(entry) && !views.includes(entry)) {
      views.push(entry);
    }
  }
  // At least one collection view must remain available (product.md §5).
  return views.length > 0 ? views : DEFAULT_ENABLED_VIEWS;
}

export function getApplicationSettings(
  db: BetterSqliteDatabase = getDb(),
): ApplicationSettings {
  const rawRole = readSetting(db, 'default_account_role')?.trim() ?? 'user';
  const defaultAccountRole: AppRole = isAppRole(rawRole) ? rawRole : 'user';
  const rawBackupStart = readSetting(db, 'backup_start_time')?.trim() ?? '';
  return {
    defaultAccountRole,
    enabledViews: parseEnabledViews(readSetting(db, 'enabled_views')),
    trashPurgeEnabled: parseBooleanSetting(
      readSetting(db, 'trash_purge_enabled'),
      DEFAULT_TRASH_PURGE_ENABLED,
    ),
    trashRetentionDays: parseTrashRetention(readSetting(db, 'trash_retention_days')),
    installationName: getInstallationName(db),
    backupEnabled: parseBooleanSetting(
      readSetting(db, 'backup_enabled'),
      DEFAULT_BACKUP_ENABLED,
    ),
    backupStartTime: isValidBackupStartTime(rawBackupStart)
      ? rawBackupStart
      : DEFAULT_BACKUP_START_TIME,
    backupRetention: parseBackupRetention(readSetting(db, 'backup_retention')),
  };
}

export function getDefaultAccountRole(db: BetterSqliteDatabase = getDb()): AppRole {
  return getApplicationSettings(db).defaultAccountRole;
}

export interface UpdateApplicationSettingsInput {
  defaultAccountRole?: unknown;
  enabledViews?: unknown;
  trashPurgeEnabled?: unknown;
  trashRetentionDays?: unknown;
  installationName?: unknown;
  backupEnabled?: unknown;
  backupStartTime?: unknown;
  backupRetention?: unknown;
}

function normaliseViews(raw: unknown): CollectionView[] {
  if (!Array.isArray(raw)) {
    throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
      enabledViews: 'Choose at least one view.',
    });
  }
  const views: CollectionView[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !isCollectionView(entry)) {
      throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
        enabledViews: 'Choose from the available views.',
      });
    }
    if (!views.includes(entry)) views.push(entry);
  }
  if (views.length === 0) {
    throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
      enabledViews: 'At least one view must remain available.',
    });
  }
  // Persist in the canonical registry order so the UI is stable.
  return COLLECTION_VIEWS.filter((view) => views.includes(view));
}

/** Applies an application-settings update (Admin only, validated server-side). */
export function updateApplicationSettings(
  db: BetterSqliteDatabase,
  input: UpdateApplicationSettingsInput,
): ApplicationSettings {
  const values = new Map<string, string>();

  if (input.defaultAccountRole !== undefined) {
    const raw = typeof input.defaultAccountRole === 'string' ? input.defaultAccountRole : '';
    const role = raw.trim();
    if (!isAppRole(role)) {
      throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
        defaultAccountRole: 'Choose an application role.',
      });
    }
    values.set('default_account_role', role);
  }

  if (input.enabledViews !== undefined) {
    const views = normaliseViews(input.enabledViews);
    values.set('enabled_views', JSON.stringify(views));
  }

  let nextTrashRetention: number | null = null;
  if (input.trashPurgeEnabled !== undefined) {
    if (typeof input.trashPurgeEnabled !== 'boolean') {
      throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
        trashPurgeEnabled: 'Choose whether trash is purged automatically.',
      });
    }
    values.set('trash_purge_enabled', input.trashPurgeEnabled ? '1' : '0');
  }

  if (input.trashRetentionDays !== undefined) {
    const days = Number(input.trashRetentionDays);
    if (
      !Number.isInteger(days) ||
      days < MIN_TRASH_RETENTION_DAYS ||
      days > MAX_TRASH_RETENTION_DAYS
    ) {
      throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
        trashRetentionDays: `Keep trash between ${MIN_TRASH_RETENTION_DAYS} and ${MAX_TRASH_RETENTION_DAYS} days.`,
      });
    }
    values.set('trash_retention_days', String(days));
    nextTrashRetention = days;
  }

  if (input.installationName !== undefined) {
    const name = typeof input.installationName === 'string' ? input.installationName.trim() : '';
    if (!name || name.length > 60) {
      throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
        installationName: 'Enter a name between 1 and 60 characters.',
      });
    }
    values.set('installation_name', name);
  }

  if (input.backupEnabled !== undefined) {
    if (typeof input.backupEnabled !== 'boolean') {
      throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
        backupEnabled: 'Choose whether daily backups are enabled.',
      });
    }
    values.set('backup_enabled', input.backupEnabled ? '1' : '0');
  }

  if (input.backupStartTime !== undefined) {
    const raw = typeof input.backupStartTime === 'string' ? input.backupStartTime.trim() : '';
    if (!isValidBackupStartTime(raw)) {
      throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
        backupStartTime: 'Enter a time between 00:00 and 23:59.',
      });
    }
    values.set('backup_start_time', raw);
  }

  if (input.backupRetention !== undefined) {
    const retention = Number(input.backupRetention);
    if (
      !Number.isInteger(retention) ||
      retention < MIN_BACKUP_RETENTION ||
      retention > MAX_BACKUP_RETENTION
    ) {
      throw new SettingsError(422, 'validation_failed', 'Check the highlighted fields.', {
        backupRetention: `Keep between ${MIN_BACKUP_RETENTION} and ${MAX_BACKUP_RETENTION} backups.`,
      });
    }
    values.set('backup_retention', String(retention));
  }

  if (values.size === 0) {
    throw new SettingsError(400, 'no_changes', 'No supported settings were provided.');
  }

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [key, value] of values) upsert.run(key, value);
    if (nextTrashRetention !== null) {
      // Keep every trashed project's displayed deadline in sync with the new
      // retention setting, including items already in Trash.
      const rows = db
        .prepare('SELECT id, trashed_at FROM projects WHERE trashed_at IS NOT NULL')
        .all() as Array<{ id: string; trashed_at: string }>;
      const updateDeadline = db.prepare('UPDATE projects SET purge_deadline = ? WHERE id = ?');
      for (const row of rows) {
        updateDeadline.run(addDaysIso(row.trashed_at, nextTrashRetention), row.id);
      }
    }
  })();

  return getApplicationSettings(db);
}

/** Ensures the default rows exist (used by first-run setup and seeding). */
export function ensureDefaultSettings(db: BetterSqliteDatabase = getDb()): void {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const setting of DEFAULT_APP_SETTINGS) {
    insert.run(setting.key, setting.value);
  }
}
