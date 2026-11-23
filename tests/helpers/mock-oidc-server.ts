import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

/**
 * Minimal OpenID Connect provider used by integration tests and the Playwright
 * SSO smoke test. It implements discovery, the authorization-code flow with
 * PKCE, an RS256 ID token and a JWKS endpoint, which is enough for
 * openid-client to validate a real sign-in without a PocketID container.
 *
 * This file is test-only and is intentionally dependency-free.
 */

export interface MockOidcUser {
  sub: string;
  email: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
  picture?: string;
}

/** A valid 1x1 PNG used by the mock avatar endpoint and tests. */
export const MOCK_AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export interface MockOidcServer {
  url: string;
  setUser(user: MockOidcUser): void;
  getUser(): MockOidcUser;
  close(): Promise<void>;
}

interface AuthorizationCode {
  codeChallenge: string;
  clientId: string;
  nonce: string | null;
  redirectUri: string;
  user: MockOidcUser;
}

const DEFAULT_USER: MockOidcUser = {
  sub: 'mock-admin-sub',
  email: 'admin@example.com',
  email_verified: true,
  preferred_username: 'admin',
  name: 'Admin',
};

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (!name) continue;
    result[name] = decodeURIComponent(rest.join('='));
  }
  return result;
}

export async function startMockOidcServer(
  options: { port?: number; user?: MockOidcUser } = {},
): Promise<MockOidcServer> {
  let issuer = '';
  let currentUser: MockOidcUser = { ...(options.user ?? DEFAULT_USER) };
  const codes = new Map<string, AuthorizationCode>();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const kid = 'mock-oidc-key';
  const publicJwk = {
    ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
    kid,
    alg: 'RS256',
    use: 'sig',
  };

  function signIdToken(claims: Record<string, unknown>): string {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const payload = base64url(JSON.stringify(claims));
    const input = `${header}.${payload}`;
    const signature = sign('RSA-SHA256', Buffer.from(input), privateKey);
    return `${input}.${signature.toString('base64url')}`;
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', issuer || 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('ok');
        return;
      }

      if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        json(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          scopes_supported: ['openid', 'profile', 'email'],
          token_endpoint_auth_methods_supported: [
            'client_secret_post',
            'client_secret_basic',
            'none',
          ],
          code_challenge_methods_supported: ['S256'],
          claims_supported: [
            'sub',
            'iss',
            'aud',
            'exp',
            'iat',
            'nonce',
            'email',
            'email_verified',
            'preferred_username',
            'name',
            'picture',
          ],
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/jwks') {
        json(response, 200, { keys: [publicJwk] });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/avatar') {
        response.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(MOCK_AVATAR_PNG.length),
          'cache-control': 'no-store',
        });
        response.end(MOCK_AVATAR_PNG);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/avatar-not-an-image') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('not an image');
        return;
      }

      if (request.method === 'GET' && url.pathname === '/authorize') {
        const redirectUri = url.searchParams.get('redirect_uri');
        const state = url.searchParams.get('state');
        const nonce = url.searchParams.get('nonce');
        const codeChallenge = url.searchParams.get('code_challenge');
        const clientId = url.searchParams.get('client_id');
        if (!redirectUri || !codeChallenge || !clientId) {
          json(response, 400, { error: 'invalid_request' });
          return;
        }
        const code = randomBytes(24).toString('base64url');
        codes.set(code, {
          codeChallenge,
          clientId,
          nonce,
          redirectUri,
          user: { ...currentUser },
        });
        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        if (state) target.searchParams.set('state', state);
        response.writeHead(302, { location: target.toString() });
        response.end();
        return;
      }

      if (request.method === 'POST' && url.pathname === '/token') {
        const form = new URLSearchParams(await readBody(request));
        const code = form.get('code') ?? '';
        const verifier = form.get('code_verifier') ?? '';
        const record = codes.get(code);
        if (!record) {
          json(response, 400, { error: 'invalid_grant', error_description: 'Unknown code' });
          return;
        }
        codes.delete(code);
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (challenge !== record.codeChallenge) {
          json(response, 400, {
            error: 'invalid_grant',
            error_description: 'PKCE verification failed',
          });
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        const idToken = signIdToken({
          iss: issuer,
          sub: record.user.sub,
          aud: record.clientId,
          iat: now,
          exp: now + 3600,
          ...(record.nonce ? { nonce: record.nonce } : {}),
          email: record.user.email,
          email_verified: record.user.email_verified ?? true,
          preferred_username: record.user.preferred_username ?? 'user',
          ...(record.user.name ? { name: record.user.name } : {}),
          ...(record.user.picture ? { picture: record.user.picture } : {}),
        });
        json(response, 200, {
          access_token: `mock-access-${randomBytes(12).toString('base64url')}`,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/userinfo') {
        const authorization = request.headers.authorization ?? '';
        if (!authorization.startsWith('Bearer ')) {
          json(response, 401, { error: 'invalid_token' });
          return;
        }
        json(response, 200, {
          sub: currentUser.sub,
          email: currentUser.email,
          email_verified: currentUser.email_verified ?? true,
          preferred_username: currentUser.preferred_username ?? 'user',
          ...(currentUser.name ? { name: currentUser.name } : {}),
          ...(currentUser.picture ? { picture: currentUser.picture } : {}),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/__test/user') {
        const body = JSON.parse((await readBody(request)) || '{}') as Partial<MockOidcUser>;
        if (typeof body.sub !== 'string' || typeof body.email !== 'string') {
          json(response, 400, { error: 'invalid_user' });
          return;
        }
        currentUser = {
          sub: body.sub,
          email: body.email,
          email_verified: body.email_verified ?? true,
          preferred_username: body.preferred_username,
          name: body.name,
          picture: body.picture,
        };
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/__test/cookies') {
        json(response, 200, { cookies: parseCookies(request) });
        return;
      }

      json(response, 404, { error: 'not_found' });
    } catch (error) {
      console.error('[mock-oidc] request failed', error);
      if (!response.headersSent) json(response, 500, { error: 'server_error' });
      else response.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port ?? 0;
  issuer = `http://localhost:${port}`;

  return {
    url: issuer,
    setUser(user) {
      currentUser = { ...user };
    },
    getUser() {
      return { ...currentUser };
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
