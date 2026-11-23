import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';
import { getSessionUser, isFirstRun } from '@/server/auth/current-user';
import { getOidcConfig } from '@/server/auth/oidc';
import { getDb } from '@/server/db/connection';
import { resolveLandingHref } from '@/server/domain/users';
import { getI18n } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('auth.signIn') };
}
export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getSessionUser();
  if (user) redirect(resolveLandingHref(getDb(), user));
  if (await isFirstRun()) redirect('/setup');

  const { t } = await getI18n();
  const config = getOidcConfig();
  const params = await searchParams;
  const errorCode = typeof params.error === 'string' ? params.error : null;

  return (
    <AuthShell
      footer={
        <>
          {config.passwordLoginEnabled
            ? t('auth.passwordRecovery')
            : t('auth.contactAdmin')}
        </>
      }
    >
      <LoginForm
        ssoEnabled={config.enabled}
        ssoProviderName={config.providerName}
        passwordLoginEnabled={config.passwordLoginEnabled}
        errorCode={errorCode}
      />
    </AuthShell>
  );
}
