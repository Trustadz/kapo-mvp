import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { FavoriteProject } from '@/lib/types';
import { getDb } from './connection';

/**
 * Read-only queries the application shell needs on every authenticated page.
 *
 * Permission filtering for project content lives in src/server/domain (owned by
 * builder-projects). Favorites never grant access; once the permission engine
 * lands, extend `getFavoriteProjects` so favorites the viewer can no longer see
 * disappear from navigation without leaking their titles.
 */

export interface ShellData {
  favorites: FavoriteProject[];
  rootProjectId: string | null;
  installationName: string;
}

export function getFavoriteProjects(
  userId: string,
  db: BetterSqliteDatabase = getDb(),
): FavoriteProject[] {
  const rows = db
    .prepare(
      `SELECT p.id AS id, p.title AS title
         FROM favorites f
         JOIN projects p ON p.id = f.project_id
        WHERE f.user_id = ?
          AND p.trashed_at IS NULL
        ORDER BY p.title COLLATE NOCASE ASC`,
    )
    .all(userId) as Array<{ id: string; title: string }>;
  return rows.map((row) => ({ id: row.id, title: row.title }));
}

export function getRootProjectId(db: BetterSqliteDatabase = getDb()): string | null {
  const row = db
    .prepare('SELECT id FROM projects WHERE parent_id IS NULL LIMIT 1')
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function getInstallationName(db: BetterSqliteDatabase = getDb()): string {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'installation_name'")
    .get() as { value: string } | undefined;
  return row?.value?.trim() || 'Kapo';
}

export function getShellData(
  userId: string,
  db: BetterSqliteDatabase = getDb(),
): ShellData {
  return {
    favorites: getFavoriteProjects(userId, db),
    rootProjectId: getRootProjectId(db),
    installationName: getInstallationName(db),
  };
}
