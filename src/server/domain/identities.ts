import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { AuthUser } from '@/lib/types';
import { normalizeEmail, validateEmail } from '@/lib/validation';
import { findUserById } from '../auth/current-user';
import { OidcLoginError, type OidcClaims } from '../auth/oidc';
import { newId, nowIso } from '../db/util';
import { AccountError, createSsoUser, type AccountUser } from './users';

/**
 * External identity mapping for PocketID / OIDC.
 *
 * The rules are deliberately conservative because Kapo has no email
 * verification of its own:
 *
 *   1. A known `sub` always wins; it is the only stable identifier.
 *   2. Otherwise a non-empty, verified-if-stated email may match exactly one
 *      existing account. Ambiguous or already-linked emails are rejected.
 *   3. Otherwise, when auto-provisioning is on, a new Viewer account is
 *      created and linked. Existing roles are never changed by SSO.
 */

interface IdentityRow {
  user_id: string;
  subject: string;
  email_at_link: string | null;
}

export interface ResolvedOidcUser {
  user: AuthUser;
  created: boolean;
}

const USERNAME_MAX = 32;
const USERNAME_BASE_MAX = USERNAME_MAX - 4;

function usernameExists(db: BetterSqliteDatabase, username: string): boolean {
  const row = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1')
    .get(username) as { id: string } | undefined;
  return row !== undefined;
}

/**
 * Derives a Kapo username from PocketID's preferred_username (or the email
 * local part), keeping the shared validation pattern and de-duplicating
 * collisions with a numeric suffix.
 */
export function generateUsername(
  db: BetterSqliteDatabase,
  preferredUsername: string | null,
  email: string,
): string {
  const raw = preferredUsername?.trim() || email.split('@')[0] || 'user';
  let base = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[-._]{2,}/g, '-')
    .replace(/[-._]+$/, '')
    .slice(0, USERNAME_BASE_MAX);
  if (base.length < 3) base = 'user';

  let candidate = base;
  let suffix = 2;
  while (usernameExists(db, candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, USERNAME_MAX - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

export function findIdentity(
  db: BetterSqliteDatabase,
  provider: string,
  subject: string,
): (IdentityRow & { userId: string }) | null {
  const row = db
    .prepare(
      `SELECT user_id, subject, email_at_link
         FROM user_identities
        WHERE provider = ? AND subject = ?`,
    )
    .get(provider, subject) as IdentityRow | undefined;
  return row ? { ...row, userId: row.user_id } : null;
}

function touchIdentity(
  db: BetterSqliteDatabase,
  provider: string,
  subject: string,
): void {
  db.prepare(
    `UPDATE user_identities
        SET last_login_at = ?
      WHERE provider = ? AND subject = ?`,
  ).run(nowIso(), provider, subject);
}

export function linkIdentity(
  db: BetterSqliteDatabase,
  userId: string,
  provider: string,
  subject: string,
  email: string,
): void {
  const subjectOwner = findIdentity(db, provider, subject);
  if (subjectOwner && subjectOwner.userId !== userId) {
    throw new OidcLoginError(
      'account_conflict',
      'This PocketID account is already linked to a different Kapo account.',
    );
  }
  if (subjectOwner) {
    touchIdentity(db, provider, subject);
    return;
  }

  const userLink = db
    .prepare(
      'SELECT subject FROM user_identities WHERE provider = ? AND user_id = ?',
    )
    .get(provider, userId) as { subject: string } | undefined;
  if (userLink) {
    throw new OidcLoginError(
      'account_conflict',
      'This Kapo account is already linked to a different PocketID account.',
    );
  }

  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO user_identities (
         id, user_id, provider, subject, email_at_link, created_at, last_login_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), userId, provider, subject, email, now, now);
  } catch {
    throw new OidcLoginError(
      'account_conflict',
      'This PocketID account could not be linked.',
    );
  }
}

export interface ResolveOidcUserOptions {
  autoProvision: boolean;
}

export async function resolveOidcUser(
  db: BetterSqliteDatabase,
  provider: string,
  claims: OidcClaims,
  options: ResolveOidcUserOptions,
): Promise<ResolvedOidcUser> {
  // A known subject is authoritative even when the email later changes.
  const existing = findIdentity(db, provider, claims.subject);
  if (existing) {
    const user = findUserById(db, existing.userId);
    if (user) {
      touchIdentity(db, provider, claims.subject);
      return { user, created: false };
    }
    // The FK cascade should make this impossible; heal a dangling row.
    db.prepare('DELETE FROM user_identities WHERE provider = ? AND subject = ?').run(
      provider,
      claims.subject,
    );
  }

  const email = normalizeEmail(claims.email ?? '');
  if (!email) {
    throw new OidcLoginError(
      'email_required',
      'PocketID did not provide an email address.',
    );
  }
  if (validateEmail(email)) {
    throw new OidcLoginError('email_invalid', 'PocketID provided an invalid email address.');
  }
  if (claims.emailVerified === false) {
    throw new OidcLoginError(
      'email_not_verified',
      'PocketID has not verified this email address.',
    );
  }

  const matches = db
    .prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE')
    .all(email) as Array<{ id: string }>;
  if (matches.length > 1) {
    throw new OidcLoginError(
      'email_ambiguous',
      'More than one Kapo account uses this email address.',
    );
  }

  if (matches.length === 1) {
    const userId = matches[0]!.id;
    const user = findUserById(db, userId);
    if (!user) {
      throw new OidcLoginError('account_not_found', 'The matching account no longer exists.');
    }
    linkIdentity(db, userId, provider, claims.subject, email);
    return { user, created: false };
  }

  if (!options.autoProvision) {
    throw new OidcLoginError(
      'account_not_found',
      'No Kapo account matches this email address.',
    );
  }

  const username = generateUsername(db, claims.preferredUsername, email);
  let created: AccountUser;
  try {
    created = await createSsoUser(db, {
      username,
      email,
      appRole: 'viewer',
      provider,
      subject: claims.subject,
    });
  } catch (error) {
    if (error instanceof AccountError && error.code === 'account_conflict') {
      throw new OidcLoginError('account_conflict', error.message);
    }
    throw error;
  }

  const user = findUserById(db, created.id);
  if (!user) {
    throw new OidcLoginError('account_not_found', 'The new account could not be loaded.');
  }
  return { user, created: true };
}
