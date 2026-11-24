import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type {
  CommentProviderSummary,
  ProjectCommentAuthor,
  ProjectCommentView,
  ProjectCommentsData,
} from '@/lib/comments';
import { listCapabilityProviders, type AddonDefinition } from '@/server/addons';
import { newId, nowIso } from '@/server/db/util';
import {
  DomainError,
  canEditProject,
  canReadProject,
  isTrashedProject,
  loadAccessContext,
  type AccessUser,
} from './permissions';

/**
 * Basic comments capability (docs/add-on-platform.md §4 pattern).
 *
 * Core owns the comment rows, authors, permissions and plaintext fallback. The
 * active add-on owns the body format and the editor/renderer. There are no
 * replies or user mentions in this proof of concept.
 */

export const COMMENTS_CAPABILITY = 'comments';
export const MAX_COMMENT_TEXT_LENGTH = 20_000;

interface CommentRow {
  id: string;
  body: string;
  format: string;
  plaintext: string;
  created_at: string;
  author_id: string | null;
  author_username: string | null;
  author_avatar: string | null;
}

function providerSummary(definition: AddonDefinition): CommentProviderSummary | null {
  const formats = definition.formats;
  if (!formats) return null;
  return {
    identifier: definition.identifier,
    name: definition.name,
    version: definition.version,
    reads: [...formats.reads],
    writes: [...formats.writes],
  };
}

export function listCommentProviders(): CommentProviderSummary[] {
  return listCapabilityProviders(COMMENTS_CAPABILITY)
    .map(providerSummary)
    .filter((provider): provider is CommentProviderSummary => provider !== null);
}

export function getActiveCommentProvider(
  db: BetterSqliteDatabase,
): CommentProviderSummary | null {
  const providers = listCommentProviders();
  if (providers.length === 0) return null;
  const row = db
    .prepare('SELECT provider FROM addon_capabilities WHERE capability = ?')
    .get(COMMENTS_CAPABILITY) as { provider: string } | undefined;
  if (row) return providers.find((provider) => provider.identifier === row.provider) ?? null;
  return providers.length === 1 ? (providers[0] ?? null) : null;
}

function commentAuthor(row: CommentRow): ProjectCommentAuthor | null {
  if (row.author_id === null || row.author_username === null) return null;
  return {
    id: row.author_id,
    username: row.author_username,
    avatar: row.author_avatar,
  };
}

function toCommentView(row: CommentRow): ProjectCommentView {
  return {
    id: row.id,
    author: commentAuthor(row),
    body: row.body,
    format: row.format,
    plaintext: row.plaintext,
    createdAt: row.created_at,
  };
}

export function readProjectComments(
  db: BetterSqliteDatabase,
  projectId: string,
): ProjectCommentView[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.body, c.format, c.plaintext, c.created_at,
              u.id AS author_id, u.username AS author_username, u.avatar AS author_avatar
         FROM project_comments c
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.project_id = ?
        ORDER BY c.created_at ASC, c.id ASC`,
    )
    .all(projectId) as CommentRow[];
  return rows.map(toCommentView);
}

export function getProjectCommentsData(
  db: BetterSqliteDatabase,
  projectId: string,
  canEdit: boolean,
): ProjectCommentsData {
  const provider = getActiveCommentProvider(db);
  return {
    provider,
    comments: readProjectComments(db, projectId),
    canComment: canEdit && provider !== null,
  };
}

export function getProjectCommentsForUser(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): ProjectCommentsData {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  const canEdit = canEditProject(ctx, projectId) && !isTrashedProject(ctx, projectId);
  return getProjectCommentsData(db, projectId, canEdit);
}

export interface AddCommentInput {
  body?: unknown;
  format?: unknown;
  plaintext?: unknown;
}

export function addProjectComment(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  input: AddCommentInput,
): ProjectCommentView {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'This project is in Trash and is read-only.');
  }
  if (!canEditProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to comment.');
  }

  const provider = getActiveCommentProvider(db);
  if (!provider) {
    throw new DomainError(
      409,
      'comments_unavailable',
      'No comments provider is active. An Admin can choose one in Application settings.',
    );
  }

  const issues: Record<string, string> = {};
  const body = typeof input.body === 'string' ? input.body.trim() : null;
  const plaintext = typeof input.plaintext === 'string' ? input.plaintext : null;
  let format: string | null = null;

  if (body === null || body.length === 0) {
    issues.body = 'Write a comment before posting.';
  } else if (body.length > MAX_COMMENT_TEXT_LENGTH) {
    issues.body = `Keep comments under ${MAX_COMMENT_TEXT_LENGTH} characters.`;
  }
  if (plaintext === null) {
    issues.plaintext = 'The comment text is missing.';
  } else if (plaintext.length > MAX_COMMENT_TEXT_LENGTH) {
    issues.plaintext = `Keep comments under ${MAX_COMMENT_TEXT_LENGTH} characters.`;
  }
  if (typeof input.format !== 'string' || input.format.trim() === '') {
    issues.format = 'Choose a valid comment format.';
  } else if (!provider.writes.includes(input.format)) {
    issues.format = 'The active comments provider cannot write this format.';
  } else {
    format = input.format;
  }

  if (Object.keys(issues).length > 0 || body === null || plaintext === null || format === null) {
    throw new DomainError(422, 'validation_failed', 'Check the comment.', issues);
  }

  const id = newId();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO project_comments
       (id, project_id, author_id, body, format, plaintext, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?)`,
  ).run(id, projectId, user.id, body, format, plaintext, createdAt);

  return {
    id,
    author: {
      id: user.id,
      username: (db.prepare('SELECT username FROM users WHERE id = ?').get(user.id) as
        | { username: string }
        | undefined)?.username ?? '',
      avatar:
        (db.prepare('SELECT avatar FROM users WHERE id = ?').get(user.id) as
          | { avatar: string | null }
          | undefined)?.avatar ?? null,
    },
    body,
    format,
    plaintext,
    createdAt,
  };
}
