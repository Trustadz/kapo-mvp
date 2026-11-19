import { notFound } from 'next/navigation';
import { ProjectView } from '@/components/projects/ProjectView';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { getProjectPageData } from '@/server/domain/projects';

export const dynamic = 'force-dynamic';

interface ProjectRouteProps {
  params: Promise<{ id: string }>;
}

/** /p/[id] — project page: header, details, properties, child collection, activity. */
export default async function ProjectRoute({ params }: ProjectRouteProps) {
  const user = await requireUser();
  const { id } = await params;
  const data = getProjectPageData(getDb(), {
    id: user.id,
    appRole: user.appRole,
    showArchived: user.showArchived,
  }, id);
  if (!data) notFound();
  return <ProjectView data={data} />;
}
