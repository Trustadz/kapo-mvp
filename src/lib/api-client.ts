/** Client-side JSON fetch helper matching build-spec §7 error shape. */
import { readLocaleCookie } from '@/i18n/cookie';
import { t } from '@/i18n/translate';

export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  init?: Omit<RequestInit, 'method' | 'body' | 'headers'>,
): Promise<ApiResult<T>> {
  return requestJson<T>(url, {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patchJson<T = unknown>(
  url: string,
  body: unknown,
  init?: Omit<RequestInit, 'method' | 'body' | 'headers'>,
): Promise<ApiResult<T>> {
  return requestJson<T>(url, {
    ...init,
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function requestJson<T = unknown>(
  url: string,
  init: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'network_error',
      message: t(readLocaleCookie(), 'common.networkError'),
    };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    return { ok: true, data: payload as T };
  }

  const errorBody =
    isRecord(payload) && isRecord(payload.error) ? (payload.error as Record<string, unknown>) : null;
  const fields: Record<string, string> = {};
  if (errorBody && isRecord(errorBody.fields)) {
    for (const [key, value] of Object.entries(errorBody.fields)) {
      if (typeof value === 'string') fields[key] = value;
    }
  }

  return {
    ok: false,
    status: response.status,
    code: typeof errorBody?.code === 'string' ? errorBody.code : 'request_failed',
    message:
      typeof errorBody?.message === 'string'
        ? errorBody.message
        : t(readLocaleCookie(), 'common.genericError'),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}
