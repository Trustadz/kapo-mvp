import { getDb } from '../src/server/db/connection';
import { removeProjectFromSearch } from '../src/server/db/search';
import { nowIso } from '../src/server/db/util';

/**
 * `npm run db:purge` — removes projects whose 30-day trash deadline has passed.
 *
 * The schema cascades descendants, audit events and projections. Search rows are
 * not foreign keys, so they are removed explicitly in the same transaction.
 * In production this runs from the scheduled maintenance job and the app
 * startup sweep; it is never exposed as a manual UI action (build-spec §6).
 */
function main(): Promise<void> {
  const db = getDb();
  const now = nowIso();
  // Deepest first so status cascades never hit a sibling that still exists.
  const expired = db
    .prepare(
      `WITH RECURSIVE depths(id, depth) AS (
         SELECT id, 1 FROM projects WHERE parent_id IS NULL
         UNION ALL
         SELECT p.id, d.depth + 1 FROM projects p JOIN depths d ON p.parent_id = d.id
       )
       SELECT d.id FROM depths d
       JOIN projects p ON p.id = d.id
       WHERE p.purge_deadline IS NOT NULL AND p.purge_deadline <= ?
       ORDER BY d.depth DESC`,
    )
    .all(now) as Array<{ id: string }>;

  if (expired.length === 0) {
    console.log('Purge: nothing to remove.');
    return Promise.resolve();
  }

  const removeSearchRow = db.transaction(() => {
    for (const project of expired) removeProjectFromSearch(db, project.id);
    const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?');
    for (const project of expired) deleteProject.run(project.id);
  });
  removeSearchRow();

  console.log(`Purge: removed ${expired.length} expired project(s).`);
  return Promise.resolve();
}

main().catch((error: unknown) => {
  console.error('Purge failed:', error);
  process.exitCode = 1;
});
