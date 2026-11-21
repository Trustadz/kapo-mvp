import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ProjectSettingsPage } from '@/components/projects/ProjectSettingsPage';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import {
  listMemberCandidates,
  listProjectMembers,
} from '@/server/domain/permissions';
import { getProjectAddonSettings } from '@/server/domain/project-addons';
import { getProjectPageData } from '@/server/domain/projects';
import { getWorkflowData } from '@/server/domain/workflow';
import { getI18n } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('settings.projectSettings') };
}

const BASE_TABS = ['general', 'workflow', 'members', 'layout'] as const;
type TabId = (typeof BASE_TABS)[number] | 'addons';

interface SettingsRouteProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

/** /p/[id]/settings?tab=general|workflow|members|layout|addons (page 08). */
export default async function ProjectSettingsRoute({ params, searchParams }: SettingsRouteProps) {
  const user = await requireUser();
  const { id } = await params;
  const paramsQuery = await searchParams;
  const db = getDb();
  const accessUser = { id: user.id, appRole: user.appRole, showArchived: user.showArchived };
  const data = getProjectPageData(db, accessUser, id);
  if (!data) notFound();
  if (!data.project.canAdmin) redirect(`/p/${id}`);

  // The Add-ons tab only exists while the registry is non-empty.
  const addons = getProjectAddonSettings(db, accessUser, id);
  const tabs: TabId[] = addons.length > 0 ? [...BASE_TABS, 'addons'] : [...BASE_TABS];
  const rawTab = Array.isArray(paramsQuery.tab) ? paramsQuery.tab[0] : paramsQuery.tab;
  const tab: TabId = (tabs as readonly string[]).includes(rawTab ?? '')
    ? (rawTab as TabId)
    : 'general';

  return (
    <ProjectSettingsPage
      data={data}
      workflow={getWorkflowData(db, id)}
      members={listProjectMembers(db, id)}
      candidates={listMemberCandidates(db, id)}
      addons={addons}
      viewerId={user.id}
      tab={tab}
    />
  );
}
