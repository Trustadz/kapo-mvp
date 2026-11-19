import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { AppRole, FavoriteProject } from '@/lib/types';
import { getDb } from './connection';
import {
  canReadProject,
  isActiveProject,
  loadAccessContext,
  type AccessUser,
} from '../domain/permissions';

/**
 * Read-only queries the application shell needs on every authenticated page.
 *
 * Every project-shaped result is permission filtered through the project
 * permission engine (build-spec §6 rule 12): favorites never grant access, and
 * favorites the viewer can no longer see disappear from navigation without
 * leaking their titles.
 */

export interface ShellData {
  favorites: FavoriteProject[];
  rootProjectId: string | null;
  installationName: string;
}

function loadShellUser(
  db: BetterSqliteDatabase,
  userId: string,
): AccessUser | null {
  const row = db
    .prepare('SELECT app_role, show_archived FROM users WHERE id = ?')
    .get(userId) as { app_role: AppRole; show_archived: number } | undefined;
  if (!row) return null;
  return {
    id: userId,
    appRole: row.app_role,
    showArchived: row.show_archived === 1,
  };
}

export function getFavoriteProjects(
  userId: string,
  db: BetterSqliteDatabase = getDb(),
): FavoriteProject[] {
  const user = loadShellUser(db, userId);
  if (!user) return [];
  const ctx = loadAccessContext(db, user);
  const rows = db
    .prepare(
      `SELECT p.id AS id, p.title AS title
         FROM favorites f
         JOIN projects p ON p.id = f.project_id
        WHERE f.user_id = ?
        ORDER BY p.title COLLATE NOCASE ASC`,
    )
    .all(userId) as Array<{ id: string; title: string }>;
  return rows
    .filter((row) => isActiveProject(ctx, row.id))
    .map((row) => ({ id: row.id, title: row.title }));
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
  const user = loadShellUser(db, userId);
  const rootProjectId = getRootProjectId(db);
  let visibleRootId: string | null = null;
  if (user && rootProjectId) {
    const ctx = loadAccessContext(db, user);
    visibleRootId = canReadProject(ctx, rootProjectId) ? rootProjectId : null;
  }
  return {
    favorites: getFavoriteProjects(userId, db),
    rootProjectId: visibleRootId,
    installationName: getInstallationName(db),
  };
}
