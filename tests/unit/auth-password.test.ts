import { describe, expect, it } from 'vitest';
import { hashPassword, isPasswordHash, verifyPassword } from '@/server/auth/password';

/** scrypt password hashing (build-spec §5, product.md §6). */

describe('password hashing', () => {
  it('produces a self-describing scrypt hash', async () => {
    const hash = await hashPassword('kapo1234');
    const parts = hash.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBeGreaterThanOrEqual(1024);
    expect(Number(parts[2])).toBeGreaterThanOrEqual(1);
    expect(Number(parts[3])).toBeGreaterThanOrEqual(1);
    expect(parts[4]).toBeTruthy();
    expect(parts[5]).toBeTruthy();
  });

  it('never stores the plaintext password', async () => {
    const hash = await hashPassword('kapo1234');
    expect(hash).not.toContain('kapo1234');
  });

  it('uses a random salt for every hash', async () => {
    const [first, second] = await Promise.all([hashPassword('kapo1234'), hashPassword('kapo1234')]);
    expect(first).not.toBe(second);
    expect(await verifyPassword('kapo1234', first)).toBe(true);
    expect(await verifyPassword('kapo1234', second)).toBe(true);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('rejects malformed hashes without throwing', async () => {
    for (const stored of [
      '',
      'plaintext',
      'scrypt$1$2$3',
      'bcrypt$16384$8$1$c2FsdA$aGFzaA',
      'scrypt$16384$8$1$c2FsdA$aGFzaA$extra',
      'scrypt$abc$8$1$c2FsdA$aGFzaA',
      'scrypt$16384$8$1$!!!$aGFzaA',
    ]) {
      expect(await verifyPassword('anything', stored)).toBe(false);
      expect(isPasswordHash(stored)).toBe(false);
    }
  });

  it('rejects hashes whose parameters are outside the accepted range', async () => {
    const hash = await hashPassword('x'.repeat(9));
    const parts = hash.split('$');
    const tooExpensive = ['scrypt', '999999999', parts[2], parts[3], parts[4], parts[5]].join('$');
    expect(isPasswordHash(tooExpensive)).toBe(false);
    expect(await verifyPassword('x'.repeat(9), tooExpensive)).toBe(false);
  });

  it('recognises its own hashes', async () => {
    const hash = await hashPassword('kapo1234');
    expect(isPasswordHash(hash)).toBe(true);
  });
});
