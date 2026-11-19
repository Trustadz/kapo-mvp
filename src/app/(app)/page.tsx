import type { Metadata } from 'next';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { requireUser } from '@/server/auth/current-user';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

/** / — the signed-in user's Home dashboard. */
export default async function HomePage() {
  const user = await requireUser();
  return <Dashboard user={user} />;
}
