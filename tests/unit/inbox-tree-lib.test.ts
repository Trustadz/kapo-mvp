import { describe, expect, it } from 'vitest';
import type { InboxTreeNode } from '@/lib/projects';
import {
  flattenInboxTree,
  indexInboxTree,
  orderInboxItemsByTree,
  planSequenceMove,
} from '@/lib/inbox-tree';

/**
 * Pure hierarchy rules for the application-wide Inbox Tree (issue #54):
 * sibling order is the global priority sequence, every branch starts expanded,
 * and collapsing a branch hides exactly its descendants.
 */

function node(
  overrides: Partial<InboxTreeNode> & { id: string; title: string },
): InboxTreeNode {
  const { id, title, ...rest } = overrides;
  return {
    id,
    title,
    parentId: null,
    statusName: 'To do',
    inbox: false,
    archived: false,
    canEdit: true,
    canAdmin: true,
    priority: 0,
    ...rest,
  };
}

describe('indexInboxTree', () => {
  it('groups by parent and orders every branch by global priority', () => {
    const index = indexInboxTree([
      node({ id: 'root', title: 'Root', priority: 0 }),
      node({ id: 'later', title: 'Later', parentId: 'root', priority: 20 }),
      node({ id: 'earlier', title: 'Earlier', parentId: 'root', priority: 10 }),
      node({ id: 'child', title: 'Child', parentId: 'later', priority: 30 }),
    ]);
    expect(index.roots.map((entry) => entry.id)).toEqual(['root']);
    expect((index.byParent.get('root') ?? []).map((entry) => entry.id)).toEqual([
      'earlier',
      'later',
    ]);
    expect((index.byParent.get('later') ?? []).map((entry) => entry.id)).toEqual([
      'child',
    ]);
  });

  it('treats a node with a missing parent as top level', () => {
    const index = indexInboxTree([
      node({ id: 'root', title: 'Root', priority: 0 }),
      node({ id: 'direct', title: 'Direct', parentId: 'inaccessible', priority: 1 }),
    ]);
    expect(index.roots.map((entry) => entry.id)).toEqual(['root', 'direct']);
  });

  it('does not mutate the input or duplicate nodes', () => {
    const input = [
      node({ id: 'root', title: 'Root', priority: 0 }),
      node({ id: 'a', title: 'A', parentId: 'root', priority: 2 }),
      node({ id: 'b', title: 'B', parentId: 'root', priority: 1 }),
    ];
    const copy = [...input];
    indexInboxTree(input);
    expect(input).toEqual(copy);
  });
});

describe('flattenInboxTree', () => {
  const nodes = [
    node({ id: 'root', title: 'Root', priority: 0 }),
    node({ id: 'a', title: 'A', parentId: 'root', priority: 1 }),
    node({ id: 'a1', title: 'A1', parentId: 'a', priority: 2 }),
    node({ id: 'b', title: 'B', parentId: 'root', priority: 3 }),
  ];

  it('is fully expanded by default, depth first', () => {
    const rows = flattenInboxTree(indexInboxTree(nodes), new Set());
    expect(rows.map((row) => row.node.id)).toEqual(['root', 'a', 'a1', 'b']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1]);
    expect(rows.find((row) => row.node.id === 'a')?.hasChildren).toBe(true);
    expect(rows.find((row) => row.node.id === 'b')?.hasChildren).toBe(false);
  });

  it('collapsing a branch hides exactly its descendants', () => {
    const rows = flattenInboxTree(indexInboxTree(nodes), new Set(['a']));
    expect(rows.map((row) => row.node.id)).toEqual(['root', 'a', 'b']);
  });

  it('collapsing the root hides everything below it', () => {
    const rows = flattenInboxTree(indexInboxTree(nodes), new Set(['root']));
    expect(rows.map((row) => row.node.id)).toEqual(['root']);
  });
});


/**
 * Insertion planning for Inbox drag (issue #53). The one global sequence is the
 * authority: dropping before/after a target moves the dragged id exactly there,
 * and a drop that changes nothing must not reach the API.
 */
describe('planSequenceMove', () => {
  const ORDER = ['a', 'b', 'c', 'd'];

  it('inserts before the target', () => {
    expect(planSequenceMove(ORDER, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
    expect(planSequenceMove(ORDER, 'c', 'a', 'before')).toEqual(['c', 'a', 'b', 'd']);
  });

  it('inserts after the target', () => {
    expect(planSequenceMove(ORDER, 'a', 'b', 'after')).toEqual(['b', 'a', 'c', 'd']);
    expect(planSequenceMove(ORDER, 'b', 'd', 'after')).toEqual(['a', 'c', 'd', 'b']);
  });

  it('returns null for no-op, self and unknown targets', () => {
    expect(planSequenceMove(ORDER, 'b', 'c', 'before')).toBeNull();
    expect(planSequenceMove(ORDER, 'b', 'a', 'after')).toBeNull();
    expect(planSequenceMove(ORDER, 'a', 'a', 'before')).toBeNull();
    expect(planSequenceMove(ORDER, 'zzz', 'b', 'before')).toBeNull();
    expect(planSequenceMove(ORDER, 'a', 'zzz', 'after')).toBeNull();
    expect(planSequenceMove([], 'a', 'b', 'before')).toBeNull();
  });

  it('does not mutate the input list', () => {
    const order = [...ORDER];
    planSequenceMove(order, 'd', 'b', 'before');
    expect(order).toEqual(ORDER);
  });
});

describe('orderInboxItemsByTree', () => {
  function treeItem(id: string) {
    return {
      project: {
        id,
      },
    };
  }

  it('sorts Inbox items by their project position in the tree payload', () => {
    const tree = [
      node({ id: 'root', title: 'Root', priority: 0 }),
      node({ id: 'a', title: 'A', parentId: 'root', priority: 1 }),
      node({ id: 'b', title: 'B', parentId: 'root', priority: 2 }),
    ];
    const items = [treeItem('b'), treeItem('a')];
    expect(orderInboxItemsByTree(items, tree).map((entry) => entry.project.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps items missing from the tree at the end', () => {
    const tree = [node({ id: 'root', title: 'Root' })];
    const items = [treeItem('released'), treeItem('root')];
    expect(orderInboxItemsByTree(items, tree).map((entry) => entry.project.id)).toEqual([
      'root',
      'released',
    ]);
  });
});
