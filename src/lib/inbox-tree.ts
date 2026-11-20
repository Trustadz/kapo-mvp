import type { InboxTreeNode } from './projects';

/**
 * Pure hierarchy helpers for the application-wide Inbox Tree (issue #54).
 *
 * The server returns a flat, globally priority-ordered list of the projects the
 * viewer may read. These helpers turn that list into an expandable tree without
 * any DOM/React dependency, so the ordering and expand/collapse rules can be
 * unit-tested directly.
 */

export interface InboxTreeIndex {
  byId: Map<string, InboxTreeNode>;
  /** Children keyed by parent id (`null` = top level). */
  byParent: Map<string | null, InboxTreeNode[]>;
  roots: InboxTreeNode[];
}

export interface InboxTreeRow {
  node: InboxTreeNode;
  /** Zero-based indentation depth. */
  depth: number;
  hasChildren: boolean;
}

function byPriority(a: InboxTreeNode, b: InboxTreeNode): number {
  return a.priority - b.priority || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

/**
 * Builds the parent → children index.
 *
 * A node whose parent is absent from the payload is treated as top level, the
 * same way `listInboxTree` sanitises direct-access rows. Siblings keep the
 * server's global priority order.
 */
export function indexInboxTree(nodes: readonly InboxTreeNode[]): InboxTreeIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byParent = new Map<string | null, InboxTreeNode[]>();
  for (const node of nodes) {
    const parentId = node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
    const siblings = byParent.get(parentId);
    if (siblings) siblings.push(node);
    else byParent.set(parentId, [node]);
  }
  for (const siblings of byParent.values()) siblings.sort(byPriority);
  return {
    byId,
    byParent,
    roots: byParent.get(null) ?? [],
  };
}

/**
 * Depth-first list of the rows currently visible.
 *
 * Every branch is expanded by default; only ids in `collapsed` hide their
 * children. Selection survives expand/collapse because it is stored apart from
 * this derived list.
 */
export function flattenInboxTree(
  index: InboxTreeIndex,
  collapsed: ReadonlySet<string>,
): InboxTreeRow[] {
  const rows: InboxTreeRow[] = [];
  const seen = new Set<string>();
  const visit = (nodes: readonly InboxTreeNode[], depth: number) => {
    if (depth > 100) return;
    for (const node of nodes) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const children = index.byParent.get(node.id) ?? [];
      rows.push({ node, depth, hasChildren: children.length > 0 });
      if (children.length > 0 && !collapsed.has(node.id)) {
        visit(children, depth + 1);
      }
    }
  };
  visit(index.roots, 0);
  return rows;
}


/**
 * The flat global-order list with `draggedId` moved before/after `targetId`.
 *
 * Inbox drag (issue #53) works on the one global project sequence: dropping an
 * Inbox row or card between two rows plans the new sequence locally so the UI
 * can stay in step with the server-validated reorder. Returns `null` when the
 * move is a no-op or either id is missing, so callers can skip the request.
 */
export function planSequenceMove(
  order: readonly string[],
  draggedId: string,
  targetId: string,
  edge: 'before' | 'after',
): string[] | null {
  if (draggedId === targetId) return null;
  const from = order.indexOf(draggedId);
  const target = order.indexOf(targetId);
  if (from < 0 || target < 0) return null;

  const next = order.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return null;
  next.splice(edge === 'before' ? targetIndex : targetIndex + 1, 0, draggedId);
  if (next.length === order.length && next.every((id, index) => id === order[index])) {
    return null;
  }
  return next;
}

/**
 * Inbox items in the order their projects appear in the Tree payload.
 *
 * Items missing from the tree (e.g. a locally released capture the server no
 * longer lists as Inbox) stay at the end in their existing relative order.
 */
export function orderInboxItemsByTree<T extends { project: { id: string } }>(
  items: readonly T[],
  tree: readonly InboxTreeNode[],
): T[] {
  const position = new Map(tree.map((node, index) => [node.id, index]));
  return [...items].sort(
    (a, b) =>
      (position.get(a.project.id) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(b.project.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
