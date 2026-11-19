import { NextResponse } from 'next/server';

/**
 * Shared JSON route-handler helpers (build-spec §7).
 *
 * Errors always use `{ error: { code, message, fields? } }`. Mutating routes
 * must call `isSameOrigin` before touching the database.
 */

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): NextResponse<ApiErrorPayload> {
  const payload: ApiErrorPayload = {
    error: fields && Object.keys(fields).length > 0 ? { code, message, fields } : { code, message },
  };
  return NextResponse.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export function methodNotAllowed(allow: readonly string[]): NextResponse<ApiErrorPayload> {
  const response = jsonError(405, 'method_not_allowed', 'Method not allowed.');
  response.headers.set('allow', allow.join(', '));
  return response;
}

/**
 * CSRF defence for mutating requests: Origin/Host equality plus the browser's
 * Sec-Fetch-Site hint. SameSite=Lax on the session cookie is the second layer.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}

export function rejectCrossOrigin(): NextResponse<ApiErrorPayload> {
  return jsonError(403, 'csrf_rejected', 'Cross-origin request rejected.');
}

export type JsonBodyResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: NextResponse<ApiErrorPayload> };

/** Reads a JSON object body; rejects non-object payloads and malformed JSON. */
export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return {
      ok: false,
      response: jsonError(400, 'invalid_json', 'Request body must be valid JSON.'),
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      response: jsonError(400, 'invalid_body', 'Request body must be a JSON object.'),
    };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}

export function readStringField(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  return typeof value === 'string' ? value : '';
}
