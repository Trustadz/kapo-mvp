import type { Metadata } from 'next';
import { McpTokensSection } from '@/components/accounts/McpTokensSection';
import { ProfileForm } from '@/components/accounts/ProfileForm';
import { requireUser } from '@/server/auth/current-user';
import { listMcpTokens } from '@/server/auth/mcp-token';
import { getDb } from '@/server/db/connection';
import { getApplicationSettings } from '@/server/domain/settings';
import { listLandingPageOptions } from '@/server/domain/users';
import { getI18n } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('profile.heading') };
}
export const dynamic = 'force-dynamic';

/** /profile — account, avatar, landing page, appearance and password. */
export default async function ProfilePage() {
  const user = await requireUser();
  const db = getDb();
  const landingOptions = listLandingPageOptions(db, user);
  const mcpTokens = listMcpTokens(db, user.id);
  const mcpEnabled = getApplicationSettings(db).mcpEnabled;
  const { t } = await getI18n();

  return (
    <div>
      <div className="page-heading">
        <div className="page-heading-text">
          <h1>{t('profile.heading')}</h1>
          <p className="page-subtitle">{t('profile.subtitle')}</p>
        </div>
      </div>
      <ProfileForm user={user} landingOptions={landingOptions} />
      <McpTokensSection enabled={mcpEnabled} initialTokens={mcpTokens} />
    </div>
  );
}
