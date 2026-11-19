import type { Metadata } from 'next';
import { UsersManager } from '@/components/accounts/UsersManager';
import { requireAdmin } from '@/server/auth/current-user';
import { getDb } from '@/server/db/connection';
import { getDefaultAccountRole } from '@/server/domain/settings';
import { listUsers } from '@/server/domain/users';

export const metadata: Metadata = { title: 'User management' };
export const dynamic = 'force-dynamic';

/** /users — account list and role management (Admin only). */
export default async function UsersPage() {
  await requireAdmin();
  const db = getDb();
  const users = listUsers(db);
  const defaultRole = getDefaultAccountRole(db);

  return (
    <div>
      <div className="page-heading">
        <div className="page-heading-text">
          <h1>User management</h1>
          <p className="page-subtitle">Application Admin only</p>
        </div>
      </div>
      <UsersManager users={users} defaultRole={defaultRole} />
    </div>
  );
}
