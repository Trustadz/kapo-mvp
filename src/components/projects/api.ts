'use client';

import { patchJson, postJson, requestJson, type ApiResult } from '@/lib/api-client';
import type {
  ActivityPageData,
  MoveInfo,
  ProjectCard,
  ProjectSettingsData,
  RestoreInfo,
  WorkflowViewData,
} from './types';
import type { ProjectRole, Status } from '@/lib/types';
import type { ProjectAccessMode } from '@/lib/projects';

/** Client-side calls to the project APIs; every error carries the §7 shape. */

export function toggleProjectFavorite(
  projectId: string,
): Promise<ApiResult<{ favorite: boolean }>> {
  return postJson(`/api/projects/${projectId}/favorite`, {});
}

export function updateProjectFields(
  projectId: string,
  body: { title?: string; statusId?: string; archived?: boolean },
): Promise<ApiResult<{ project: ProjectCard }>> {
  return requestJson(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createChildProject(
  parentId: string,
  title: string,
): Promise<ApiResult<{ project: ProjectCard }>> {
  return postJson('/api/projects', { parentId, title });
}

export function reorderProjectRequest(
  projectId: string,
  body: { statusId: string; beforeId: string | null },
): Promise<ApiResult<{ project: ProjectCard }>> {
  return postJson(`/api/projects/${projectId}/reorder`, body);
}

export function moveProjectRequest(
  projectId: string,
  body: { destinationId: string; mapping: Record<string, string> },
): Promise<ApiResult<{ project: ProjectCard }>> {
  return postJson(`/api/projects/${projectId}/move`, body);
}

export interface BulkMoveResponse {
  moved: ProjectCard[];
  destination: { id: string; title: string };
}

export function bulkMoveProjects(
  triggerProjectId: string,
  projectIds: string[],
  destinationId: string,
  mapping: Record<string, string>,
): Promise<ApiResult<BulkMoveResponse>> {
  return postJson(`/api/projects/${triggerProjectId}/move`, {
    projectIds,
    destinationId,
    mapping,
  });
}

export interface BulkTrashResponse {
  actionId: string;
  trashed: string[];
}

export function bulkTrashProjects(
  triggerProjectId: string,
  projectIds: string[],
): Promise<ApiResult<BulkTrashResponse>> {
  return postJson(`/api/projects/${triggerProjectId}/trash`, { projectIds });
}

export function fetchMoveInfo(projectId: string): Promise<ApiResult<MoveInfo>> {
  return requestJson(`/api/projects/${projectId}/move`, { method: 'GET' });
}

export function trashProjectRequest(
  projectId: string,
): Promise<ApiResult<{ actionId: string; trashed: string[] }>> {
  return postJson(`/api/projects/${projectId}/trash`, {});
}

export function fetchRestoreInfo(projectId: string): Promise<ApiResult<RestoreInfo>> {
  return requestJson(`/api/projects/${projectId}/restore`, { method: 'GET' });
}

export function restoreProjectRequest(
  projectId: string,
  mapping?: Record<string, string>,
): Promise<ApiResult<{ project: ProjectCard; restored: string[] }>> {
  return postJson(`/api/projects/${projectId}/restore`, mapping ? { mapping } : {});
}

export function releaseInboxProject(
  projectId: string,
): Promise<ApiResult<{ project: ProjectCard }>> {
  return postJson(`/api/inbox/${projectId}/release`, {});
}

export function fetchActivityPage(
  projectId: string,
  cursor: string,
): Promise<ApiResult<ActivityPageData>> {
  return requestJson(
    `/api/projects/${projectId}/activity?cursor=${encodeURIComponent(cursor)}`,
    { method: 'GET' },
  );
}

export function saveProjectSettings(
  projectId: string,
  body: Partial<ProjectSettingsData>,
): Promise<ApiResult<{ settings: ProjectSettingsData }>> {
  return requestJson(`/api/projects/${projectId}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface WorkflowSaveBody {
  statuses: Array<{ id?: string | null; name: string; isStart: boolean; isFinish: boolean }>;
  mapping: Record<string, string>;
}

export function saveWorkflow(
  projectId: string,
  body: WorkflowSaveBody,
): Promise<ApiResult<{ workflow: WorkflowViewData; remappedChildren: number; retiredStatuses: number }>> {
  return requestJson(`/api/projects/${projectId}/workflow`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface MemberChangeBody {
  changes: Array<{ userId: string; role: ProjectRole | null }>;
  acknowledged?: boolean;
  access?: ProjectAccessMode;
}

export interface MemberCandidate {
  id: string;
  username: string;
  appRole: string;
  explicitRole: ProjectRole | null;
  inheritedRole: ProjectRole | null;
  effectiveRole: ProjectRole | null;
}

export interface MembersResponse {
  members: Array<{
    userId: string;
    username: string;
    role: ProjectRole;
    appRole: string;
    descendantGrants: number;
  }>;
  candidates?: MemberCandidate[];
  canManage: boolean;
  access?: ProjectAccessMode;
  isRoot?: boolean;
  cascadeImpact?: number;
  cascadedProjects?: number;
}

export function fetchMembers(projectId: string): Promise<ApiResult<MembersResponse>> {
  return requestJson(`/api/projects/${projectId}/members`, { method: 'GET' });
}

export function saveMembers(
  projectId: string,
  body: MemberChangeBody,
): Promise<ApiResult<MembersResponse>> {
  return requestJson(`/api/projects/${projectId}/members`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface ShowArchivedResponse {
  user?: { showArchived?: boolean };
  showArchived?: boolean;
}

export function setShowArchived(showArchived: boolean): Promise<ApiResult<ShowArchivedResponse>> {
  return patchJson('/api/me', { showArchived });
}

export function statusOptionsFor(statuses: Status[]): Status[] {
  return [...statuses].sort((a, b) => a.position - b.position);
}
