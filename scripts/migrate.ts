import { databasePath } from '../src/server/db/paths';
import { openDatabase } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';

/** `npm run db:migrate` — applies pending migrations and reports the state. */
function main(): void {
  const db = openDatabase({ fresh: true, migrate: false });
  try {
    const result = runMigrations(db);
    console.log(`Database: ${databasePath()}`);
    console.log(`Applied this run: ${result.applied.length === 0 ? 'none' : result.applied.join(', ')}`);
    console.log(`Current migrations: ${result.current.join(', ')}`);
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
