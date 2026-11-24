import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_SAVE_FEEDBACK_MS, remainingSaveFeedback } from '@/lib/saving-feedback';

/**
 * The save indicator is held for a minimum time so a fast request does not
 * flash the button state past the user.
 */
describe('remainingSaveFeedback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the remaining minimum time', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    let settled = false;
    void remainingSaveFeedback(startedAt).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(MIN_SAVE_FEEDBACK_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('resolves immediately when the request already outlasted the minimum', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now() - MIN_SAVE_FEEDBACK_MS;
    let settled = false;
    void remainingSaveFeedback(startedAt).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });
});
