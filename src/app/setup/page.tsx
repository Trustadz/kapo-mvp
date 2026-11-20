import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { SetupForm } from '@/components/auth/SetupForm';
import { getSessionUser, isFirstRun } from '@/server/auth/current-user';
import { getI18n } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('auth.createAccount') };
}
export const dynamic = 'force-dynamic';

/**
 * First-install route. Only available while the installation has zero users;
 * creates the first application Admin and signs them in.
 */
export default async function SetupPage() {
  const user = await getSessionUser();
  if (user) redirect('/');
  if (!(await isFirstRun())) redirect('/login');

  return (
    <AuthShell>
      <SetupForm />
    </AuthShell>
  );
}
