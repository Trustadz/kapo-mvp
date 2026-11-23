import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived OIDC transaction data (state, nonce, PKCE verifier).
 *
 * The values travel in an httpOnly, SameSite=Lax cookie signed with HMAC so a
 * tampered cookie is rejected before it reaches the token endpoint. Set
 * SESSION_SECRET to keep the signing key stable across restarts; without it a
 * per-process random key is used, which only invalidates in-flight sign-ins.
 */

export const OIDC_TRANSACTION_MAX_AGE_SECONDS = 10 * 60;
const OIDC_TRANSACTION_MAX_AGE_MS = OIDC_TRANSACTION_MAX_AGE_SECONDS * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

export interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

const signingKey =
  process.env.SESSION_SECRET?.trim() || randomBytes(32).toString('base64url');

function signatureFor(payload: string): string {
  return createHmac('sha256', signingKey).update(payload).digest('base64url');
}

export function signOidcTransaction(transaction: OidcTransaction): string {
  const payload = Buffer.from(JSON.stringify(transaction), 'utf8').toString(
    'base64url',
  );
  return `${payload}.${signatureFor(payload)}`;
}

export function verifyOidcTransaction(
  value: string | null | undefined,
  now: number = Date.now(),
): OidcTransaction | null {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = signatureFor(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const { state, nonce, codeVerifier, createdAt } = record;
  if (
    typeof state !== 'string' ||
    state.length === 0 ||
    typeof nonce !== 'string' ||
    nonce.length === 0 ||
    typeof codeVerifier !== 'string' ||
    codeVerifier.length === 0 ||
    typeof createdAt !== 'number' ||
    !Number.isFinite(createdAt)
  ) {
    return null;
  }
  if (createdAt > now + CLOCK_SKEW_MS || now - createdAt > OIDC_TRANSACTION_MAX_AGE_MS) {
    return null;
  }
  return { state, nonce, codeVerifier, createdAt };
}
