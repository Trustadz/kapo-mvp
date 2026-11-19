/**
 * Shared validation rules. Used by client forms for instant feedback and by
 * route handlers as the authoritative check.
 */

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

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (!username) return 'Enter a username.';
  if (username.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (username.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(username)) {
    return 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number.';
  }
  return null;
}

export function validateEmail(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email) return 'Enter an email address.';
  if (email.length > EMAIL_MAX) return 'Email address is too long.';
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Enter a password.';
  if (value.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (value.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return null;
}

export function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  if (!confirmation) return 'Confirm your password.';
  if (password !== confirmation) return 'Passwords do not match.';
  return null;
}

export function validateProjectTitle(value: string): string | null {
  const title = value.trim();
  if (!title) return 'Enter a project title.';
  if (title.length > PROJECT_TITLE_MAX) return `Title must be at most ${PROJECT_TITLE_MAX} characters.`;
  return null;
}

/** Trim + collapse internal whitespace for titles and names. */
export function cleanTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
