import type { Metadata } from 'next';
import { ProfileForm } from '@/components/accounts/ProfileForm';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db/connection';
import { listLandingPageOptions } from '@/server/domain/users';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

/** /profile — account, avatar, landing page, appearance and password. */
export default async function ProfilePage() {
  const user = await requireUser();
  const db = getDb();
  const landingOptions = listLandingPageOptions(db, user);

  return (
    <div>
      <div className="page-heading">
        <div className="page-heading-text">
          <h1>Profile</h1>
          <p className="page-subtitle">Your account and preferences</p>
        </div>
      </div>
      <ProfileForm user={user} landingOptions={landingOptions} />
    </div>
  );
}
