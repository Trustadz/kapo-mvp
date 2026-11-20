import { openDatabase } from '../src/server/db/connection';
import { seedDatabase, seedSummaryLine } from '../src/server/seed';

/** `npm run db:seed` — replaces the database contents with build-spec §10 data. */
async function main(): Promise<void> {
  const db = openDatabase({ fresh: true });
  try {
    const summary = await seedDatabase(db);
    console.log(`Kapo seed complete: ${seedSummaryLine(summary)}`);
    console.log('Accounts: admin (Admin), maya (User), jules (User), alex (Viewer) — password kapo1234');
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
