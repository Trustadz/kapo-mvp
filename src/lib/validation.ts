/**
 * Shared validation rules. Used by client forms for instant feedback and by
 * route handlers as the authoritative check. The optional locale only changes
 * the returned message text; route handlers keep the English default so API
 * payloads stay stable.
 */
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import { t } from '@/i18n/translate';

export interface FieldErrors {
  [field: string]: string;
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const EMAIL_MAX = 254;
export const PROJECT_TITLE_MAX = 200;

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Deliberately permissive: the product stores email without verification.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeUsername(value: string): string {
  return value.trim();
}

export function normalizeEmail(value: string): string {
  return value.trim();
}

export function validateUsername(value: string, locale: Locale = DEFAULT_LOCALE): string | null {
  const username = normalizeUsername(value);
  if (!username) return t(locale, 'validation.usernameRequired');
  if (username.length < USERNAME_MIN) {
    return t(locale, 'validation.usernameMin', { min: USERNAME_MIN });
  }
  if (username.length > USERNAME_MAX) {
    return t(locale, 'validation.usernameMax', { max: USERNAME_MAX });
  }
  if (!USERNAME_PATTERN.test(username)) {
    return t(locale, 'validation.usernamePattern');
  }
  return null;
}

export function validateEmail(value: string, locale: Locale = DEFAULT_LOCALE): string | null {
  const email = normalizeEmail(value);
  if (!email) return t(locale, 'validation.emailRequired');
  if (email.length > EMAIL_MAX) return t(locale, 'validation.emailTooLong');
  if (!EMAIL_PATTERN.test(email)) return t(locale, 'validation.emailInvalid');
  return null;
}

export function validatePassword(value: string, locale: Locale = DEFAULT_LOCALE): string | null {
  if (!value) return t(locale, 'validation.passwordRequired');
  if (value.length < PASSWORD_MIN) {
    return t(locale, 'validation.passwordMin', { min: PASSWORD_MIN });
  }
  if (value.length > PASSWORD_MAX) {
    return t(locale, 'validation.passwordMax', { max: PASSWORD_MAX });
  }
  return null;
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (!confirmation) return t(locale, 'validation.confirmationRequired');
  if (password !== confirmation) return t(locale, 'validation.passwordsMismatch');
  return null;
}

export function validateProjectTitle(value: string, locale: Locale = DEFAULT_LOCALE): string | null {
  const title = value.trim();
  if (!title) return t(locale, 'validation.projectTitleRequired');
  if (title.length > PROJECT_TITLE_MAX) {
    return t(locale, 'validation.projectTitleMax', { max: PROJECT_TITLE_MAX });
  }
  return null;
}

/** Trim + collapse internal whitespace for titles and names. */
export function cleanTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
