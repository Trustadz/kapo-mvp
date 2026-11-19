import { closeDb } from '../src/server/db/connection';
import { purgeExpired } from '../src/server/domain/purge';

/**
 * `npm run db:purge` — thin CLI wrapper around the same `purgeExpired()`
 * implementation the app runs from instrumentation at startup and every six
 * hours. In a Docker deployment this command is optional; the container
 * sweeps expired trash by itself.
 */
function main(): void {
  const result = purgeExpired();
  if (result.projects === 0) {
    console.log('Purge: nothing to remove.');
    return;
  }
  console.log(
    `Purge: removed ${result.projects} project(s), ${result.searchEntries} search entr${
      result.searchEntries === 1 ? 'y' : 'ies'
    }, ${result.auditEvents} audit event(s).`,
  );
}

try {
  main();
} catch (error) {
  console.error('Purge failed:', error);
  process.exitCode = 1;
} finally {
  // Release the SQLite handle so the CLI exits promptly.
  closeDb();
}
