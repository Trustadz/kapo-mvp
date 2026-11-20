import type { Metadata } from 'next';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { requireUser } from '@/server/auth/current-user';
import { getI18n } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('dashboard.title') };
}
export const dynamic = 'force-dynamic';

/** / — the signed-in user's Home dashboard. */
export default async function HomePage() {
  const user = await requireUser();
  return <Dashboard user={user} />;
}
