import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  APPEARANCES,
  APP_ROLES,
  DEFAULT_DASHBOARD,
  DASHBOARD_WIDGETS,
  type AppRole,
  type Appearance,
  type AuthUser,
  type DashboardPreference,
  type DashboardWidgetId,
} from '@/lib/types';
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@/lib/validation';
import { hashPassword, verifyPassword } from '../auth/password';
import { hashSessionToken } from '../auth/session';
import { findUserById } from '../auth/current-user';
import { getDb } from '../db/connection';
import { uploadDir } from '../db/paths';
import { newId, nowIso } from '../db/util';
import {
  canReadProject,
  isActiveProject,
  loadAccessContext,
} from './permissions';
import { getDefaultAccountRole } from './settings';

/**
 * User domain: application accounts, profile self-service and avatar storage.
 *
 * Route handlers translate {@link AccountError} into the build-spec §7 error
 * envelope. Business invariants (last application Admin, username uniqueness,
 * avatar safety) are enforced here, not in components.
 */

export class AccountError extends Error {
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
    this.name = 'AccountError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

/** Account row exposed by the Admin user-management list. */
export interface AccountUser {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  appRole: AppRole;
  createdAt: string;
}

const ACCOUNT_COLUMNS = 'id, username, email, avatar, app_role, created_at';

interface AccountRow {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  app_role: string;
  created_at: string;
}

function mapAccountRow(row: AccountRow): AccountUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatar: row.avatar,
    appRole: row.app_role as AppRole,
    createdAt: row.created_at,
  };
}

export function listUsers(db: BetterSqliteDatabase = getDb()): AccountUser[] {
  const rows = db
    .prepare(
      `SELECT ${ACCOUNT_COLUMNS} FROM users ORDER BY username COLLATE NOCASE ASC`,
    )
    .all() as AccountRow[];
  return rows.map(mapAccountRow);
}

export function getUserAccount(
  db: BetterSqliteDatabase,
  userId: string,
): AccountUser | null {
  const row = db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as AccountRow | undefined;
  return row ? mapAccountRow(row) : null;
}

export function countApplicationAdmins(db: BetterSqliteDatabase = getDb()): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE app_role = 'admin'")
    .get() as { count: number };
  return row.count;
}

function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

function isAppearance(value: string): value is Appearance {
  return (APPEARANCES as readonly string[]).includes(value);
}

/**
 * Mirrors the seed's Root grants: application Users/Viewers receive an explicit
 * Root `project_roles` row so they can see the Root collection; application
 * Admins rely on the permission engine's implicit Root Admin fallback (and any
 * stale explicit row is removed). Keeps account creation and role changes as
 * the single owner of Root membership (architecture-review AR-021).
 */
function syncRootProjectRole(
  db: BetterSqliteDatabase,
  userId: string,
  appRole: AppRole,
): void {
  const root = db
    .prepare('SELECT id FROM projects WHERE parent_id IS NULL LIMIT 1')
    .get() as { id: string } | undefined;
  if (!root) return;
  if (appRole === 'admin') {
    db.prepare('DELETE FROM project_roles WHERE project_id = ? AND user_id = ?').run(
      root.id,
      userId,
    );
    return;
  }
  db.prepare(
    `INSERT INTO project_roles (project_id, user_id, role) VALUES (?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(root.id, userId, appRole === 'viewer' ? 'viewer' : 'user');
}

function usernameTaken(
  db: BetterSqliteDatabase,
  username: string,
  exceptUserId?: string,
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM users WHERE username = ? COLLATE NOCASE ${
        exceptUserId ? 'AND id <> ?' : ''
      }`,
    )
    .get(...(exceptUserId ? [username, exceptUserId] : [username])) as
    | { id: string }
    | undefined;
  return row !== undefined;
}

function requireValidUsername(db: BetterSqliteDatabase, raw: string, exceptUserId?: string): string {
  const username = normalizeUsername(raw);
  const error = validateUsername(username);
  if (error) {
    throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
      username: error,
    });
  }
  if (usernameTaken(db, username, exceptUserId)) {
    throw new AccountError(409, 'username_taken', 'That username is already taken.', {
      username: 'That username is already taken.',
    });
  }
  return username;
}

function requireValidEmail(raw: string): string {
  const email = normalizeEmail(raw);
  const error = validateEmail(email);
  if (error) {
    throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
      email: error,
    });
  }
  return email;
}

function requireValidRole(raw: string): AppRole {
  const role = raw.trim().toLowerCase();
  if (!isAppRole(role)) {
    throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
      appRole: 'Choose an application role.',
    });
  }
  return role;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a stored landing-page preference. Allowed values are `home`, `root`
 * and the id of a project that currently exists outside Trash.
 *
 * Project accessibility is additionally enforced after sign-in: the landing
 * destination itself is permission-filtered by the project page. Once the
 * project permission module is available the domain refinement lives in
 * `resolveLandingPageOptions` so the profile select only offers readable
 * projects.
 */
function normalizeLandingPage(
  db: BetterSqliteDatabase,
  user: AuthUser,
  raw: string,
): string {
  const value = raw.trim();
  if (value === 'home' || value === 'root') return value;
  if (!UUID_PATTERN.test(value)) {
    throw new AccountError(422, 'validation_failed', 'Choose a valid landing page.', {
      landingPage: 'Choose a landing page.',
    });
  }
  const ctx = loadAccessContext(db, user);
  if (!isActiveProject(ctx, value)) {
    throw new AccountError(422, 'validation_failed', 'Choose a valid landing page.', {
      landingPage: 'That project is not available.',
    });
  }
  return value;
}

/**
 * Normalises the dashboard preference JSON submitted by the editor.
 *
 * Unknown widget ids are deliberately preserved (dashboard.md: a preference
 * for a widget that is currently unavailable must survive a save so it can
 * return later). Only the shape is validated; rendering filters to known ids.
 */
export function normalizeDashboardPreference(raw: unknown): DashboardPreference[] {
  if (!Array.isArray(raw)) {
    throw new AccountError(422, 'validation_failed', 'The dashboard layout is invalid.', {
      dashboard: 'The dashboard layout is invalid.',
    });
  }
  const seen = new Set<string>();
  const items: DashboardPreference[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      throw new AccountError(422, 'validation_failed', 'The dashboard layout is invalid.', {
        dashboard: 'The dashboard layout is invalid.',
      });
    }
    const candidate = entry as { id?: unknown; visible?: unknown };
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      candidate.id.length > 64
    ) {
      throw new AccountError(422, 'validation_failed', 'The dashboard layout is invalid.', {
        dashboard: 'One of the widgets is not valid.',
      });
    }
    if (seen.has(candidate.id)) {
      throw new AccountError(422, 'validation_failed', 'The dashboard layout is invalid.', {
        dashboard: 'Each widget may appear only once.',
      });
    }
    if (typeof candidate.visible !== 'boolean') {
      throw new AccountError(422, 'validation_failed', 'The dashboard layout is invalid.', {
        dashboard: 'Each widget needs a visible setting.',
      });
    }
    seen.add(candidate.id);
    items.push({ id: candidate.id, visible: candidate.visible });
  }
  // Known widgets the client did not send remain selectable in the editor.
  for (const id of DASHBOARD_WIDGETS) {
    if (!seen.has(id)) items.push({ id, visible: false });
  }
  return items;
}

export function serializeDashboard(preferences: DashboardPreference[]): string {
  return JSON.stringify(preferences);
}

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  appRole?: string;
}

/** Creates an application account (Admin-only user management). */
/** Throws the standard 403 envelope error for non-Admin API callers. */
export function assertApplicationAdmin(user: Pick<AuthUser, 'appRole'>): void {
  if (user.appRole !== 'admin') {
    throw new AccountError(
      403,
      'forbidden',
      'Application Admin access is required for this action.',
    );
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT';
}

export async function createUser(
  db: BetterSqliteDatabase,
  input: CreateUserInput,
): Promise<AccountUser> {
  const username = requireValidUsername(db, input.username);
  const email = requireValidEmail(input.email);
  const passwordError = validatePassword(input.password);
  if (passwordError) {
    throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
      password: passwordError,
    });
  }
  const appRole = input.appRole
    ? requireValidRole(input.appRole)
    : getDefaultAccountRole(db);
  const passwordHash = await hashPassword(input.password);
  const userId = newId();
  const createdAt = nowIso();

  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (
           id, username, email, password_hash, avatar, app_role, landing_page,
           appearance, dashboard, show_archived, created_at
         ) VALUES (?, ?, ?, ?, NULL, ?, 'home', 'system', ?, 0, ?)`,
      ).run(
        userId,
        username,
        email,
        passwordHash,
        appRole,
        JSON.stringify(DEFAULT_DASHBOARD),
        createdAt,
      );
      syncRootProjectRole(db, userId, appRole);
    })();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AccountError(409, 'username_taken', 'That username is already taken.', {
        username: 'That username is already taken.',
      });
    }
    throw error;
  }

  return {
    id: userId,
    username,
    email,
    avatar: null,
    appRole,
    createdAt,
  };
}

export interface CreateSsoUserInput {
  username: string;
  email: string;
  appRole: AppRole;
  provider: string;
  subject: string;
}

/**
 * Creates an account for a first-time OIDC sign-in and links its external
 * subject in one transaction. The account gets a random password hash that is
 * never disclosed: password login remains available only if an Admin later
 * resets it (useful as a break-glass path), and the hash keeps the normal
 * password verification path well-defined for the NOT NULL column.
 */
export async function createSsoUser(
  db: BetterSqliteDatabase,
  input: CreateSsoUserInput,
): Promise<AccountUser> {
  const username = requireValidUsername(db, input.username);
  const email = requireValidEmail(input.email);
  const appRole = requireValidRole(input.appRole);
  const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
  const userId = newId();
  const createdAt = nowIso();

  try {
    db.transaction(() => {
      const existingEmail = db
        .prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1')
        .get(email) as { id: string } | undefined;
      if (existingEmail) {
        throw new AccountError(
          409,
          'account_conflict',
          'An account with this email already exists.',
        );
      }
      db.prepare(
        `INSERT INTO users (
           id, username, email, password_hash, avatar, app_role, landing_page,
           appearance, dashboard, show_archived, created_at
         ) VALUES (?, ?, ?, ?, NULL, ?, 'home', 'system', ?, 0, ?)`,
      ).run(
        userId,
        username,
        email,
        passwordHash,
        appRole,
        JSON.stringify(DEFAULT_DASHBOARD),
        createdAt,
      );
      syncRootProjectRole(db, userId, appRole);
      db.prepare(
        `INSERT INTO user_identities (
           id, user_id, provider, subject, email_at_link, created_at, last_login_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(newId(), userId, input.provider, input.subject, email, createdAt, createdAt);
    })();
  } catch (error) {
    if (error instanceof AccountError) throw error;
    if (isUniqueConstraintError(error)) {
      throw new AccountError(
        409,
        'account_conflict',
        'This account could not be linked. Try signing in again.',
      );
    }
    throw error;
  }

  return {
    id: userId,
    username,
    email,
    avatar: null,
    appRole,
    createdAt,
  };
}

export interface UpdateUserInput {
  id: string;
  username?: string;
  email?: string;
  appRole?: string;
  password?: string;
}

/**
 * Updates an account as an application Admin. The last application Admin
 * cannot be demoted; the rejection names the affected account.
 */
export async function updateUser(
  db: BetterSqliteDatabase,
  input: UpdateUserInput,
): Promise<AccountUser> {
  const existing = getUserAccount(db, input.id);
  if (!existing) {
    throw new AccountError(404, 'user_not_found', 'That account no longer exists.');
  }

  const username =
    input.username !== undefined ? requireValidUsername(db, input.username, existing.id) : existing.username;
  const email = input.email !== undefined ? requireValidEmail(input.email) : existing.email;
  const appRole =
    input.appRole !== undefined ? requireValidRole(input.appRole) : existing.appRole;

  if (existing.appRole === 'admin' && appRole !== 'admin') {
    const admins = countApplicationAdmins(db);
    if (admins <= 1) {
      throw new AccountError(
        409,
        'last_admin',
        `${existing.username} is the last application Admin. Promote another account before changing this role.`,
        { appRole: `${existing.username} is the last application Admin.` },
      );
    }
  }

  let passwordHash: string | null = null;
  if (input.password !== undefined && input.password.length > 0) {
    const passwordError = validatePassword(input.password);
    if (passwordError) {
      throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
        password: passwordError,
      });
    }
    passwordHash = await hashPassword(input.password);
  }

  try {
    db.transaction(() => {
      db.prepare(
        'UPDATE users SET username = ?, email = ?, app_role = ? WHERE id = ?',
      ).run(username, email, appRole, existing.id);
      if (passwordHash) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
          passwordHash,
          existing.id,
        );
        // A password reset by an Admin signs that account out everywhere.
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
      }
      syncRootProjectRole(db, existing.id, appRole);
    })();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AccountError(409, 'username_taken', 'That username is already taken.', {
        username: 'That username is already taken.',
      });
    }
    throw error;
  }

  return {
    ...existing,
    username,
    email,
    appRole,
  };
}

export interface UpdateOwnProfileInput {
  username?: string;
  email?: string;
  landingPage?: string;
  appearance?: string;
  showArchived?: boolean;
  dashboard?: unknown;
}

/**
 * Self-service profile update. Application role, avatar and password are not
 * editable through this path: Viewers may edit only their own profile,
 * appearance and dashboard (build-spec §1, §7).
 */
export function updateOwnProfile(
  db: BetterSqliteDatabase,
  userId: string,
  input: UpdateOwnProfileInput,
): AuthUser {
  const existing = findUserById(db, userId);
  if (!existing) {
    throw new AccountError(404, 'user_not_found', 'That account no longer exists.');
  }

  const assignments: string[] = [];
  const values: Array<string | number> = [];

  if (input.username !== undefined) {
    const username = requireValidUsername(db, input.username, existing.id);
    assignments.push('username = ?');
    values.push(username);
  }
  if (input.email !== undefined) {
    assignments.push('email = ?');
    values.push(requireValidEmail(input.email));
  }
  if (input.landingPage !== undefined) {
    assignments.push('landing_page = ?');
    values.push(normalizeLandingPage(db, existing, input.landingPage));
  }
  if (input.appearance !== undefined) {
    const appearance = input.appearance.trim();
    if (!isAppearance(appearance)) {
      throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
        appearance: 'Choose Light, Dark or System.',
      });
    }
    assignments.push('appearance = ?');
    values.push(appearance);
  }
  if (input.showArchived !== undefined) {
    assignments.push('show_archived = ?');
    values.push(input.showArchived ? 1 : 0);
  }
  if (input.dashboard !== undefined) {
    const preferences = normalizeDashboardPreference(input.dashboard);
    assignments.push('dashboard = ?');
    values.push(serializeDashboard(preferences));
  }

  if (assignments.length === 0) {
    throw new AccountError(400, 'no_changes', 'No supported profile fields were provided.');
  }

  try {
    db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`).run(
      ...values,
      existing.id,
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AccountError(409, 'username_taken', 'That username is already taken.', {
        username: 'That username is already taken.',
      });
    }
    throw error;
  }

  const updated = findUserById(db, userId);
  if (!updated) {
    throw new AccountError(404, 'user_not_found', 'That account no longer exists.');
  }
  return updated;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmation?: string;
}

/**
 * Changes the signed-in user's password after verifying the current one.
 * Other sessions for the account are revoked; the current session is kept.
 */
export async function changeOwnPassword(
  db: BetterSqliteDatabase,
  userId: string,
  currentSessionToken: string | null,
  input: ChangePasswordInput,
): Promise<void> {
  const row = db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(userId) as { password_hash: string } | undefined;
  if (!row) {
    throw new AccountError(404, 'user_not_found', 'That account no longer exists.');
  }

  const currentPassword = input.currentPassword;
  if (!currentPassword) {
    throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
      currentPassword: 'Enter your current password.',
    });
  }

  const valid = await verifyPassword(currentPassword, row.password_hash);
  if (!valid) {
    throw new AccountError(401, 'invalid_password', 'That current password is not correct.', {
      currentPassword: 'That current password is not correct.',
    });
  }

  const passwordError = validatePassword(input.newPassword);
  if (passwordError) {
    throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
      newPassword: passwordError,
    });
  }
  if (input.confirmation !== undefined && input.confirmation !== input.newPassword) {
    throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
      confirmation: 'Passwords do not match.',
    });
  }
  if (input.newPassword === currentPassword) {
    throw new AccountError(422, 'validation_failed', 'Check the highlighted fields.', {
      newPassword: 'Choose a password you have not used for this account.',
    });
  }

  const passwordHash = await hashPassword(input.newPassword);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    if (currentSessionToken) {
      // Keep the session that made the change; revoke every other device.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(
        userId,
        hashSessionToken(currentSessionToken),
      );
    } else {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
  })();
}

/* -------------------------------------------------------------------------- */
/* Avatar upload                                                              */
/* -------------------------------------------------------------------------- */

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const AVATAR_ROUTE_PREFIX = '/api/me/avatar/';
const AVATAR_FILENAME_PATTERN = /^[a-z0-9-]+\.(png|jpg|webp)$/;

interface DetectedImage {
  mime: (typeof AVATAR_ALLOWED_MIME)[number];
  extension: 'png' | 'jpg' | 'webp';
}

/**
 * Validates image content by magic bytes rather than trusting the browser's
 * declared MIME type. The penpot-supported set is png/jpeg/webp only.
 */
function detectImage(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 12) return null;
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
}

export function avatarDirectory(): string {
  return path.join(uploadDir(), 'avatars');
}

export function isSafeAvatarFilename(filename: string): boolean {
  return AVATAR_FILENAME_PATTERN.test(filename);
}

export function avatarFilePath(filename: string): string | null {
  if (!isSafeAvatarFilename(filename)) return null;
  const directory = avatarDirectory();
  const resolved = path.resolve(directory, filename);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) return null;
  return resolved;
}

function removeStoredAvatar(db: BetterSqliteDatabase, avatarPath: string | null): void {
  if (!avatarPath || !avatarPath.startsWith(AVATAR_ROUTE_PREFIX)) return;
  const filename = avatarPath.slice(AVATAR_ROUTE_PREFIX.length);
  const filePath = avatarFilePath(filename);
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    /* an orphaned avatar file must never block the profile update */
  }
}

/**
 * Stores an uploaded avatar under UPLOAD_DIR/avatars with a safe, generated
 * filename and points users.avatar at the authenticated serving route.
 */
export function saveAvatar(
  db: BetterSqliteDatabase,
  userId: string,
  buffer: Buffer,
  declaredMime: string,
): string {
  const user = findUserById(db, userId);
  if (!user) {
    throw new AccountError(404, 'user_not_found', 'That account no longer exists.');
  }
  if (buffer.length === 0) {
    throw new AccountError(422, 'validation_failed', 'Choose an image to upload.', {
      avatar: 'Choose an image to upload.',
    });
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new AccountError(413, 'avatar_too_large', 'Choose an image up to 2 MB.', {
      avatar: 'Choose an image up to 2 MB.',
    });
  }
  const detected = detectImage(buffer);
  if (!detected) {
    throw new AccountError(
      415,
      'unsupported_avatar',
      'Choose a PNG, JPEG or WebP image.',
      { avatar: 'Choose a PNG, JPEG or WebP image.' },
    );
  }
  if (
    declaredMime &&
    declaredMime !== detected.mime &&
    !(declaredMime === 'image/jpg' && detected.mime === 'image/jpeg')
  ) {
    throw new AccountError(
      415,
      'unsupported_avatar',
      'Choose a PNG, JPEG or WebP image.',
      { avatar: 'Choose a PNG, JPEG or WebP image.' },
    );
  }

  const directory = avatarDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = `${userId}-${randomBytes(6).toString('hex')}.${detected.extension}`;
  const filePath = avatarFilePath(filename);
  if (!filePath) {
    throw new AccountError(500, 'avatar_storage_failed', 'Could not store the image.');
  }
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });

  const avatarPath = `${AVATAR_ROUTE_PREFIX}${filename}`;
  db.transaction(() => {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarPath, userId);
  })();
  removeStoredAvatar(db, user.avatar);
  return avatarPath;
}

export function readAvatarFile(filename: string): Buffer | null {
  const filePath = avatarFilePath(filename);
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

export function avatarContentType(filename: string): string {
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg')) return 'image/jpeg';
  return 'image/webp';
}

/* -------------------------------------------------------------------------- */
/* Landing page                                                               */
/* -------------------------------------------------------------------------- */

export interface LandingPageOption {
  value: string;
  label: string;
}

/**
 * Landing-page choices for the profile select: Home, Root and every project
 * the viewer may currently read (archived visibility included). Selection is
 * validated again on write, so a stale form cannot store an inaccessible page.
 */
export function listLandingPageOptions(
  db: BetterSqliteDatabase,
  user: AuthUser,
): LandingPageOption[] {
  const options: LandingPageOption[] = [{ value: 'home', label: 'Home' }];
  const ctx = loadAccessContext(db, user);
  const projects = [...ctx.projectById.values()].sort((a, b) => a.seq - b.seq);
  const root = projects.find((project) => project.parentId === null);
  if (root && canReadProject(ctx, root.id)) {
    options.push({ value: 'root', label: 'Root' });
  }
  for (const project of projects) {
    if (project.parentId === null) continue;
    if (!isActiveProject(ctx, project.id)) continue;
    options.push({ value: project.id, label: project.title });
  }
  return options;
}

/** Resolves the post-sign-in destination for a stored landing-page value. */
export function resolveLandingHref(db: BetterSqliteDatabase, user: AuthUser): string {
  const landing = user.landingPage?.trim();
  if (!landing || landing === 'home') return '/';
  if (landing === 'root') {
    const row = db
      .prepare('SELECT id FROM projects WHERE parent_id IS NULL LIMIT 1')
      .get() as { id: string } | undefined;
    return row ? `/p/${row.id}` : '/';
  }
  if (!UUID_PATTERN.test(landing)) return '/';
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, landing)) return '/';
  const project = ctx.projectById.get(landing);
  if (!project || project.trashed) return '/';
  return `/p/${project.id}`;
}
