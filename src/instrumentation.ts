/**
 * Next.js instrumentation entry (AR-020, issue #13).
 *
 * Next.js compiles this file for both the Node.js and Edge runtimes. The
 * Node-only maintenance schedulers (trash purge + daily rolling backups)
 * therefore live in `instrumentation-node.ts` and are imported dynamically only
 * after checking NEXT_RUNTIME === 'nodejs' (the officially recommended pattern
 * for Node-only instrumentation work).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { startSchedulers } = await import('./instrumentation-node');
    await startSchedulers();
  } catch (error) {
    // Maintenance must never take the server down.
    console.error('[kapo] maintenance schedulers failed to start', error);
  }
}
