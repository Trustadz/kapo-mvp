/**
 * Node.js-only instrumentation body: the automatic trash purge scheduler.
 *
 * Kept out of `instrumentation.ts` so the Edge instrumentation compilation
 * never traces better-sqlite3 (a native Node module). Imported dynamically by
 * `instrumentation.ts` when NEXT_RUNTIME === 'nodejs'.
 */

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LOG_PREFIX = '[kapo:purge]';

let started = false;

async function runPurge(): Promise<void> {
  try {
    const { purgeExpired } = await import('./server/domain/purge');
    const result = purgeExpired();
    if (result.projects > 0) {
      console.info(
        `${LOG_PREFIX} removed ${result.projects} project(s), ${result.searchEntries} search entr${
          result.searchEntries === 1 ? 'y' : 'ies'
        }, ${result.auditEvents} audit event(s)`,
      );
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} sweep failed`, error);
  }
}

/**
 * Runs one sweep immediately, then every six hours. The interval is unref'd so
 * it never keeps the process alive by itself.
 */
export async function startPurgeScheduler(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await runPurge();
    const timer = setInterval(() => {
      void runPurge();
    }, PURGE_INTERVAL_MS);
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} scheduler failed to start`, error);
  }
}
