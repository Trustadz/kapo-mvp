import { describe, expect, it } from 'vitest';
import {
  clientIp,
  isSameOrigin,
  jsonError,
  jsonOk,
  methodNotAllowed,
  readJsonBody,
  readStringField,
  rejectCrossOrigin,
} from '@/server/http';

/**
 * HTTP/CSRF conventions (build-spec §7): JSON only, same-origin check on
 * mutating requests, `{ error: { code, message, fields? } }` payloads.
 */

function request(headers: Record<string, string>, url = 'http://localhost/api/test'): Request {
  return new Request(url, { method: 'POST', headers });
}

describe('isSameOrigin (CSRF)', () => {
  it('accepts a matching Origin and Host', () => {
    expect(isSameOrigin(request({ host: 'kapo.local', origin: 'https://kapo.local' }))).toBe(true);
    expect(isSameOrigin(request({ host: 'localhost:3000', origin: 'http://localhost:3000' }))).toBe(
      true,
    );
  });

  it('rejects a cross-site Origin', () => {
    expect(isSameOrigin(request({ host: 'kapo.local', origin: 'https://evil.example' }))).toBe(
      false,
    );
    expect(
      isSameOrigin(request({ host: 'kapo.local:3000', origin: 'http://kapo.local:3001' })),
    ).toBe(false);
  });

  it('rejects an unparseable Origin', () => {
    expect(isSameOrigin(request({ host: 'kapo.local', origin: 'not a url' }))).toBe(false);
  });

  it('falls back to Sec-Fetch-Site when there is no Origin', () => {
    expect(isSameOrigin(request({ host: 'kapo.local', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOrigin(request({ host: 'kapo.local', 'sec-fetch-site': 'none' }))).toBe(true);
    expect(isSameOrigin(request({ host: 'kapo.local', 'sec-fetch-site': 'cross-site' }))).toBe(
      false,
    );
    expect(isSameOrigin(request({ host: 'kapo.local', 'sec-fetch-site': 'same-site' }))).toBe(
      false,
    );
  });

  it('allows a plain server-to-server request with no browser hints', () => {
    expect(isSameOrigin(request({ host: 'kapo.local' }))).toBe(true);
  });

  it('returns a 403 JSON error for cross-origin mutations', async () => {
    const response = rejectCrossOrigin();
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('csrf_rejected');
    expect(body.error.message).toMatch(/cross-origin/i);
  });
});

describe('JSON helpers', () => {
  it('marks successful responses no-store', async () => {
    const response = jsonOk({ hello: 'world' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ hello: 'world' });
  });

  it('shapes errors as { error: { code, message, fields? } }', async () => {
    const plain = jsonError(401, 'unauthorized', 'Sign in required.');
    expect(plain.status).toBe(401);
    expect(await plain.json()).toEqual({
      error: { code: 'unauthorized', message: 'Sign in required.' },
    });

    const withFields = jsonError(422, 'validation_failed', 'Check fields.', {
      title: 'Enter a title.',
    });
    expect(await withFields.json()).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Check fields.',
        fields: { title: 'Enter a title.' },
      },
    });
  });

  it('omits an empty fields object', async () => {
    const response = jsonError(400, 'invalid', 'Bad.', {});
    const body = (await response.json()) as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty('fields');
  });

  it('answers 405 with an Allow header', () => {
    const response = methodNotAllowed(['POST']);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

describe('request body parsing', () => {
  const json = (body: string): Request =>
    new Request('http://localhost/api/test', { method: 'POST', body });

  it('parses a JSON object body', async () => {
    const result = await readJsonBody(json(JSON.stringify({ title: 'Hi' })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ title: 'Hi' });
  });

  it('rejects malformed JSON with a 400', async () => {
    const result = await readJsonBody(json('{not json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = (await result.response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('invalid_json');
    }
  });

  it('rejects arrays and primitives with a 400', async () => {
    for (const payload of ['[]', '"text"', '42', 'null']) {
      const result = await readJsonBody(json(payload));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(400);
    }
  });

  it('reads string fields and ignores other types', () => {
    expect(readStringField({ title: 'Hello' }, 'title')).toBe('Hello');
    expect(readStringField({ title: 42 }, 'title')).toBe('');
    expect(readStringField({}, 'title')).toBe('');
  });

  it('extracts the client IP from forwarded headers', () => {
    expect(
      clientIp(request({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })),
    ).toBe('203.0.113.7');
    expect(clientIp(request({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(request({}))).toBeNull();
  });
});
