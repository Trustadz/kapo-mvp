import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { requireUser } from '@/server/auth/current-user';
import { getShellData } from '@/server/db/shell-queries';

/**
 * Authenticated layout: wraps every signed-in page in the application shell
 * and redirects to /login when there is no session.
 */

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const shellData = getShellData(user.id);

  return (
    <AppShell
      user={user}
      favorites={shellData.favorites}
      rootProjectId={shellData.rootProjectId}
      installationName={shellData.installationName}
    >
      {children}
    </AppShell>
  );
}
