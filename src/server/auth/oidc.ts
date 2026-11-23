import { NextResponse } from 'next/server';
import * as client from 'openid-client';

/**
 * PocketID / OpenID Connect configuration for Kapo.
 *
 * SSO is configured entirely through environment variables so the client
 * secret never lands in the SQLite database or its backups:
 *
 *   KAPO_OIDC_ISSUER          e.g. https://id.example.com
 *   KAPO_OIDC_CLIENT_ID       OIDC client id created in PocketID
 *   KAPO_OIDC_CLIENT_SECRET   optional: leave empty for a public client + PKCE
 *   KAPO_OIDC_SCOPES          default "openid profile email"
 *   KAPO_OIDC_PROVIDER_NAME   button label, default "PocketID"
 *   KAPO_OIDC_AUTO_PROVISION  default on; unmatched emails become Viewers
 *   KAPO_OIDC_ALLOW_INSECURE  local testing only: allow an http:// issuer
 *   KAPO_PASSWORD_LOGIN       set to "disabled" to hide/disable password login
 *   KAPO_PUBLIC_URL           absolute public origin used for the callback URL
 *   SESSION_SECRET            optional HMAC key for the short-lived OIDC cookie
 *
 * Password login is kept enabled when OIDC is missing even if the operator
 * asked to disable it: otherwise a typo in one variable would lock the
 * household out of its own installation.
 */

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];
const DEFAULT_PROVIDER_NAME = 'PocketID';
const DISCOVERY_TIMEOUT_MS = 10_000;

export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  scopes: string;
  providerName: string;
  passwordLoginEnabled: boolean;
  autoProvision: boolean;
  allowInsecure: boolean;
  publicUrl: string | null;
}

export class OidcLoginError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OidcLoginError';
    this.code = code;
  }
}

function isTruthyFlag(raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function isDisabledFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === 'disabled' || value === 'false' || value === '0' || value === 'off';
}

function normalizeBaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function normalizeScopes(raw: string | undefined): string {
  const requested = raw?.trim()
    ? raw
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    : DEFAULT_SCOPES;
  const unique: string[] = [];
  for (const scope of requested) {
    if (!unique.includes(scope)) unique.push(scope);
  }
  if (!unique.includes('openid')) unique.unshift('openid');
  return unique.join(' ');
}

/**
 * Reads the current SSO configuration. Values are read on every call so tests
 * (and a restart after changing the container environment) see the fresh
 * values; reading a handful of environment strings is cheap.
 */
export function getOidcConfig(): OidcConfig {
  const rawIssuer = process.env.KAPO_OIDC_ISSUER?.trim() ?? '';
  const normalizedIssuer = normalizeBaseUrl(rawIssuer);
  const clientId = process.env.KAPO_OIDC_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.KAPO_OIDC_CLIENT_SECRET?.trim() || null;
  const providerName =
    process.env.KAPO_OIDC_PROVIDER_NAME?.trim() || DEFAULT_PROVIDER_NAME;
  const autoProvision = isTruthyFlag(process.env.KAPO_OIDC_AUTO_PROVISION, true);
  const allowInsecure = isTruthyFlag(process.env.KAPO_OIDC_ALLOW_INSECURE, false);
  const requestedPasswordLogin = !isDisabledFlag(process.env.KAPO_PASSWORD_LOGIN);
  const rawPublicUrl = process.env.KAPO_PUBLIC_URL?.trim() ?? '';
  const publicUrl = normalizeBaseUrl(rawPublicUrl);

  if (rawIssuer && !normalizedIssuer) {
    console.warn('[oidc] KAPO_OIDC_ISSUER must be an http(s) URL; SSO is disabled.');
  }
  if (normalizedIssuer?.startsWith('http://') && !allowInsecure) {
    console.warn(
      '[oidc] KAPO_OIDC_ISSUER uses http://; set KAPO_OIDC_ALLOW_INSECURE=1 only for local testing or use HTTPS. SSO is disabled.',
    );
  }
  if (rawPublicUrl && !publicUrl) {
    console.warn(
      '[oidc] KAPO_PUBLIC_URL must be an http(s) URL; the request origin will be used for redirects.',
    );
  }

  const issuer =
    normalizedIssuer?.startsWith('http://') && !allowInsecure
      ? null
      : normalizedIssuer;
  const enabled = Boolean(issuer && clientId);
  if (issuer && !clientId) {
    console.warn('[oidc] KAPO_OIDC_CLIENT_ID is required; SSO is disabled.');
  }

  let passwordLoginEnabled = requestedPasswordLogin;
  if (!enabled && !requestedPasswordLogin) {
    console.error(
      '[oidc] KAPO_PASSWORD_LOGIN is disabled but OIDC is not configured; keeping password login enabled to avoid lockout.',
    );
    passwordLoginEnabled = true;
  }

  return {
    enabled,
    issuer: issuer ?? '',
    clientId,
    clientSecret,
    scopes: normalizeScopes(process.env.KAPO_OIDC_SCOPES),
    providerName,
    passwordLoginEnabled,
    autoProvision,
    allowInsecure,
    publicUrl,
  };
}

interface CachedClient {
  key: string;
  configuration: client.Configuration;
}

let cachedClient: CachedClient | null = null;

/**
 * Discovers and caches the provider metadata. The cache is per process and
 * keyed by the full connection identity, so changing the issuer rotates it.
 */
export async function getOidcClient(config: OidcConfig): Promise<client.Configuration> {
  if (!config.enabled) {
    throw new OidcLoginError('sso_unavailable', 'OIDC is not configured.');
  }
  const key = `${config.issuer}|${config.clientId}|${config.clientSecret ?? ''}|${config.allowInsecure ? 'insecure' : 'secure'}`;
  if (cachedClient?.key === key) return cachedClient.configuration;

  const configuration = await client.discovery(
    new URL(config.issuer),
    config.clientId,
    config.clientSecret ?? undefined,
    config.clientSecret ? undefined : client.None(),
    config.allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
  );
  configuration.timeout = DISCOVERY_TIMEOUT_MS;
  cachedClient = { key, configuration };
  return configuration;
}

/** Test helper; avoids a stale discovery result leaking between suites. */
export function resetOidcClientCacheForTests(): void {
  cachedClient = null;
}

export function oidcRedirectUri(config: OidcConfig, request: Request): string {
  const base = config.publicUrl ?? new URL(request.url).origin;
  return new URL('/api/auth/pocketid/callback', base).toString();
}

export interface OidcClaims {
  subject: string;
  email: string | null;
  emailVerified: boolean | null;
  preferredUsername: string | null;
}

/** Reads the handful of claims Kapo needs without trusting their shape. */
export function mapOidcClaims(claims: Record<string, unknown>): OidcClaims {
  const subject = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (!subject) {
    throw new OidcLoginError('invalid_claims', 'The ID token has no subject.');
  }
  return {
    subject,
    email: typeof claims.email === 'string' ? claims.email.trim() : null,
    emailVerified:
      typeof claims.email_verified === 'boolean' ? claims.email_verified : null,
    preferredUsername:
      typeof claims.preferred_username === 'string'
        ? claims.preferred_username.trim()
        : null,
  };
}

/** The public origin the browser should stay on after a redirect. */
export function appBaseUrl(config: OidcConfig, request: Request): string {
  return config.publicUrl ?? new URL(request.url).origin;
}

/** Sends the browser back to the login page with a stable, non-sensitive code. */
export function oidcErrorRedirect(request: Request, code: string): NextResponse {
  const url = new URL('/login', appBaseUrl(getOidcConfig(), request));
  url.searchParams.set('error', code);
  return NextResponse.redirect(url);
}
