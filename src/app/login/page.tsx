import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';
import { getSessionUser, isFirstRun } from '@/server/auth/current-user';
import { getDb } from '@/server/db/connection';
import { resolveLandingHref } from '@/server/domain/users';
import { getI18n } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('auth.signIn') };
}
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(resolveLandingHref(getDb(), user));
  if (await isFirstRun()) redirect('/setup');

  const { t } = await getI18n();
  return (
    <AuthShell footer={<>{t('auth.passwordRecovery')}</>}>
      <LoginForm />
    </AuthShell>
  );
}
