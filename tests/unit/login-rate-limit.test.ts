import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  loginAttemptKey,
  recordLoginFailure,
  resetLoginRateLimits,
} from '@/server/auth/rate-limit';

/** In-process login throttle (foundation defence in depth for /api/auth/login). */

describe('login rate limiting', () => {
  beforeAll(() => resetLoginRateLimits());

  it('builds a case-insensitive key from username + ip', () => {
    expect(loginAttemptKey('  Tristan ', '10.0.0.1')).toBe('tristan|10.0.0.1');
    expect(loginAttemptKey('tristan', null)).toBe('tristan|unknown');
    expect(loginAttemptKey('TRISTAN', '10.0.0.1')).toBe(loginAttemptKey('tristan', '10.0.0.1'));
  });

  it('allows attempts until the failure budget is exhausted', () => {
    const key = loginAttemptKey('maya', '127.0.0.1');
    expect(checkLoginRateLimit(key).allowed).toBe(true);
    for (let index = 0; index < 9; index += 1) recordLoginFailure(key);
    expect(checkLoginRateLimit(key).allowed).toBe(true);
    recordLoginFailure(key);
    const blocked = checkLoginRateLimit(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it('tracks keys independently', () => {
    const mayaKey = loginAttemptKey('maya', '127.0.0.1');
    const julesKey = loginAttemptKey('jules', '127.0.0.1');
    for (let index = 0; index < 10; index += 1) recordLoginFailure(mayaKey);
    expect(checkLoginRateLimit(mayaKey).allowed).toBe(false);
    expect(checkLoginRateLimit(julesKey).allowed).toBe(true);
  });

  it('clears the budget after a successful login', () => {
    const key = loginAttemptKey('alex', '127.0.0.1');
    for (let index = 0; index < 10; index += 1) recordLoginFailure(key);
    expect(checkLoginRateLimit(key).allowed).toBe(false);
    clearLoginAttempts(key);
    expect(checkLoginRateLimit(key).allowed).toBe(true);
  });

  it('resets after the 15 minute window', () => {
    const key = loginAttemptKey('window-user', '127.0.0.1');
    for (let index = 0; index < 10; index += 1) recordLoginFailure(key);
    expect(checkLoginRateLimit(key).allowed).toBe(false);

    const realNow = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 16 * 60 * 1000);
    try {
      expect(checkLoginRateLimit(key).allowed).toBe(true);
      // The stale bucket is dropped, so a new failure starts at one.
      recordLoginFailure(key);
      expect(checkLoginRateLimit(key).allowed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  afterAll(() => resetLoginRateLimits());
});
