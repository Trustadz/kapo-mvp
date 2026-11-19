import { apiRoute } from '@/server/api-route';
import { searchProjects, searchTrash } from '@/server/domain/search';
import { groupTrashItems } from '@/server/domain/trash';
import { jsonOk, methodNotAllowed } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=&tab=search|trash
 * Ordinary results exclude Trash; the Trash tab is an explicit, separate list.
 */
export const GET = apiRoute(async ({ db, accessUser, request }) => {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const tab = url.searchParams.get('tab') === 'trash' ? 'trash' : 'search';
  if (tab === 'trash') {
    const trash = searchTrash(db, accessUser, query);
    return jsonOk({ query, tab, trash, trashGroups: groupTrashItems(trash) });
  }
  return jsonOk({ query, tab, results: searchProjects(db, accessUser, query) });
});

export function POST() {
  return methodNotAllowed(['GET']);
}
