import type { Metadata } from 'next';
import { ApplicationSettingsForm } from '@/components/settings/ApplicationSettingsForm';
import { requireAdmin } from '@/server/auth/current-user';
import { getBackupStatus } from '@/server/backup';
import { getDb } from '@/server/db/connection';
import { listAddonApplicationConfigs } from '@/server/domain/project-addons';
import { getApplicationSettings } from '@/server/domain/settings';
import { getI18n } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('settings.heading') };
}
export const dynamic = 'force-dynamic';

/** /settings — application defaults (Admin only). */
export default async function ApplicationSettingsPage() {
  await requireAdmin();
  const db = getDb();
  const settings = getApplicationSettings(db);
  const addons = listAddonApplicationConfigs(db);
  const backupStatus = getBackupStatus(db);
  const { t } = await getI18n();

  return (
    <div>
      <div className="page-heading">
        <div className="page-heading-text">
          <h1>{t('settings.heading')}</h1>
          <p className="page-subtitle">{t('settings.subtitle')}</p>
        </div>
      </div>
      <ApplicationSettingsForm settings={settings} backupStatus={backupStatus} addons={addons} />
    </div>
  );
}
