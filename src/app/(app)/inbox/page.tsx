import type { Metadata } from 'next';
import { InboxPage } from '@/components/inbox/InboxPage';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { listInbox, listInboxTree } from '@/server/domain/inbox';
import { getI18n } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('inbox.title') };
}

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
