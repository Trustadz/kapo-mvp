import type { ProjectCard, ProjectWithParent } from '@/lib/projects';

/**
 * Per-user/per-project "Show Inbox items" preference (PO issue #16).
 *
 * Inbox-flagged children are hidden from a project's child collections by
 * default. The preference is local to the viewer and the project, so it is
 * stored in localStorage rather than on the project settings row.
 */
export const SHOW_INBOX_STORAGE_PREFIX = 'kapo:show-inbox:';

export function showInboxStorageKey(projectId: string): string {
  return `${SHOW_INBOX_STORAGE_PREFIX}${projectId}`;
}

export function readShowInboxPreference(projectId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(showInboxStorageKey(projectId)) === '1';
  } catch {
    return false;
  }
}

export function writeShowInboxPreference(projectId: string, showInbox: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(showInboxStorageKey(projectId), showInbox ? '1' : '0');
  } catch {
    /* ignore unavailable storage */
  }
}

/**
 * Filters Inbox-flagged projects out of a flat collection (Kanban/Card/List).
 * When the preference is on every item is returned unchanged.
 */
export function filterInboxItems<T extends ProjectCard>(
  projects: readonly T[],
  showInbox: boolean,
): T[] {
  if (showInbox) return [...projects];
  return projects.filter((project) => !project.inbox);
}

/**
 * Filters Inbox-flagged projects out of the Tree's flat, depth-first
 * descendant list.
 *
 * The list is parent-linked (each row carries `parentId`), so hiding an Inbox
 * row must hide its whole subtree as well: otherwise those children would be
 * rendered without an ancestor, and "Select all"/bulk actions could target
 * rows that are not on screen.
 */
export function filterInboxDescendants(
  descendants: readonly ProjectWithParent[],
  showInbox: boolean,
): ProjectWithParent[] {
  if (showInbox) return [...descendants];
  const hidden = new Set<string>();
  const visible: ProjectWithParent[] = [];
  for (const project of descendants) {
    if (project.inbox || (project.parentId !== null && hidden.has(project.parentId))) {
      hidden.add(project.id);
      continue;
    }
    visible.push(project);
  }
  return visible;
}
