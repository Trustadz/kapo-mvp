import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject as createFixtureProject,
  createWorkflow,
  grantRole,
  type FixtureHousehold,
} from '../helpers/fixtures';
import { registerAddon } from '@/server/addons/registry';
import { purgeExpired } from '@/server/domain/purge';
import { syncAddonRegistry } from '@/server/domain/project-addons';

/**
 * Add-on purge hooks (docs/add-ons.md §3.3/§10.1): called inside the purge
 * transaction for the ordered project ids, isolated per add-on, never creating
 * an audit event and never blocking the core cascade.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;
const purged: string[][] = [];

beforeAll(async () => {
  test = createTestDatabase({ label: 'addon-purge' });
  db = test.db;
  household = await buildHouseholdFixture(db);
  syncAddonRegistry(db);
  registerAddon({
    identifier: 'purge-probe',
    name: 'Purge probe',
    version: '1.0.0',
    fields: [{ key: 'value', label: 'Value', type: 'text' }],
    hooks: {
      onProjectPurge({ projectIds }) {
        purged.push([...projectIds]);
      },
    },
  });
  registerAddon({
    identifier: 'purge-thrower',
    name: 'Purge thrower',
    version: '1.0.0',
    fields: [{ key: 'value', label: 'Value', type: 'text' }],
    hooks: {
      onProjectPurge() {
        throw new Error('boom');
      },
    },
  });
  syncAddonRegistry(db);
});

afterAll(() => {
  test.cleanup();
});

function expiredProject(title: string) {
  const parent = createFixtureProject(db, {
    title: `${title} parent`,
    parentId: household.home.id,
    reporterId: household.admin.id,
  });
  createWorkflow(db, parent.id, { names: ['To do', 'Done'] });
  grantRole(db, parent.id, household.admin.id, 'admin');
  const child = createFixtureProject(db, {
    title,
    parentId: parent.id,
    reporterId: household.admin.id,
    addonData: { 'purge-probe': { value: 'kept until purge' } },
    trashedAt: '2000-01-01T00:00:00.000Z',
    purgeDeadline: '2000-01-31T00:00:00.000Z',
  });
  createWorkflow(db, child.id, { names: ['To do', 'Done'] });
  grantRole(db, child.id, household.admin.id, 'admin');
  return child;
}

describe('onProjectPurge', () => {
  it('runs once per purged subtree and still deletes when another hook throws', () => {
    const project = expiredProject('Expired with hook');
    const result = purgeExpired(new Date('2001-01-01T00:00:00.000Z'));

    expect(result.projects).toBeGreaterThanOrEqual(1);
    expect(purged.some((ids) => ids.includes(project.id))).toBe(true);
    expect(db.prepare('SELECT 1 FROM projects WHERE id = ?').get(project.id)).toBeUndefined();
    // No purge audit event: the project's own events cascade with the row.
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE project_id = ?').get(project.id),
    ).toEqual({ count: 0 });
  });
});
