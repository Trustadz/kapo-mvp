import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { SESSION_COOKIE } from '@/server/auth/cookies';
import { createSession } from '@/server/auth/session';
import { cookieJar } from './request-context';

/**
 * Shared helpers for route-handler API tests.
 *
 * Tests mock next/headers (see the individual test files) so the real handlers
 * run against the suite database; the cookie jar stands in for the browser.
 */

export function signIn(db: BetterSqliteDatabase, userId: string): string {
  const session = createSession(db, userId);
  cookieJar.set({
    name: SESSION_COOKIE,
    value: session.token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return session.token;
}

export function signOut(): void {
  cookieJar.clear();
}

export function sessionToken(): string | null {
  return cookieJar.get(SESSION_COOKIE)?.value ?? null;
}

/** Builds a same-origin JSON Request for a route handler. */
export function request(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({
    host: 'localhost',
    origin: 'http://localhost',
    'content-type': 'application/json',
    ...options.headers,
  });
  return new Request(new URL(url, 'http://localhost'), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** Parses a NextResponse JSON body. */
export async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export type RouteParams = { params: Promise<{ id: string }> };

export function params(id: string): RouteParams {
  return { params: Promise.resolve({ id }) };
}

/** Second argument for apiRoute handlers that take no route params. */
export const EMPTY_CONTEXT: { params: Promise<Record<string, string>> } = {
  params: Promise.resolve({}),
};
