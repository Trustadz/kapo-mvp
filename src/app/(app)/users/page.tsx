import type { Metadata } from 'next';
import { UsersManager } from '@/components/accounts/UsersManager';
import { requireAdmin } from '@/server/auth/current-user';
import { getDb } from '@/server/db/connection';
import { getDefaultAccountRole } from '@/server/domain/settings';
import { listUsers } from '@/server/domain/users';
import { getI18n } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('users.heading') };
}
export const dynamic = 'force-dynamic';

/** /users — account list and role management (Admin only). */
export default async function UsersPage() {
  await requireAdmin();
  const db = getDb();
  const users = listUsers(db);
  const defaultRole = getDefaultAccountRole(db);
  const { t } = await getI18n();

  return (
    <div>
      <div className="page-heading">
        <div className="page-heading-text">
          <h1>{t('users.heading')}</h1>
        </div>
      </div>
      <UsersManager users={users} defaultRole={defaultRole} />
    </div>
  );
}
