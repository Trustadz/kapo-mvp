import { InboxPage } from '@/components/inbox/InboxPage';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { listInbox } from '@/server/domain/inbox';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Inbox · Kapo' };

/** /inbox — the global Inbox queue (build-spec §4). */
export default async function InboxRoute() {
  const user = await requireUser();
  const items = listInbox(getDb(), {
    id: user.id,
    appRole: user.appRole,
    showArchived: user.showArchived,
  });
  return <InboxPage initialItems={items} />;
}
