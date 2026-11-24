import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  createProject as createFixtureProject,
  type FixtureHousehold,
} from '../helpers/fixtures';
import { EMPTY_CONTEXT, json, params, request, signIn } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';
import { nowIso } from '@/server/db/util';
import { syncAddonRegistry } from '@/server/domain/project-addons';

/**
 * Basic comments capability: provider default, posting, permissions, plaintext
 * fallback and page integration.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const commentsRoute = await import('@/app/api/projects/[id]/comments/route');
const projectRoute = await import('@/app/api/projects/[id]/route');

const commentsGet = (id: string) =>
  commentsRoute.GET(request(`/api/projects/${id}/comments`), params(id));
const commentPost = (id: string, body: unknown) =>
  commentsRoute.POST(
    request(`/api/projects/${id}/comments`, { method: 'POST', body }),
    params(id),
  );
const projectGet = (id: string) => projectRoute.GET(request(`/api/projects/${id}`), params(id));

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;

interface CommentsPayload {
  comments: {
    provider: { identifier: string } | null;
    comments: Array<{
      id: string;
      author: { username: string } | null;
      body: string;
      format: string;
      plaintext: string;
    }>;
    canComment: boolean;
  };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-comments' });
  db = test.db;
  household = await buildHouseholdFixture(db);
  syncAddonRegistry(db);
});

beforeEach(() => {
  resetRequestContext();
  db.prepare('DELETE FROM project_comments').run();
  db.prepare("DELETE FROM addon_capabilities WHERE capability = 'comments'").run();
  signIn(db, household.admin.id);
});

afterAll(() => {
  test.cleanup();
});

describe('comments capability', () => {
  it('defaults to the comments Markdown provider and posts a comment', async () => {
    const initial = await commentsGet(household.home.id);
    expect(initial.status).toBe(200);
    const initialPayload = await json<CommentsPayload>(initial);
    expect(initialPayload.comments.provider?.identifier).toBe('comments-markdown');
    expect(initialPayload.comments.comments).toEqual([]);
    expect(initialPayload.comments.canComment).toBe(true);

    const posted = await commentPost(household.home.id, {
      body: '**Bold** *italic* __under__ ~~gone~~',
      format: 'comment-md@1',
      plaintext: 'Bold italic under gone',
    });
    expect(posted.status).toBe(200);
    const postedPayload = await json<{
      comment: { body: string; author: { username: string } };
    }>(posted);
    expect(postedPayload.comment.author.username).toBe('admin');
    expect(postedPayload.comment.body).toContain('**Bold**');

    const after = await json<CommentsPayload>(await commentsGet(household.home.id));
    expect(after.comments.comments).toHaveLength(1);
    expect(after.comments.comments[0]?.plaintext).toBe('Bold italic under gone');

    const page = await json<CommentsPayload>(await projectGet(household.home.id));
    expect(page.comments.comments[0]?.body).toContain('**Bold**');
  });

  it('keeps viewers read-only and refuses trashed projects', async () => {
    signIn(db, household.alex.id);
    const read = await json<CommentsPayload>(await commentsGet(household.home.id));
    expect(read.comments.canComment).toBe(false);
    expect((await commentPost(household.home.id, {
      body: 'Viewer comment',
      format: 'comment-md@1',
      plaintext: 'Viewer comment',
    })).status).toBe(403);

    signIn(db, household.admin.id);
    const trashed = createFixtureProject(db, {
      title: 'Trashed comments',
      parentId: household.home.id,
      reporterId: household.admin.id,
      trashedAt: nowIso(),
    });
    expect((await commentPost(trashed.id, {
      body: 'Trashed comment',
      format: 'comment-md@1',
      plaintext: 'Trashed comment',
    })).status).toBe(409);
  });

  it('validates the body and format', async () => {
    const empty = await commentPost(household.home.id, {
      body: '   ',
      format: 'comment-md@1',
      plaintext: '',
    });
    expect(empty.status).toBe(422);

    const wrongFormat = await commentPost(household.home.id, {
      body: 'hello',
      format: 'html@1',
      plaintext: 'hello',
    });
    expect(wrongFormat.status).toBe(422);
  });

  it('falls back to plaintext when no provider is active', async () => {
    db.prepare(
      "INSERT INTO addon_capabilities (capability, provider, updated_at) VALUES ('comments', '@none', ?)",
    ).run(nowIso());
    const read = await json<CommentsPayload>(await commentsGet(household.home.id));
    expect(read.comments.provider).toBeNull();
    expect(read.comments.canComment).toBe(false);
  });
});
