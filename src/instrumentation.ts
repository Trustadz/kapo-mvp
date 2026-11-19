/**
 * Next.js instrumentation entry (AR-020).
 *
 * Next.js compiles this file for both the Node.js and Edge runtimes. The
 * Node-only purge scheduler therefore lives in `instrumentation-node.ts` and is
 * imported dynamically only after checking NEXT_RUNTIME === 'nodejs'
 * (the officially recommended pattern for Node-only instrumentation work).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.KAPO_DISABLE_PURGE === '1') return;
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { startPurgeScheduler } = await import('./instrumentation-node');
    await startPurgeScheduler();
  } catch (error) {
    // Maintenance must never take the server down.
    console.error('[kapo:purge] scheduler failed to start', error);
  }
}
