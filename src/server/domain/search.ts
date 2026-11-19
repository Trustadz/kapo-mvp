import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { SearchMatch, SearchResultItem, TrashItem } from '@/lib/projects';
import { listTrash } from './trash';
import {
  canReadProject,
  isActiveProject,
  isArchivedHidden,
  loadAccessContext,
  type AccessContext,
  type AccessUser,
} from './permissions';

/**
 * Permission-filtered full-text search (build-spec §6 rule 11, §7).
 *
 * FTS5 keeps an index of titles and future add-on body text. Prefix matching is
 * supported by appending `*` to every quoted token. Rows are filtered through
 * the permission engine before titles are returned: trashed projects never
 * appear in ordinary results and archived projects follow show_archived.
 */

const MAX_TOKENS = 8;
const SEARCH_LIMIT = 50;

interface SearchRow {
  project_id: string;
  title: string;
  body: string;
  rank: number;
}

function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, MAX_TOKENS);
}

function matchExpression(tokens: readonly string[]): string {
  return tokens
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' AND ');
}

function firstMatchToken(text: string, tokens: readonly string[]): string | null {
  const haystack = text.toLowerCase();
  for (const token of tokens) {
    if (haystack.includes(token.toLowerCase())) return token;
  }
  return null;
}

function snippet(text: string, token: string, length = 80): string {
  const index = text.toLowerCase().indexOf(token.toLowerCase());
  if (index < 0) return text.slice(0, length);
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + token.length + 48);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function parentContext(
  ctx: AccessContext,
  db: BetterSqliteDatabase,
  parentId: string | null,
): { parentTitle: string | null; directAccess: boolean } {
  if (!parentId) return { parentTitle: null, directAccess: false };
  const parent = ctx.projectById.get(parentId);
  if (!parent) return { parentTitle: null, directAccess: true };
  if (!canReadProject(ctx, parentId)) return { parentTitle: null, directAccess: true };
  const row = db.prepare('SELECT title FROM projects WHERE id = ?').get(parentId) as
    | { title: string }
    | undefined;
  return { parentTitle: row?.title ?? null, directAccess: false };
}

export interface SearchOptions {
  limit?: number;
}

export function searchProjects(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  rawQuery: string,
  options: SearchOptions = {},
): SearchResultItem[] {
  const tokens = tokenize(rawQuery);
  if (tokens.length === 0) return [];
  const ctx = loadAccessContext(db, actor);
  const expression = matchExpression(tokens);
  const limit = Math.min(Math.max(options.limit ?? SEARCH_LIMIT, 1), 100);

  // Permissions are filtered in JS, so fetch progressively larger pages until
  // the visible result count reaches the requested limit (AR-043).
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  let fetchSize = Math.max(limit * 4, 40);
  const maxFetchSize = 400;
  const statement = db.prepare(
    `SELECT project_id, title, body, bm25(project_search) AS rank
       FROM project_search
      WHERE project_search MATCH ?
      ORDER BY rank ASC
      LIMIT ?`,
  );

  while (results.length < limit && fetchSize <= maxFetchSize) {
    let rows: SearchRow[];
    try {
      rows = statement.all(expression, fetchSize) as SearchRow[];
    } catch {
      // A malformed FTS expression (e.g. only punctuation) yields no results.
      return [];
    }
    for (const row of rows) {
      if (results.length >= limit) break;
      if (seen.has(row.project_id)) continue;
      if (!isActiveProject(ctx, row.project_id)) continue;
      seen.add(row.project_id);
      const project = ctx.projectById.get(row.project_id);
      if (!project) continue;
      const parent = parentContext(ctx, db, project.parentId);
      const titleMatch = firstMatchToken(row.title, tokens);
      const bodyMatch = row.body ? firstMatchToken(row.body, tokens) : null;
      let match: SearchMatch;
      if (titleMatch) {
        match = { field: 'Title', text: row.title };
      } else if (bodyMatch && row.body) {
        match = { field: 'Text', text: snippet(row.body, bodyMatch) };
      } else {
        match = { field: 'Title', text: row.title };
      }
      const statusRow = db
        .prepare(
          `SELECT s.name AS name FROM projects p JOIN statuses s ON s.id = p.status_id WHERE p.id = ?`,
        )
        .get(row.project_id) as { name: string } | undefined;
      results.push({
        id: row.project_id,
        title: row.title,
        parentTitle: parent.parentTitle,
        directAccess: parent.directAccess,
        archived: isArchivedHidden(ctx, row.project_id),
        statusName: statusRow?.name ?? null,
        match,
      });
    }
    if (rows.length < fetchSize) break;
    fetchSize *= 2;
  }
  return results;
}

export function searchTrash(
  db: BetterSqliteDatabase,
  actor: AccessUser,
  rawQuery: string,
): TrashItem[] {
  const items = listTrash(db, actor);
  const query = rawQuery.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => item.title.toLowerCase().includes(query));
}
