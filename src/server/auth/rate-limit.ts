/**
 * Small in-memory login throttle.
 *
 * Kapo serves a single household, so a per-process limiter is an appropriate
 * defence-in-depth measure in front of scrypt's own cost. It resets on restart
 * and is not a replacement for HTTPS or a reverse-proxy rate limit.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_KEYS = 5_000;

interface Attempt {
  failures: number;
  windowStartedAt: number;
  lastAttemptAt: number;
}

const attempts = new Map<string, Attempt>();

function prune(now: number): void {
  if (attempts.size <= MAX_KEYS) return;
  for (const [key, attempt] of attempts) {
    if (now - attempt.lastAttemptAt > WINDOW_MS) attempts.delete(key);
  }
}

export function loginAttemptKey(username: string, ip: string | null): string {
  return `${username.trim().toLowerCase()}|${ip ?? 'unknown'}`;
}

export interface RateLimitState {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkLoginRateLimit(key: string): RateLimitState {
  const now = Date.now();
  const attempt = attempts.get(key);
  if (!attempt) return { allowed: true, retryAfterSeconds: 0 };
  if (now - attempt.windowStartedAt > WINDOW_MS) {
    attempts.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (attempt.failures < MAX_FAILURES) return { allowed: true, retryAfterSeconds: 0 };
  const retryAfterSeconds = Math.ceil((attempt.windowStartedAt + WINDOW_MS - now) / 1000);
  return { allowed: false, retryAfterSeconds };
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  prune(now);
  const attempt = attempts.get(key);
  if (!attempt || now - attempt.windowStartedAt > WINDOW_MS) {
    attempts.set(key, { failures: 1, windowStartedAt: now, lastAttemptAt: now });
    return;
  }
  attempt.failures += 1;
  attempt.lastAttemptAt = now;
}

export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
}

/** Test helper. */
export function resetLoginRateLimits(): void {
  attempts.clear();
}
