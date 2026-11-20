import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { searchProjects, searchTrash } from '@/server/domain/search';
import { indexProject } from '@/server/db/search';
import { trashProjects } from '@/server/domain/trash';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject,
  createUser,
  createWorkflow,
  grantRole,
  type FixtureHousehold,
} from '../helpers/fixtures';

/**
 * Permission-filtered search (build-spec §6 rules 10–11, §7; product.md §8).
 * Trashed items never appear in ordinary results, archived items follow
 * show_archived, and a directly granted descendant is findable without its
 * inaccessible parent being disclosed.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

function actor(user: { id: string; appRole: 'admin' | 'user' | 'viewer' }, showArchived = false) {
  return { id: user.id, appRole: user.appRole, showArchived };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'search-domain' });
  db = test.db;
  household = await buildHouseholdFixture(db);
});

afterAll(() => {
  test.cleanup();
});

describe('searchProjects', () => {
  it('matches titles, prefixes and searchable body text', () => {
    indexProject(db, {
      projectId: household.renovate.id,
      title: 'Renovate basement',
      body: 'plumber quote from the neighbourhood',
    });
    const byTitle = searchProjects(db, actor(household.admin), 'renov');
    expect(byTitle.map((result) => result.title)).toContain('Renovate basement');

    const byBody = searchProjects(db, actor(household.admin), 'plumber');
    const bodyResult = byBody.find((result) => result.id === household.renovate.id);
    expect(bodyResult).toBeDefined();
    expect(bodyResult?.match.field).toBe('Text');
    expect(bodyResult?.match.text).toContain('plumber');
  });

  it('returns nothing for empty, blank or punctuation-only queries', () => {
    for (const query of ['', '   ', '""', '!!!']) {
      expect(searchProjects(db, actor(household.admin), query)).toEqual([]);
    }
  });

  it('never leaks projects the viewer cannot read', async () => {
    const outsider = await createUser(db, { username: 'search-domain-outsider' });
    expect(searchProjects(db, actor(outsider), 'paint')).toEqual([]);

    const server = await createUser(db, { username: 'search-domain-user' });
    const parent = createProject(db, {
      title: 'Secret parent',
      parentId: household.root.id,
      reporterId: household.admin.id,
    });
    grantRole(db, parent.id, household.admin.id, 'admin');
    createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
    const child = createProject(db, {
      title: 'Secret child',
      parentId: parent.id,
      reporterId: household.admin.id,
    });
    grantRole(db, child.id, server.id, 'user');

    const results = searchProjects(db, actor(server), 'secret');
    const childResult = results.find((result) => result.id === child.id);
    expect(childResult).toBeDefined();
    // The directly granted descendant is reachable, but the inaccessible
    // parent's title must not be disclosed.
    expect(childResult?.directAccess).toBe(true);
    expect(childResult?.parentTitle).toBeNull();
    // The parent itself is not readable.
    expect(results.map((result) => result.id)).not.toContain(parent.id);
  });

  it('excludes trashed projects from ordinary results', () => {
    const trashed = createProject(db, {
      title: 'Searchable trashed item',
      parentId: household.home.id,
      reporterId: household.admin.id,
    });
    expect(
      searchProjects(db, actor(household.admin), 'Searchable trashed').map((result) => result.id),
    ).toContain(trashed.id);
    trashProjects(db, actor(household.admin), [trashed.id]);
    expect(
      searchProjects(db, actor(household.admin), 'Searchable trashed').map((result) => result.id),
    ).not.toContain(trashed.id);
  });

  it('follows the per-user show_archived setting for archived results', () => {
    const archived = createProject(db, {
      title: 'Archived searchable item',
      parentId: household.root.id,
      reporterId: household.admin.id,
      archived: true,
    });
    grantRole(db, archived.id, household.admin.id, 'admin');
    expect(
      searchProjects(db, actor(household.admin, false), 'Archived searchable').map(
        (result) => result.id,
      ),
    ).not.toContain(archived.id);
    const visible = searchProjects(db, actor(household.admin, true), 'Archived searchable');
    expect(visible.map((result) => result.id)).toContain(archived.id);
    expect(visible.find((result) => result.id === archived.id)?.archived).toBe(true);
  });
});

describe('searchTrash', () => {
  it('filters the permission-filtered trash list and still hides inaccessible items', async () => {
    const parent = createProject(db, {
      title: 'Trash search parent',
      parentId: household.home.id,
      reporterId: household.admin.id,
    });
    createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
    const item = createProject(db, {
      title: 'Boiler service reminder',
      parentId: parent.id,
      reporterId: household.admin.id,
    });
    trashProjects(db, actor(household.admin), [parent.id]);

    const all = searchTrash(db, actor(household.admin), '');
    expect(all.map((entry) => entry.id)).toContain(item.id);
    const filtered = searchTrash(db, actor(household.admin), 'boiler');
    expect(filtered.map((entry) => entry.id)).toEqual([item.id]);
    expect(searchTrash(db, actor(household.admin), 'no-such-thing')).toEqual([]);

    const outsider = await createUser(db, { username: 'trash-search-outsider' });
    expect(searchTrash(db, actor(outsider), 'boiler')).toEqual([]);
  });
});
