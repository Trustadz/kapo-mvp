import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

/**
 * Full-text search maintenance for build-spec §5's `project_search` FTS5 table.
 *
 * Every project write must call `indexProject` inside the same transaction as
 * the project row update, and trashed/purged projects must be removed from the
 * index. Permission filtering happens on the query side in the search domain.
 */

export interface ProjectSearchDocument {
  projectId: string;
  title: string;
  body: string;
}

/**
 * Replaces the search document for a project. FTS5 rows are not unique, so the
 * old document is removed first; call inside the project write transaction.
 */
export function indexProject(
  db: BetterSqliteDatabase,
  document: ProjectSearchDocument,
): void {
  removeProjectFromSearch(db, document.projectId);
  db.prepare('INSERT INTO project_search (project_id, title, body) VALUES (?, ?, ?)').run(
    document.projectId,
    document.title,
    document.body,
  );
}

export function removeProjectFromSearch(db: BetterSqliteDatabase, projectId: string): void {
  db.prepare('DELETE FROM project_search WHERE project_id = ?').run(projectId);
}

/** Builds the search body from add-on values whose keys are searchable. */
export function searchBodyFromAddonValues(
  addonData: Record<string, unknown>,
  searchableFields: Record<string, readonly string[]>,
): string {
  const chunks: string[] = [];
  for (const [identifier, fields] of Object.entries(searchableFields)) {
    const addonValues = addonData[identifier];
    if (typeof addonValues !== 'object' || addonValues === null) continue;
    const values = addonValues as Record<string, unknown>;
    for (const field of fields) {
      const value = values[field];
      if (typeof value === 'string' && value.trim()) chunks.push(value.trim());
      else if (typeof value === 'number') chunks.push(String(value));
    }
  }
  return chunks.join('\n');
}
