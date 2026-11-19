import type { RequestCookie } from 'next/dist/compiled/@edge-runtime/cookies';

/**
 * Stand-in for next/headers inside vitest.
 *
 * Route handlers import `cookies()` / `headers()` from next/headers. Outside a
 * Next.js request scope those throw, so API tests install `vi.mock` for
 * next/headers and drive this module instead. `headersJar` is populated from
 * the Request being handed to the handler.
 */

interface CookieEntry {
  name: string;
  value: string;
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  path?: string;
  maxAge?: number;
  expires?: Date;
}

export interface CookieSetOptions {
  name: string;
  value: string;
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  path?: string;
  maxAge?: number;
  expires?: Date;
}

function normalizeSetOptions(
  nameOrOptions: string | CookieSetOptions,
  value?: string,
): CookieSetOptions {
  if (typeof nameOrOptions === 'string') {
    return { name: nameOrOptions, value: value ?? '' };
  }
  return nameOrOptions;
}

class TestCookieStore {
  private readonly entries = new Map<string, CookieEntry>();

  get(name: string): CookieEntry | undefined {
    return this.entries.get(name);
  }

  getAll(): CookieEntry[] {
    return [...this.entries.values()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  set(
    nameOrOptions: string | CookieSetOptions,
    value?: string,
  ): this {
    const options = normalizeSetOptions(nameOrOptions, value);
    this.entries.set(options.name, { ...options, name: options.name });
    return this;
  }

  delete(name: string): this {
    this.entries.delete(name);
    return this;
  }

  clear(): this {
    this.entries.clear();
    return this;
  }

  toString(): string {
    return [...this.entries.values()].map((entry) => `${entry.name}=${entry.value}`).join('; ');
  }

  get size(): number {
    return this.entries.size;
  }
}

export const cookieJar = new TestCookieStore();
export let headerJar = new Headers();

export function setRequestHeaders(headers: Headers): void {
  headerJar = headers;
}

export function resetRequestContext(): void {
  cookieJar.clear();
  headerJar = new Headers();
}

/** Builds a Request the same way the browser would, headers included. */
export function makeRequest(
  input: string | URL,
  init: RequestInit & { cookies?: Record<string, string> } = {},
): Request {
  const url = typeof input === 'string' ? new URL(input, 'http://localhost') : input;
  const headers = new Headers(init.headers);
  if (!headers.has('host')) headers.set('host', url.host);
  const { cookies, ...rest } = init;
  if (cookies) {
    headers.set(
      'cookie',
      Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    );
  }
  const request = new Request(url, { ...rest, headers });
  // Fetch populates these from the URL; route handlers read them via headers().
  setRequestHeaders(request.headers);
  return request;
}

export function jsonRequest(
  url: string,
  body: unknown,
  options: { method?: string; cookies?: Record<string, string>; headers?: HeadersInit; origin?: string } = {},
): Request {
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  const origin = options.origin ?? 'http://localhost';
  headers.set('origin', origin);
  return makeRequest(url, {
    method: options.method ?? 'POST',
    body: JSON.stringify(body),
    headers,
    cookies: options.cookies,
  });
}

export function requestCookies(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of cookieJar.getAll()) result[entry.name] = entry.value;
  return result;
}

/** Type used by next/headers' cookies(); kept for readability in tests. */
export type { CookieEntry, RequestCookie };
