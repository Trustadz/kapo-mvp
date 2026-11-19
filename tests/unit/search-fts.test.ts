import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  indexProject,
  removeProjectFromSearch,
  searchBodyFromAddonValues,
} from '@/server/db/search';
import { createTestDatabase, type TestDatabase } from '../helpers/db';

/**
 * FTS maintenance helpers (build-spec §5, §6 rule 11).
 *
 * These cover the projection primitives owned by the foundation; permission
 * filtering is exercised in the search domain tests once that lands.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;

beforeAll(() => {
  test = createTestDatabase({ label: 'fts' });
  db = test.db;
});

afterAll(() => {
  test.cleanup();
});

function match(query: string): Array<{ project_id: string; title: string }> {
  return db
    .prepare('SELECT project_id, title FROM project_search WHERE project_search MATCH ?')
    .all(query) as Array<{ project_id: string; title: string }>;
}

describe('project_search projection', () => {
  it('indexes a project so its title is searchable', () => {
    indexProject(db, { projectId: 'p-1', title: 'Paint the kitchen', body: '' });
    expect(match('kitchen')).toEqual([{ project_id: 'p-1', title: 'Paint the kitchen' }]);
  });

  it('supports prefix matching', () => {
    indexProject(db, { projectId: 'p-2', title: 'Renovate basement', body: '' });
    expect(match('renov*').map((row) => row.project_id)).toEqual(['p-2']);
    expect(match('basem*').map((row) => row.project_id)).toEqual(['p-2']);
  });

  it('replaces the previous document instead of duplicating it', () => {
    indexProject(db, { projectId: 'p-3', title: 'Old title', body: '' });
    indexProject(db, { projectId: 'p-3', title: 'New title', body: 'garden' });
    expect(match('old')).toHaveLength(0);
    expect(match('new').map((row) => row.project_id)).toEqual(['p-3']);
    // The body column is indexed too.
    expect(match('garden').map((row) => row.project_id)).toEqual(['p-3']);
    const count = db
      .prepare('SELECT COUNT(*) AS count FROM project_search WHERE project_id = ?')
      .get('p-3') as { count: number };
    expect(count.count).toBe(1);
  });

  it('removes a project from the index', () => {
    indexProject(db, { projectId: 'p-4', title: 'Trip planning', body: '' });
    removeProjectFromSearch(db, 'p-4');
    expect(match('trip')).toHaveLength(0);
    // Removing twice is a no-op.
    expect(() => removeProjectFromSearch(db, 'p-4')).not.toThrow();
  });

  it('treats a single quote in a search body as data, not syntax', () => {
    indexProject(db, { projectId: 'p-5', title: "Maya's trip", body: '' });
    expect(() => match('maya')).not.toThrow();
    expect(match('maya').map((row) => row.project_id)).toEqual(['p-5']);
  });
});

describe('searchBodyFromAddonValues', () => {
  it('joins text and number values from searchable fields only', () => {
    const body = searchBodyFromAddonValues(
      {
        assignee: { notes: 'call the plumber', effort: 3, hidden: 'not searchable' },
        tags: { label: 'urgent' },
      },
      { assignee: ['notes', 'effort'], tags: ['label'] },
    );
    expect(body).toBe('call the plumber\n3\nurgent');
  });

  it('ignores unknown addons, unknown fields and non-scalar values', () => {
    const body = searchBodyFromAddonValues(
      {
        known: { text: 'visible', nested: { deep: 'ignored' }, list: ['a'], empty: '   ' },
      },
      { known: ['text', 'nested', 'list', 'empty'], missing: ['anything'] },
    );
    expect(body).toBe('visible');
  });

  it('returns an empty string for empty input', () => {
    expect(searchBodyFromAddonValues({}, {})).toBe('');
    expect(searchBodyFromAddonValues({ known: undefined }, { known: ['a'] })).toBe('');
  });
});
