import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  APP_ROLES,
  COLLECTION_VIEWS,
  type AppRole,
  type CollectionView,
} from '@/lib/types';
import { DEFAULT_APP_SETTINGS, TRASH_RETENTION_DAYS } from '../db/bootstrap';
import { getDb } from '../db/connection';
import { getInstallationName } from '../db/shell-queries';

/**
 * Application-wide settings (Admin only): default account role, enabled
 * collection views and the fixed 30-day trash retention.
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
  trashRetentionDays: number;
  installationName: string;
}

const DEFAULT_ENABLED_VIEWS: CollectionView[] = [...COLLECTION_VIEWS];

function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

function isCollectionView(value: string): value is CollectionView {
  return (COLLECTION_VIEWS as readonly string[]).includes(value);
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
  return {
    defaultAccountRole,
    enabledViews: parseEnabledViews(readSetting(db, 'enabled_views')),
    // Retention is a product decision, not a user preference.
    trashRetentionDays: TRASH_RETENTION_DAYS,
    installationName: getInstallationName(db),
  };
}

export function getDefaultAccountRole(db: BetterSqliteDatabase = getDb()): AppRole {
  return getApplicationSettings(db).defaultAccountRole;
}

export interface UpdateApplicationSettingsInput {
  defaultAccountRole?: unknown;
  enabledViews?: unknown;
  trashRetentionDays?: unknown;
  installationName?: unknown;
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

  if (input.trashRetentionDays !== undefined) {
    const days = Number(input.trashRetentionDays);
    if (days !== TRASH_RETENTION_DAYS) {
      throw new SettingsError(
        422,
        'validation_failed',
        `Trash retention is fixed at ${TRASH_RETENTION_DAYS} days.`,
        { trashRetentionDays: `Trash retention is fixed at ${TRASH_RETENTION_DAYS} days.` },
      );
    }
    values.set('trash_retention_days', String(TRASH_RETENTION_DAYS));
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

  if (values.size === 0) {
    throw new SettingsError(400, 'no_changes', 'No supported settings were provided.');
  }

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [key, value] of values) upsert.run(key, value);
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
