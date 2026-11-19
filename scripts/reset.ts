import fs from 'node:fs';
import { databasePath } from '../src/server/db/paths';
import { openDatabase } from '../src/server/db/connection';
import { seedDatabase, seedSummaryLine } from '../src/server/seed';

/**
 * `npm run db:reset` — drops the SQLite file (including WAL/SHM sidecars),
 * reapplies every migration, then seeds build-spec §10 data.
 */
async function main(): Promise<void> {
  const filename = databasePath();
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${filename}${suffix}`;
    if (fs.existsSync(target)) {
      fs.rmSync(target);
      console.log(`Removed ${target}`);
    }
  }

  const db = openDatabase({ fresh: true });
  try {
    const summary = await seedDatabase(db);
    console.log(`Kapo reset complete: ${seedSummaryLine(summary)}`);
    console.log('Accounts: tristan (Admin), maya (User), jules (User), alex (Viewer) — password kapo1234');
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Reset failed:', error);
  process.exitCode = 1;
});
