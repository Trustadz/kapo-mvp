/**
 * A fast save can finish before the user notices the button changed, so the
 * “Saving…” state is held for this long even when the request returns sooner.
 * The delay is intentionally short enough not to feel like a slowdown.
 */
export const MIN_SAVE_FEEDBACK_MS = 600;

/**
 * Resolves once `minimumMs` has elapsed since `startedAt`. Call it right before
 * clearing the saving state; it resolves immediately when the request already
 * took longer than the minimum.
 */
export function remainingSaveFeedback(
  startedAt: number,
  minimumMs: number = MIN_SAVE_FEEDBACK_MS,
): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}
