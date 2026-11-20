import type { ProjectCard, ProjectWithParent } from '@/lib/projects';

/**
 * Session-only filters for a project page's child collection (issue #55).
 *
 * Filtering happens in `ChildProjects` before the collection is handed to a
 * view, so Kanban counts, Card/List/Tree rows, empty states and bulk actions
 * all see the same filtered set.
 *
 * The shape is intentionally small but extensible: add-on collections can add
 * fields to `ProjectFilterState` and append a predicate in
 * `activeFilterPredicates` without touching the views.
 */
export interface ProjectFilterState {
  /** Case-insensitive substring match against the project title. */
  title: string;
  /** Reporter user id, or null for "All reporters". */
  reporterId: string | null;
}

export const EMPTY_PROJECT_FILTERS: ProjectFilterState = {
  title: '',
  reporterId: null,
};

/** One composable filter check. Future add-on filters implement this shape. */
export type ProjectFilterPredicate = (project: ProjectCard) => boolean;

/** True when at least one filter narrows the collection. */
export function hasActiveProjectFilters(filters: ProjectFilterState): boolean {
  return filters.title.trim().length > 0 || filters.reporterId !== null;
}

/**
 * Live title search: trimmed, case-insensitive substring match. An empty or
 * whitespace-only query matches every project.
 */
export function matchesProjectTitle(project: ProjectCard, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return true;
  return project.title.toLowerCase().includes(term);
}

/** Reporter filter; `null` means "All reporters". */
export function matchesProjectReporter(
  project: ProjectCard,
  reporterId: string | null,
): boolean {
  return reporterId === null || project.reporter.id === reporterId;
}

/** Predicates for the currently active core filters (extend here for add-ons). */
export function activeFilterPredicates(
  filters: ProjectFilterState,
): ProjectFilterPredicate[] {
  const predicates: ProjectFilterPredicate[] = [];
  if (filters.title.trim().length > 0) {
    const term = filters.title;
    predicates.push((project) => matchesProjectTitle(project, term));
  }
  if (filters.reporterId !== null) {
    const reporterId = filters.reporterId;
    predicates.push((project) => matchesProjectReporter(project, reporterId));
  }
  return predicates;
}

/** Every active filter must match (AND semantics). */
export function matchesProjectFilters(
  project: ProjectCard,
  filters: ProjectFilterState,
): boolean {
  return activeFilterPredicates(filters).every((predicate) => predicate(project));
}

/** Filters a flat collection (Kanban/Card/List) preserving the input order. */
export function filterProjectItems<T extends ProjectCard>(
  projects: readonly T[],
  filters: ProjectFilterState,
): T[] {
  return projects.filter((project) => matchesProjectFilters(project, filters));
}

export interface ReporterFilterOption {
  id: string;
  /** Stored username; the UI formats it for display. */
  username: string;
}

/**
 * Distinct reporters present in the collection, sorted by username. The UI
 * prepends "All reporters"; call this with the unfiltered visible collection so
 * the option list does not shrink while the user is narrowing results.
 */
export function reporterFilterOptions(
  projects: readonly ProjectCard[],
): ReporterFilterOption[] {
  const byId = new Map<string, string>();
  for (const project of projects) {
    if (!byId.has(project.reporter.id)) byId.set(project.reporter.id, project.reporter.username);
  }
  return [...byId]
    .map(([id, username]) => ({ id, username }))
    .sort((a, b) => a.username.localeCompare(b.username) || a.id.localeCompare(b.id));
}

export interface FilteredDescendants {
  /** Matching rows plus the ancestors needed to keep the tree connected. */
  rows: ProjectWithParent[];
  /** Included rows that did not match and are shown only for context. */
  contextIds: ReadonlySet<string>;
}

/**
 * Filters the Tree's flat, depth-first descendant list without orphaning
 * matches: every ancestor of a matching row is kept so the hierarchy stays
 * navigable. Rows included only for structure are reported in `contextIds` so
 * the view can render them as muted, read-only context. Non-matching
 * descendants of a match are not included unless they match themselves.
 */
export function filterProjectDescendants(
  descendants: readonly ProjectWithParent[],
  filters: ProjectFilterState,
): FilteredDescendants {
  if (!hasActiveProjectFilters(filters)) {
    return { rows: [...descendants], contextIds: new Set() };
  }

  const matches = new Set(
    descendants
      .filter((project) => matchesProjectFilters(project, filters))
      .map((project) => project.id),
  );
  if (matches.size === 0) return { rows: [], contextIds: new Set() };

  const byId = new Map(descendants.map((project) => [project.id, project] as const));
  const included = new Set(matches);
  for (const matchId of matches) {
    let parentId = byId.get(matchId)?.parentId ?? null;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent) break; // parent is outside this collection (e.g. hidden)
      included.add(parentId);
      parentId = parent.parentId;
    }
  }

  const contextIds = new Set<string>();
  const rows: ProjectWithParent[] = [];
  for (const project of descendants) {
    if (!included.has(project.id)) continue;
    rows.push(project);
    if (!matches.has(project.id)) contextIds.add(project.id);
  }
  return { rows, contextIds };
}
