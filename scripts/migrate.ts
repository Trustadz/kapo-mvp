import { databasePath } from '../src/server/db/paths';
import { openDatabase } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { syncAddonRegistry } from '../src/server/domain/project-addons';
import { snapshotInheritanceOnce } from '../src/server/domain/inheritance-snapshot';

/** `npm run db:migrate` — applies pending migrations and reports the state. */
function main(): void {
  const db = openDatabase({ fresh: true, migrate: false });
  try {
    const result = runMigrations(db);
    console.log(`Database: ${databasePath()}`);
    console.log(`Applied this run: ${result.applied.length === 0 ? 'none' : result.applied.join(', ')}`);
    console.log(`Current migrations: ${result.current.join(', ')}`);

    // The one-time inheritance snapshot is data, not schema. Run it here as
    // well as at server startup so CLI-driven upgrades converge immediately.
    // A failure must never fail the migration; startup retries it because the
    // marker is only written inside the snapshot transaction.
    try {
      syncAddonRegistry(db);
      const snapshot = snapshotInheritanceOnce(db);
      console.log(
        snapshot.alreadySnapshotted
          ? 'Inheritance snapshot: already applied'
          : `Inheritance snapshot: ${snapshot.projects} project(s)`,
      );
    } catch (error) {
      console.error('Inheritance snapshot failed; the server will retry at startup:', error);
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
}
