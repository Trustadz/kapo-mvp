/**
 * Node.js-only instrumentation body: the automatic trash purge and daily
 * rolling backup schedulers.
 *
 * Kept out of `instrumentation.ts` so the Edge instrumentation compilation
 * never traces better-sqlite3 (a native Node module). Imported dynamically by
 * `instrumentation.ts` when NEXT_RUNTIME === 'nodejs'.
 */

import { startBackupScheduler } from './server/backup/schedule';

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LOG_PREFIX = '[kapo:purge]';
const ADDON_LOG_PREFIX = '[kapo:addons]';
const SNAPSHOT_LOG_PREFIX = '[kapo:snapshot]';

let started = false;

/**
 * Registry → `addons` table sync + add-on search rebuild. Runs once at startup
 * after migrations: new code registrations get a row, Admin modes are never
 * overwritten, and hidden add-on text cannot remain in FTS after a mode change.
 */
async function syncAddonRegistryAtStartup(): Promise<void> {
  try {
    const { getDb } = await import('./server/db/connection');
    const { syncAddonRegistryAndSearch } = await import('./server/domain/project-addons');
    const identifiers = syncAddonRegistryAndSearch(getDb());
    if (identifiers.length > 0) {
      console.info(`${ADDON_LOG_PREFIX} registered ${identifiers.join(', ')}`);
    }
  } catch (error) {
    // Add-on plumbing must never take Kapo down.
    console.error(`${ADDON_LOG_PREFIX} startup sync failed`, error);
  }
}

/**
 * One-time upgrade pass: turns live layout/add-on inheritance into explicit
 * per-project snapshots. Runs after the registry sync because the snapshot must
 * resolve every registered add-on. Failure leaves the marker unset so the next
 * boot retries; it never blocks startup.
 */
async function snapshotInheritanceAtStartup(): Promise<void> {
  try {
    const { getDb } = await import('./server/db/connection');
    const { snapshotInheritanceOnce } = await import('./server/domain/inheritance-snapshot');
    const result = snapshotInheritanceOnce(getDb());
    if (!result.alreadySnapshotted) {
      console.info(
        `${SNAPSHOT_LOG_PREFIX} snapshotted layout/add-ons for ${result.projects} project(s)`,
      );
    }
  } catch (error) {
    console.error(
      `${SNAPSHOT_LOG_PREFIX} snapshot failed; it will be retried on the next start`,
      error,
    );
  }
}

async function runPurge(): Promise<void> {
  try {
    const { getApplicationSettings } = await import('./server/domain/settings');
    if (!getApplicationSettings().trashPurgeEnabled) return;
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
 * it never keeps the process alive by itself. Whether a sweep actually deletes
 * anything is the Admin `trashPurgeEnabled` setting; a disabled purge leaves
 * backups on their own schedule.
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

/**
 * Starts the Node maintenance schedulers independently so a failure in one
 * never prevents the other from running.
 */
export async function startSchedulers(): Promise<void> {
  await Promise.all([
    // The snapshot resolves registered add-ons, so it must follow the sync.
    (async () => {
      await syncAddonRegistryAtStartup();
      await snapshotInheritanceAtStartup();
    })(),
    startPurgeScheduler().catch((error: unknown) => {
      console.error(`${LOG_PREFIX} scheduler failed to start`, error);
    }),
    startBackupScheduler().catch((error: unknown) => {
      console.error('[kapo:backup] scheduler failed to start', error);
    }),
  ]);
}
