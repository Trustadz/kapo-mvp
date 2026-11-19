import { apiRoute } from '@/server/api-route';
import {
  applyMemberChanges,
  canAdminProject,
  getProjectAccessMode,
  listMemberCandidates,
  listProjectMembers,
  loadAccessContext,
  type MemberChange,
} from '@/server/domain/permissions';
import type { ProjectAccessMode } from '@/lib/projects';
import { jsonError, jsonOk, methodNotAllowed, readJsonBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Params = { id: string };

function parseChanges(data: Record<string, unknown>): MemberChange[] {
  const raw = Array.isArray(data.changes) ? data.changes : Array.isArray(data.members) ? data.members : [];
  const changes: MemberChange[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { userId?: unknown; role?: unknown };
    if (typeof candidate.userId !== 'string' || !candidate.userId) continue;
    const role =
      candidate.role === 'admin' || candidate.role === 'user' || candidate.role === 'viewer'
        ? candidate.role
        : candidate.role === null
          ? null
          : undefined;
    if (role === undefined) continue;
    changes.push({ userId: candidate.userId, role });
  }
  return changes;
}

/** GET /api/projects/:id/members — explicit grants with cascade impact. */
export const GET = apiRoute<Params>(async ({ db, accessUser, params }) => {
  if (!canAdminProject(loadAccessContext(db, accessUser), params.id)) {
    return jsonError(403, 'forbidden', 'You must be a project Admin to view members.');
  }
  const members = listProjectMembers(db, params.id);
  const row = db.prepare('SELECT parent_id FROM projects WHERE id = ?').get(params.id) as
    | { parent_id: string | null }
    | undefined;
  return jsonOk({
    members,
    candidates: listMemberCandidates(db, params.id),
    canManage: true,
    access: getProjectAccessMode(db, params.id),
    isRoot: row?.parent_id === null,
    cascadeImpact: members.reduce((total, member) => total + member.descendantGrants, 0),
  });
});

/** PUT /api/projects/:id/members — set roles, cascade validation/acknowledgement. */
export const PUT = apiRoute<Params>(
  async ({ db, accessUser, params, request }) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const changes = parseChanges(body.data);
    const acknowledged = body.data.acknowledged === true || body.data.acknowledgeCascade === true;
    const access: ProjectAccessMode | undefined =
      body.data.access === 'inherit' || body.data.access === 'custom'
        ? body.data.access
        : undefined;
    const result = applyMemberChanges(db, params.id, changes, {
      acknowledged,
      actor: accessUser,
      access,
    });
    const row = db.prepare('SELECT parent_id FROM projects WHERE id = ?').get(params.id) as
      | { parent_id: string | null }
      | undefined;
    return jsonOk({
      members: result.members,
      cascadedProjects: result.cascadedProjects,
      canManage: true,
      access: result.access,
      isRoot: row?.parent_id === null,
    });
  },
  { mutation: true },
);

export function POST() {
  return methodNotAllowed(['GET', 'PUT']);
}
