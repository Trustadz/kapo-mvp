import { notFound, redirect } from 'next/navigation';
import { ProjectSettingsPage } from '@/components/projects/ProjectSettingsPage';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import {
  listMemberCandidates,
  listProjectMembers,
} from '@/server/domain/permissions';
import { getProjectPageData } from '@/server/domain/projects';
import { getWorkflowData } from '@/server/domain/workflow';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Project settings · Kapo' };

const TABS = ['general', 'workflow', 'members', 'layout'] as const;
type TabId = (typeof TABS)[number];

interface SettingsRouteProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

/** /p/[id]/settings?tab=general|workflow|members|layout (page 08). */
export default async function ProjectSettingsRoute({ params, searchParams }: SettingsRouteProps) {
  const user = await requireUser();
  const { id } = await params;
  const paramsQuery = await searchParams;
  const rawTab = Array.isArray(paramsQuery.tab) ? paramsQuery.tab[0] : paramsQuery.tab;
  const tab: TabId = (TABS as readonly string[]).includes(rawTab ?? '')
    ? (rawTab as TabId)
    : 'general';

  const db = getDb();
  const accessUser = { id: user.id, appRole: user.appRole, showArchived: user.showArchived };
  const data = getProjectPageData(db, accessUser, id);
  if (!data) notFound();
  if (!data.project.canAdmin) redirect(`/p/${id}`);

  return (
    <ProjectSettingsPage
      data={data}
      workflow={getWorkflowData(db, id)}
      members={listProjectMembers(db, id)}
      candidates={listMemberCandidates(db, id)}
      viewerId={user.id}
      tab={tab}
    />
  );
}
