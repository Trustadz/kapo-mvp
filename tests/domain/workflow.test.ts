import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  ensureWorkflow,
  getWorkflowData,
  listWorkflow,
  replaceWorkflow,
  statusUsage,
} from '@/server/domain/workflow';
import { DomainError } from '@/server/domain/permissions';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  createProject,
  createRoot,
  createUser,
  createWorkflow,
  grantRole,
  type FixtureUser,
  type WorkflowStatusRow,
} from '../helpers/fixtures';

/**
 * Workflow editing rules (build-spec §6 rule 5, product.md §3–§4):
 * exactly one Start/Finish, explicit remapping for in-use statuses, deferral
 * for trashed children and permission checks.
 */

let test: TestDatabase;
let db: BetterSqliteDatabase;
let admin: FixtureUser;
let user: FixtureUser;
let rootId: string;
let homeId: string;
let homeStatuses: WorkflowStatusRow[];

function actor(who: FixtureUser) {
  return { id: who.id, appRole: who.appRole, showArchived: false };
}

function expectDomainError(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error('expected DomainError');
}

function childStatus(projectId: string): string | null {
  return (
    db.prepare('SELECT status_id FROM projects WHERE id = ?').get(projectId) as {
      status_id: string | null;
    }
  ).status_id;
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'workflow-domain' });
  db = test.db;
  admin = await createUser(db, { username: 'wf-admin', appRole: 'admin' });
  user = await createUser(db, { username: 'wf-user', appRole: 'user' });
  const root = createRoot(db, admin.id);
  rootId = root.id;
  grantRole(db, rootId, user.id, 'user');
  const home = createProject(db, {
    title: 'Home improvement',
    parentId: rootId,
    reporterId: admin.id,
  });
  homeId = home.id;
  grantRole(db, homeId, admin.id, 'admin');
  grantRole(db, homeId, user.id, 'admin');
  homeStatuses = createWorkflow(db, homeId);
});

afterAll(() => {
  test.cleanup();
});

describe('listWorkflow and ensureWorkflow', () => {
  it('returns statuses in position order with a single Start and Finish', () => {
    const statuses = listWorkflow(db, homeId);
    expect(statuses.map((status) => status.name)).toEqual(['To do', 'In progress', 'Done']);
    expect(statuses.filter((status) => status.isStart)).toHaveLength(1);
    expect(statuses.filter((status) => status.isFinish)).toHaveLength(1);
  });

  it('seeds the default To do / Done workflow when a project has none', () => {
    const fresh = createProject(db, {
      title: 'No workflow owner',
      parentId: homeId,
      reporterId: admin.id,
    });
    const seeded = ensureWorkflow(db, fresh.id);
    expect(seeded.map((status) => status.name)).toEqual(['To do', 'Done']);
    expect(seeded[0]?.isStart).toBe(true);
    expect(seeded[1]?.isFinish).toBe(true);
    // Idempotent.
    expect(ensureWorkflow(db, fresh.id).map((status) => status.id)).toEqual(
      seeded.map((status) => status.id),
    );
  });

  it('reports live and trashed usage per status', () => {
    const owner = createProject(db, {
      title: 'Usage owner',
      parentId: homeId,
      reporterId: admin.id,
    });
    const statuses = createWorkflow(db, owner.id, { names: ['One', 'Two'] });
    const live = createProject(db, {
      title: 'Live usage',
      parentId: owner.id,
      reporterId: admin.id,
      statusId: statuses[0]!.id,
    });
    const trashed = createProject(db, {
      title: 'Trashed usage',
      parentId: owner.id,
      reporterId: admin.id,
      statusId: statuses[1]!.id,
    });
    db.prepare('UPDATE projects SET trashed_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      trashed.id,
    );
    const usage = statusUsage(db, owner.id);
    expect(usage[statuses[0]!.id]).toEqual({ live: 1, trashed: 0 });
    expect(usage[statuses[1]!.id]).toEqual({ live: 0, trashed: 1 });
    void live;
    const data = getWorkflowData(db, owner.id);
    expect(data.statuses.map((status) => status.name)).toEqual(['One', 'Two']);
    expect(data.usage[statuses[0]!.id]?.live).toBe(1);
  });
});

describe('replaceWorkflow validation', () => {
  it('requires exactly one Start and one Finish', () => {
    const owner = createProject(db, {
      title: 'Validation owner',
      parentId: homeId,
      reporterId: admin.id,
    });
    const statuses = createWorkflow(db, owner.id, { names: ['One', 'Two'] });
    const noStart = expectDomainError(() =>
      replaceWorkflow(
        db,
        actor(admin),
        owner.id,
        statuses.map((status) => ({ id: status.id, name: status.name })),
        {},
      ),
    );
    expect(noStart.status).toBe(422);
    expect(noStart.message).toMatch(/Start/);

    const twoFinishes = expectDomainError(() =>
      replaceWorkflow(
        db,
        actor(admin),
        owner.id,
        [
          { id: statuses[0]!.id, name: 'One', isStart: true, isFinish: true },
          { id: statuses[1]!.id, name: 'Two', isFinish: true },
        ],
        {},
      ),
    );
    expect(twoFinishes.message).toMatch(/Finish/);
  });

  it('rejects empty workflows, duplicate names and over-long names', () => {
    const owner = createProject(db, {
      title: 'Name validation owner',
      parentId: homeId,
      reporterId: admin.id,
    });
    createWorkflow(db, owner.id, { names: ['One', 'Two'] });
    expect(
      expectDomainError(() => replaceWorkflow(db, actor(admin), owner.id, [], {})).status,
    ).toBe(422);
    expect(
      expectDomainError(() =>
        replaceWorkflow(
          db,
          actor(admin),
          owner.id,
          [
            { name: 'Same', isStart: true },
            { name: 'same', isFinish: true },
          ],
          {},
        ),
      ).message,
    ).toMatch(/unique/i);
    expect(
      expectDomainError(() =>
        replaceWorkflow(
          db,
          actor(admin),
          owner.id,
          [{ name: 'x'.repeat(61), isStart: true, isFinish: true }],
          {},
        ),
      ).status,
    ).toBe(422);
  });

  it('requires a project Admin and rejects trashed projects', async () => {
    const owner = createProject(db, {
      title: 'Permission owner',
      parentId: homeId,
      reporterId: admin.id,
    });
    const statuses = createWorkflow(db, owner.id, { names: ['One', 'Two'] });
    // Demote the user's Home grant so they are a project User, not Admin.
    db.prepare('UPDATE project_roles SET role = ? WHERE project_id = ? AND user_id = ?').run(
      'user',
      homeId,
      user.id,
    );
    expect(
      expectDomainError(() =>
        replaceWorkflow(
          db,
          actor(user),
          owner.id,
          statuses.map((status) => ({ id: status.id, name: status.name, isStart: status.isStart, isFinish: status.isFinish })),
          {},
        ),
      ).status,
    ).toBe(403);
    db.prepare('UPDATE project_roles SET role = ? WHERE project_id = ? AND user_id = ?').run(
      'admin',
      homeId,
      user.id,
    );
    db.prepare('UPDATE projects SET trashed_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      owner.id,
    );
    expect(
      expectDomainError(() =>
        replaceWorkflow(
          db,
          actor(admin),
          owner.id,
          statuses.map((status) => ({ id: status.id, name: status.name, isStart: status.isStart, isFinish: status.isFinish })),
          {},
        ),
      ).status,
    ).toBe(409);
    db.prepare('UPDATE projects SET trashed_at = NULL WHERE id = ?').run(owner.id);
  });
});

describe('replaceWorkflow editing', () => {
  it('adds, renames and reorders statuses', () => {
    const owner = createProject(db, {
      title: 'Edit owner',
      parentId: homeId,
      reporterId: admin.id,
    });
    const statuses = createWorkflow(db, owner.id, { names: ['One', 'Two'] });
    const result = replaceWorkflow(
      db,
      actor(admin),
      owner.id,
      [
        { name: 'Backlog', isStart: true },
        { id: statuses[0]!.id, name: 'Doing' },
        { id: statuses[1]!.id, name: 'Complete', isFinish: true },
      ],
      {},
    );
    expect(result.workflow.statuses.map((status) => status.name)).toEqual([
      'Backlog',
      'Doing',
      'Complete',
    ]);
    expect(result.workflow.statuses[1]?.id).toBe(statuses[0]!.id);
    expect(result.workflow.statuses.filter((status) => status.isStart)).toHaveLength(1);
    expect(result.workflow.statuses.find((status) => status.isFinish)?.name).toBe('Complete');
  });

  it('remaps live children of a removed status and audits the change', () => {
    const owner = createProject(db, {
      title: 'Remap owner',
      parentId: homeId,
      reporterId: admin.id,
    });
    const statuses = createWorkflow(db, owner.id, { names: ['One', 'Two', 'Three'] });
    const child = createProject(db, {
      title: 'Remapped child',
      parentId: owner.id,
      reporterId: admin.id,
      statusId: statuses[1]!.id,
    });

    // Removing "Two" without a mapping is rejected.
    expect(
      expectDomainError(() =>
        replaceWorkflow(
          db,
          actor(admin),
          owner.id,
          [
            { id: statuses[0]!.id, name: 'One', isStart: true },
            { id: statuses[2]!.id, name: 'Three', isFinish: true },
          ],
          {},
        ),
      ).code,
    ).toBe('mapping_required');

    const result = replaceWorkflow(
      db,
      actor(admin),
      owner.id,
      [
        { id: statuses[0]!.id, name: 'One', isStart: true },
        { id: statuses[2]!.id, name: 'Three', isFinish: true },
      ],
      { [statuses[1]!.id]: statuses[2]!.id },
    );
    expect(result.remappedChildren).toBe(1);
    expect(childStatus(child.id)).toBe(statuses[2]!.id);
    const event = db
      .prepare(
        "SELECT old_value, new_value FROM audit_events WHERE project_id = ? AND action = 'project.status_changed'",
      )
      .get(child.id) as { old_value: string; new_value: string } | undefined;
    expect(event).toMatchObject({ old_value: 'Two', new_value: 'Three' });
  });

  it('defers trashed children by retiring the removed status', () => {
    const owner = createProject(db, {
      title: 'Defer owner',
      parentId: homeId,
      reporterId: admin.id,
    });
    const statuses = createWorkflow(db, owner.id, { names: ['One', 'Two', 'Three'] });
    const child = createProject(db, {
      title: 'Deferred child',
      parentId: owner.id,
      reporterId: admin.id,
      statusId: statuses[1]!.id,
    });
    db.prepare('UPDATE projects SET trashed_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      child.id,
    );
    const result = replaceWorkflow(
      db,
      actor(admin),
      owner.id,
      [
        { id: statuses[0]!.id, name: 'One', isStart: true },
        { id: statuses[2]!.id, name: 'Three', isFinish: true },
      ],
      {},
    );
    expect(result.retiredStatuses).toBe(1);
    expect(result.remappedChildren).toBe(0);
    // The retired status is not offered as an active workflow status but the
    // trashed child keeps its reference until restore.
    expect(listWorkflow(db, owner.id).map((status) => status.id)).not.toContain(
      statuses[1]!.id,
    );
    expect(childStatus(child.id)).toBe(statuses[1]!.id);
    expect(getWorkflowData(db, owner.id).retired.map((status) => status.id)).toContain(
      statuses[1]!.id,
    );
  });
});
