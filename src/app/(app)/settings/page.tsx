import type { Metadata } from 'next';
import { ApplicationSettingsForm } from '@/components/settings/ApplicationSettingsForm';
import { requireAdmin } from '@/server/auth/current-user';
import { getDb } from '@/server/db/connection';
import { getApplicationSettings } from '@/server/domain/settings';

export const metadata: Metadata = { title: 'Application settings' };
export const dynamic = 'force-dynamic';

/** /settings — application defaults (Admin only). */
export default async function ApplicationSettingsPage() {
  await requireAdmin();
  const settings = getApplicationSettings(getDb());

  return (
    <div>
      <div className="page-heading">
        <div className="page-heading-text">
          <h1>Application settings</h1>
          <p className="page-subtitle">Manage your Kapo installation</p>
        </div>
      </div>
      <ApplicationSettingsForm settings={settings} />
    </div>
  );
}
