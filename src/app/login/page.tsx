import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';
import { getSessionUser, isFirstRun } from '@/server/auth/current-user';
import { getDb } from '@/server/db/connection';
import { resolveLandingHref } from '@/server/domain/users';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(resolveLandingHref(getDb(), user));
  if (await isFirstRun()) redirect('/setup');

  return (
    <AuthShell footer={<>For password recovery, contact an application Admin.</>}>
      <LoginForm />
    </AuthShell>
  );
}
