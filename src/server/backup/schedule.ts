import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { getDb } from '@/server/db/connection';
import { getApplicationSettings } from '@/server/domain/settings';
import {
  backupDirPath,
  createBackup,
  listBackups,
  type BackupSummary,
} from './service';

/**
 * In-process daily backup scheduler (issue #13).
 *
 * Started once by Next.js instrumentation (Node runtime). The next run is
 * recomputed after every attempt and whenever an Admin saves backup settings,
 * so changing the time takes effect without a restart. Timers are unref'd and
 * every failure is logged instead of crashing the server, matching the existing
 * trash-purge scheduler. Builds and tests never start it.
 *
 * The configured start time is a local wall-clock time. The server's timezone
 * is therefore authoritative: set TZ (the Compose file defaults to UTC) to the
 * household's timezone for a 02:00 backup to mean 02:00 local time.
 */

const LOG_PREFIX = '[kapo:backup]';
const DEFAULT_START_TIME = '02:00';
const START_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface SchedulerState {
  started: boolean;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  nextRunAt: Date | null;
}

// Stored on globalThis so a Next.js dev/HMR module reload cannot start a second
// timer for the same process.
const globalWithScheduler = globalThis as unknown as {
  __kapoBackupScheduler?: SchedulerState;
};
const state: SchedulerState = (globalWithScheduler.__kapoBackupScheduler ??= {
  started: false,
  running: false,
  timer: null,
  nextRunAt: null,
});

/** Pure next-run calculation: today at HH:MM, or tomorrow when already passed. */
export function computeNextRun(now: Date, startTime: string): Date {
  const match = START_TIME_PATTERN.exec(startTime.trim());
  const hours = match ? Number(match[1]) : Number(DEFAULT_START_TIME.slice(0, 2));
  const minutes = match ? Number(match[2]) : Number(DEFAULT_START_TIME.slice(3, 5));
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0,
  );
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function clearTimer(): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.nextRunAt = null;
}

function scheduleFromSettings(): void {
  clearTimer();
  const settings = getApplicationSettings();
  if (!settings.backupEnabled) {
    console.info(`${LOG_PREFIX} automatic backups are disabled`);
    return;
  }
  const next = computeNextRun(new Date(), settings.backupStartTime);
  state.nextRunAt = next;
  const delay = Math.max(0, next.getTime() - Date.now());
  state.timer = setTimeout(() => {
    void runScheduledBackup();
  }, delay);
  if (typeof state.timer === 'object' && 'unref' in state.timer) {
    state.timer.unref();
  }
  console.info(
    `${LOG_PREFIX} next run ${next.toISOString()} (${settings.backupStartTime} local time)`,
  );
}

async function runScheduledBackup(): Promise<void> {
  state.timer = null;
  state.nextRunAt = null;
  if (state.running) {
    // A very slow run is still in flight; schedule the next one without
    // starting a second copy against the same database.
    try {
      scheduleFromSettings();
    } catch (error) {
      console.error(`${LOG_PREFIX} reschedule after overlap failed`, error);
    }
    return;
  }

  state.running = true;
  try {
    const settings = getApplicationSettings();
    if (settings.backupEnabled) {
      const result = await createBackup({ retention: settings.backupRetention });
      console.info(
        `${LOG_PREFIX} created ${result.name} (${result.databaseBytes} bytes, uploads ${
          result.uploadsIncluded ? 'included' : 'not present'
        }; kept ${settings.backupRetention})`,
      );
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} scheduled backup failed`, error);
  } finally {
    state.running = false;
    try {
      scheduleFromSettings();
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to schedule the next backup`, error);
    }
  }
}

/** Starts the scheduler once per process (guarded against HMR double-start). */
export async function startBackupScheduler(): Promise<void> {
  if (state.started) return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
  state.started = true;
  try {
    scheduleFromSettings();
  } catch (error) {
    console.error(`${LOG_PREFIX} scheduler failed to start`, error);
  }
}

/**
 * Recomputes the next run after backup settings change. No-op until the
 * scheduler has been started in this process.
 */
export function rescheduleBackupScheduler(): void {
  if (!state.started) return;
  try {
    scheduleFromSettings();
  } catch (error) {
    console.error(`${LOG_PREFIX} failed to reschedule after a settings change`, error);
  }
}

export interface BackupStatus {
  enabled: boolean;
  startTime: string;
  retention: number;
  destination: string;
  lastBackup: BackupSummary | null;
  /** ISO timestamp of the next scheduled run, or null when disabled. */
  nextRun: string | null;
  running: boolean;
}

/** Admin settings page status; reads the destination without creating it. */
export function getBackupStatus(
  db: BetterSqliteDatabase = getDb(),
  now: Date = new Date(),
): BackupStatus {
  const settings = getApplicationSettings(db);
  const destination = backupDirPath();
  return {
    enabled: settings.backupEnabled,
    startTime: settings.backupStartTime,
    retention: settings.backupRetention,
    destination,
    lastBackup: listBackups(destination)[0] ?? null,
    nextRun: settings.backupEnabled
      ? computeNextRun(now, settings.backupStartTime).toISOString()
      : null,
    running: state.running,
  };
}

/** Exposed for diagnostics/tests; the active timer is process-local. */
export function scheduledRunAt(): Date | null {
  return state.nextRunAt;
}
