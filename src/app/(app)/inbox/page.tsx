import { InboxPage } from '@/components/inbox/InboxPage';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { listInbox, listInboxTree } from '@/server/domain/inbox';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Inbox · Kapo' };

/** /inbox — the global Inbox queue and application-wide Tree (build-spec §4). */
export default async function InboxRoute() {
  const user = await requireUser();
  const actor = {
    id: user.id,
    appRole: user.appRole,
    showArchived: user.showArchived,
  };
  const db = getDb();
  return (
    <InboxPage
      initialItems={listInbox(db, actor)}
      initialTree={listInboxTree(db, actor)}
    />
  );
}
