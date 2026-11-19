import { redirect } from 'next/navigation';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  parseDashboard,
  type AppRole,
  type AuthUser,
  type Appearance,
} from '@/lib/types';
import { getDb } from '../db/connection';
import { readSessionToken } from './cookies';
import { resolveSession } from './session';

/**
 * Current-user helpers for server components, route handlers and server
 * actions. `requireUser` / `requireAdmin` redirect; route handlers should use
 * `getSessionUser` and return a JSON 401 instead.
 */

export interface UserRow {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  app_role: string;
  landing_page: string;
  appearance: string;
  dashboard: string;
  show_archived: number;
  created_at: string;
}

export const USER_COLUMNS =
  'id, username, email, avatar, app_role, landing_page, appearance, dashboard, show_archived, created_at';

export function mapUserRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatar: row.avatar,
    appRole: row.app_role as AppRole,
    landingPage: row.landing_page,
    appearance: row.appearance as Appearance,
    dashboard: parseDashboard(row.dashboard),
    showArchived: row.show_archived === 1,
    createdAt: row.created_at,
  };
}

export function findUserById(
  db: BetterSqliteDatabase,
  userId: string,
): AuthUser | null {
  const row = db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as UserRow | undefined;
  return row ? mapUserRow(row) : null;
}

export function findUserByUsername(
  db: BetterSqliteDatabase,
  username: string,
): (AuthUser & { passwordHash: string }) | null {
  const row = db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = ?`)
    .get(username) as (UserRow & { password_hash: string }) | undefined;
  if (!row) return null;
  return { ...mapUserRow(row), passwordHash: row.password_hash };
}

/** Reads the session cookie and resolves the signed-in user, if any. */
export async function getSessionUser(): Promise<AuthUser | null> {
  const token = await readSessionToken();
  if (!token) return null;
  const db = getDb();
  const session = resolveSession(db, token);
  if (!session) return null;
  return findUserById(db, session.userId);
}

/** Server-component guard: redirects to /login when there is no session. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** Server-component guard for application Admins. */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.appRole !== 'admin') redirect('/');
  return user;
}

/** Server-component guard for one application role or a set of roles. */
export async function requireRole(roles: AppRole | readonly AppRole[]): Promise<AuthUser> {
  const allowed: readonly AppRole[] = Array.isArray(roles) ? roles : [roles as AppRole];
  return requireAppRole(allowed);
}

/** Server-component guard for a set of application roles. */
export async function requireAppRole(roles: readonly AppRole[]): Promise<AuthUser> {
  const user = await requireUser();
  if (!roles.includes(user.appRole)) redirect('/');
  return user;
}

export function isApplicationAdmin(user: Pick<AuthUser, 'appRole'>): boolean {
  return user.appRole === 'admin';
}

/**
 * Application-wide read-only: Viewers may edit their own profile, password,
 * appearance and dashboard, but nothing project-related.
 */
export function isReadOnlyViewer(user: Pick<AuthUser, 'appRole'>): boolean {
  return user.appRole === 'viewer';
}

export function countUsers(db: BetterSqliteDatabase = getDb()): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}

/** First-run detection used by /setup. */
export async function isFirstRun(): Promise<boolean> {
  return countUsers() === 0;
}
