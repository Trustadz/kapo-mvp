import { cookies, headers } from 'next/headers';
import type { Appearance } from '@/lib/types';
import { APPEARANCES } from '@/lib/types';

/**
 * Cookie helpers. Next 16 exposes `cookies()` asynchronously; these helpers are
 * server-only and must be called from route handlers, server actions or
 * server components.
 */

export const SESSION_COOKIE = 'kapo_session';
/** Non-httpOnly mirror of the user preference so the pre-paint script can read it. */
export const APPEARANCE_COOKIE = 'kapo_appearance';
/** Short-lived OIDC state/nonce/PKCE transaction, scoped to the SSO routes. */
export const OIDC_TRANSACTION_COOKIE = 'kapo_oidc_txn';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const APPEARANCE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const OIDC_TRANSACTION_MAX_AGE_SECONDS = 10 * 60;
const OIDC_TRANSACTION_PATH = '/api/auth/pocketid';

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token && token.length > 0 ? token : null;
}

function secureCookieRequired(https: boolean): boolean {
  return process.env.NODE_ENV === 'production' && https;
}

async function requestIsHttps(): Promise<boolean> {
  if (process.env.KAPO_FORCE_SECURE_COOKIES === '1') return true;
  const requestHeaders = await headers();
  const proto = requestHeaders.get('x-forwarded-proto');
  return proto?.split(',')[0]?.trim() === 'https';
}

export async function setSessionCookie(token: string, expiresAt: string): Promise<void> {
  const https = await requestIsHttps();
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieRequired(https),
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const https = await requestIsHttps();
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieRequired(https),
    path: '/',
    maxAge: 0,
  });
}

export async function readOidcTransactionCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(OIDC_TRANSACTION_COOKIE)?.value;
  return value && value.length > 0 ? value : null;
}

export async function setOidcTransactionCookie(value: string): Promise<void> {
  const https = await requestIsHttps();
  const store = await cookies();
  store.set({
    name: OIDC_TRANSACTION_COOKIE,
    value,
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieRequired(https),
    path: OIDC_TRANSACTION_PATH,
    maxAge: OIDC_TRANSACTION_MAX_AGE_SECONDS,
  });
}

export async function clearOidcTransactionCookie(): Promise<void> {
  const https = await requestIsHttps();
  const store = await cookies();
  // Expire it with the same path used by setOidcTransactionCookie; a path-less
  // delete would leave the scoped cookie in the browser.
  store.set({
    name: OIDC_TRANSACTION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieRequired(https),
    path: OIDC_TRANSACTION_PATH,
    maxAge: 0,
  });
}

export function parseAppearance(value: string | null | undefined): Appearance | null {
  if (!value) return null;
  return (APPEARANCES as readonly string[]).includes(value) ? (value as Appearance) : null;
}

export async function readAppearanceCookie(): Promise<Appearance | null> {
  const store = await cookies();
  return parseAppearance(store.get(APPEARANCE_COOKIE)?.value);
}

export async function setAppearanceCookie(appearance: Appearance): Promise<void> {
  const store = await cookies();
  store.set({
    name: APPEARANCE_COOKIE,
    value: appearance,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: APPEARANCE_MAX_AGE_SECONDS,
  });
}
