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

