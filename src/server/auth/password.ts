import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing with node:crypto scrypt.
 *
 * Format: scrypt$<N>$<r>$<p>$<salt base64url>$<derived key base64url>
 * The parameters travel with the hash so they can be raised later without
 * invalidating existing passwords.
 */

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };
type ScryptAsync = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const scrypt = promisify(scryptCallback) as unknown as ScryptAsync;

interface ParsedHash {
  options: ScryptOptions;
  salt: Buffer;
  derived: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, rawN, rawR, rawP, rawSalt, rawDerived] = parts;
  if (!rawN || !rawR || !rawP || !rawSalt || !rawDerived) return null;
  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (n < 1024 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  try {
    const salt = Buffer.from(rawSalt, 'base64url');
    const derived = Buffer.from(rawDerived, 'base64url');
    if (salt.length < 8 || derived.length < 16) return null;
    return { options: { N: n, r, p, maxmem: MAX_MEMORY }, salt, derived };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY,
  });
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  try {
    const derived = await scrypt(password, parsed.salt, parsed.derived.length, parsed.options);
    if (derived.length !== parsed.derived.length) return false;
    return timingSafeEqual(derived, parsed.derived);
  } catch {
    return false;
  }
}

/** Constant-ish shape check used before doing expensive work. */
export function isPasswordHash(value: string): boolean {
  return parseHash(value) !== null;
}
