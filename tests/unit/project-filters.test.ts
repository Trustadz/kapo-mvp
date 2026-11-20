import { describe, expect, it } from 'vitest';
import type { ProjectCard, ProjectWithParent } from '@/lib/projects';
import {
  EMPTY_PROJECT_FILTERS,
  filterProjectDescendants,
  filterProjectItems,
  hasActiveProjectFilters,
  matchesProjectFilters,
  matchesProjectReporter,
  matchesProjectTitle,
  reporterFilterOptions,
} from '@/components/projects/projectFilters';

/**
 * Issue #55: title and reporter filters for child-project collections.
 *
 * These tests pin the pure rules: case-insensitive title substrings, reporter
 * matching, deterministic reporter options and — most importantly — the Tree's
 * ancestor inclusion rule, which must never orphan a matching row.
 */

interface FixtureOptions {
  title?: string;
  reporter?: ProjectCard['reporter'];
  parentId?: string | null;
}

function project(id: string, options: FixtureOptions = {}): ProjectWithParent {
  const reporter =
    options.reporter ??
    ({ id: 'user-tristan', username: 'tristan', avatar: null } satisfies ProjectCard['reporter']);
  return {
    id,
    seq: 1,
    displayId: `KAP-${id}`,
    title: options.title ?? id,
    statusId: 'status-1',
    statusName: 'To do',
    priority: 0,
    inbox: false,
    archived: false,
    trashed: false,
    reporter,
    parentId: options.parentId ?? null,
    parent: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const TRISTAN = { id: 'user-tristan', username: 'tristan', avatar: null };
const MAYA = { id: 'user-maya', username: 'maya', avatar: null };
const JULES = { id: 'user-jules', username: 'jules', avatar: null };
describe('title matching', () => {
  it('matches case-insensitive substrings', () => {
    const card = project('a', { title: 'Paint Hallway' });
    expect(matchesProjectTitle(card, 'paint')).toBe(true);
    expect(matchesProjectTitle(card, 'HALL')).toBe(true);
    expect(matchesProjectTitle(card, 'hallway')).toBe(true);
    expect(matchesProjectTitle(card, 'garden')).toBe(false);
  });

  it('trims the query and treats blank input as "no title filter"', () => {
    const card = project('a', { title: 'Garden beds' });
    expect(matchesProjectTitle(card, '  beds  ')).toBe(true);
    expect(matchesProjectTitle(card, '   ')).toBe(true);
    expect(matchesProjectTitle(card, '')).toBe(true);
  });
});

describe('reporter matching', () => {
  it('treats null as "All reporters"', () => {
    expect(matchesProjectReporter(project('a', { reporter: MAYA }), null)).toBe(true);
  });

  it('matches only the selected reporter', () => {
    expect(matchesProjectReporter(project('a', { reporter: MAYA }), MAYA.id)).toBe(true);
    expect(matchesProjectReporter(project('a', { reporter: TRISTAN }), MAYA.id)).toBe(false);
  });
});

describe('matchesProjectFilters', () => {
  const filters = { title: 'tap', reporterId: MAYA.id };

  it('requires every active filter to match', () => {
    expect(matchesProjectFilters(project('a', { title: 'Fix kitchen tap', reporter: MAYA }), filters)).toBe(true);
    expect(matchesProjectFilters(project('b', { title: 'Fix kitchen tap', reporter: TRISTAN }), filters)).toBe(false);
    expect(matchesProjectFilters(project('c', { title: 'Garden beds', reporter: MAYA }), filters)).toBe(false);
  });
});

describe('filterProjectItems', () => {
  const items = [
    project('a', { title: 'Renovate basement', reporter: MAYA }),
    project('b', { title: 'Find contractor', reporter: JULES }),
    project('c', { title: 'Paint hallway', reporter: JULES }),
    project('d', { title: 'Garden beds', reporter: TRISTAN }),
  ];

  it('keeps the collection order when nothing is active', () => {
    expect(filterProjectItems(items, EMPTY_PROJECT_FILTERS).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('filters immediate children by title and reporter together', () => {
    expect(
      filterProjectItems(items, { title: 'ha', reporterId: JULES.id }).map((item) => item.id),
    ).toEqual(['c']);
  });

  it('reports active filters', () => {
    expect(hasActiveProjectFilters(EMPTY_PROJECT_FILTERS)).toBe(false);
    expect(hasActiveProjectFilters({ title: '  ', reporterId: null })).toBe(false);
    expect(hasActiveProjectFilters({ title: 'x', reporterId: null })).toBe(true);
    expect(hasActiveProjectFilters({ title: '', reporterId: MAYA.id })).toBe(true);
  });
});

describe('reporterFilterOptions', () => {
  it('returns distinct reporters sorted by username', () => {
    const options = reporterFilterOptions([
      project('a', { reporter: TRISTAN }),
      project('b', { reporter: MAYA }),
      project('c', { reporter: JULES }),
      project('d', { reporter: MAYA }),
    ]);
    expect(options).toEqual([
      { id: JULES.id, username: 'jules' },
      { id: MAYA.id, username: 'maya' },
      { id: TRISTAN.id, username: 'tristan' },
    ]);
  });

  it('is empty for an empty collection', () => {
    expect(reporterFilterOptions([])).toEqual([]);
  });
});

describe('filterProjectDescendants (Tree)', () => {
  // Depth-first, parent-linked collection:
  //   renovate (maya)
  //     contractor (jules)
  //       quote (tristan)
  //   paint (jules)
  //   garden (tristan)
  //     seeds (maya)
  const descendants = [
    project('renovate', { title: 'Renovate basement', reporter: MAYA, parentId: 'home' }),
    project('contractor', { title: 'Find contractor', reporter: JULES, parentId: 'renovate' }),
    project('quote', { title: 'Request quote', reporter: TRISTAN, parentId: 'contractor' }),
    project('paint', { title: 'Paint hallway', reporter: JULES, parentId: 'home' }),
    project('garden', { title: 'Garden beds', reporter: TRISTAN, parentId: 'home' }),
    project('seeds', { title: 'Buy seeds', reporter: MAYA, parentId: 'garden' }),
  ];

  it('returns the full depth-first list unchanged when no filter is active', () => {
    const result = filterProjectDescendants(descendants, EMPTY_PROJECT_FILTERS);
    expect(result.rows.map((row) => row.id)).toEqual([
      'renovate',
      'contractor',
      'quote',
      'paint',
      'garden',
      'seeds',
    ]);
    expect(result.contextIds.size).toBe(0);
  });

  it('keeps every ancestor of a match and marks the non-matching ones as context', () => {
    const result = filterProjectDescendants(descendants, { title: 'quote', reporterId: null });
    expect(result.rows.map((row) => row.id)).toEqual(['renovate', 'contractor', 'quote']);
    expect([...result.contextIds]).toEqual(['renovate', 'contractor']);
  });

  it('does not pull in descendants of a match', () => {
    const result = filterProjectDescendants(descendants, { title: 'garden', reporterId: null });
    expect(result.rows.map((row) => row.id)).toEqual(['garden']);
    expect(result.contextIds.size).toBe(0);
  });

  it('keeps matches from separate branches in order', () => {
    const result = filterProjectDescendants(descendants, { title: '', reporterId: JULES.id });
    expect(result.rows.map((row) => row.id)).toEqual(['renovate', 'contractor', 'paint']);
    // `contractor` matches but its parent `renovate` (maya) is shown for
    // context; `paint` is a direct child and needs no ancestor.
    expect([...result.contextIds]).toEqual(['renovate']);
  });

  it('returns no rows when nothing matches', () => {
    const result = filterProjectDescendants(descendants, { title: 'zzz', reporterId: null });
    expect(result.rows).toEqual([]);
    expect(result.contextIds.size).toBe(0);
  });

  it('combines title and reporter filters for matching', () => {
    const result = filterProjectDescendants(descendants, {
      title: 'contractor',
      reporterId: JULES.id,
    });
    expect(result.rows.map((row) => row.id)).toEqual(['renovate', 'contractor']);
    expect([...result.contextIds]).toEqual(['renovate']);
  });
});
