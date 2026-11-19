import { SearchPage } from '@/components/search/SearchPage';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { searchProjects, searchTrash } from '@/server/domain/search';
import { groupTrashItems } from '@/server/domain/trash';
import type { SearchResultItem, TrashGroup, TrashItem } from '@/components/projects/types';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Search · Kapo' };

interface SearchRouteProps {
  searchParams: Promise<{ q?: string | string[]; tab?: string | string[] }>;
}

/** /search?q=&tab=search|trash (build-spec §4, product.md §8). */
export default async function SearchRoute({ searchParams }: SearchRouteProps) {
  const user = await requireUser();
  const params = await searchParams;
  const tab = params.tab === 'trash' ? 'trash' : 'search';
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (rawQuery ?? '').trim();
  const accessUser = { id: user.id, appRole: user.appRole, showArchived: user.showArchived };
  const db = getDb();

  const results: SearchResultItem[] = tab === 'search' ? searchProjects(db, accessUser, query) : [];
  const trashItems: TrashItem[] = tab === 'trash' ? searchTrash(db, accessUser, query) : [];
  const trashGroups: TrashGroup[] = groupTrashItems(trashItems);

  return (
    <SearchPage
      tab={tab}
      query={query}
      results={results}
      trashItems={trashItems}
      trashGroups={trashGroups}
    />
  );
}
