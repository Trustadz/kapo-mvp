import { describe, expect, it } from 'vitest';
import {
  dropZoneAt,
  insertionIndexAt,
  planIndexReorder,
  planSiblingReorder,
  priorityInsertionIndex,
  reorderEdgeAt,
} from '@/lib/reorder';

/**
 * Reorder planning for the collection views (issue #28).
 *
 * The reorder API is sibling-only and takes the sibling to insert before, so
 * these tests pin down how a drag between/after rows maps onto that argument,
 * including no-op drops that should not fire a request at all.
 */

const SIBLINGS = ['a', 'b', 'c', 'd'];

describe('planSiblingReorder', () => {
  it('inserts before the target', () => {
    expect(planSiblingReorder(SIBLINGS, 'd', 'b', 'before')).toEqual({
      beforeId: 'b',
      index: 1,
    });
    expect(planSiblingReorder(SIBLINGS, 'b', 'a', 'before')).toEqual({
      beforeId: 'a',
      index: 0,
    });
  });

  it('inserts after the target using the next sibling as beforeId', () => {
    expect(planSiblingReorder(SIBLINGS, 'a', 'b', 'after')).toEqual({
      beforeId: 'c',
      index: 1,
    });
    expect(planSiblingReorder(SIBLINGS, 'b', 'd', 'after')).toEqual({
      beforeId: null,
      index: 3,
    });
  });

  it('appends at the end when dropped after the last sibling', () => {
    expect(planSiblingReorder(SIBLINGS, 'c', 'd', 'after')).toEqual({
      beforeId: null,
      index: 3,
    });
  });

  it('moves the dragged item to the end from anywhere', () => {
    expect(planSiblingReorder(SIBLINGS, 'a', 'd', 'after')).toEqual({
      beforeId: null,
      index: 3,
    });
  });

  it('returns null for adjacent drops that change nothing', () => {
    // b is already directly before c.
    expect(planSiblingReorder(SIBLINGS, 'b', 'c', 'before')).toBeNull();
    // b is already directly after a.
    expect(planSiblingReorder(SIBLINGS, 'b', 'a', 'after')).toBeNull();
    // First item dropped before the second is already in place.
    expect(planSiblingReorder(SIBLINGS, 'a', 'b', 'before')).toBeNull();
  });

  it('returns null for a drop on itself or unknown projects', () => {
    expect(planSiblingReorder(SIBLINGS, 'a', 'a', 'before')).toBeNull();
    expect(planSiblingReorder(SIBLINGS, 'a', 'a', 'after')).toBeNull();
    expect(planSiblingReorder(SIBLINGS, 'zzz', 'b', 'before')).toBeNull();
    expect(planSiblingReorder(SIBLINGS, 'a', 'zzz', 'before')).toBeNull();
    expect(planSiblingReorder([], 'a', 'b', 'before')).toBeNull();
  });

  it('does not mutate the input list', () => {
    const siblings = [...SIBLINGS];
    planSiblingReorder(siblings, 'd', 'b', 'before');
    expect(siblings).toEqual(SIBLINGS);
  });
});

describe('dropZoneAt', () => {
  it('treats the top and bottom quarters as reorder edges', () => {
    expect(dropZoneAt(0, 0, 100)).toBe('before');
    expect(dropZoneAt(24, 0, 100)).toBe('before');
    expect(dropZoneAt(25, 0, 100)).toBe('inside');
    expect(dropZoneAt(50, 0, 100)).toBe('inside');
    expect(dropZoneAt(75, 0, 100)).toBe('inside');
    expect(dropZoneAt(76, 0, 100)).toBe('after');
    expect(dropZoneAt(100, 0, 100)).toBe('after');
  });

  it('offsets by the row top', () => {
    expect(dropZoneAt(299, 300, 40)).toBe('before');
    expect(dropZoneAt(320, 300, 40)).toBe('inside');
    expect(dropZoneAt(339, 300, 40)).toBe('after');
  });

  it('supports a custom edge ratio', () => {
    expect(dropZoneAt(39, 0, 100, 0.4)).toBe('before');
    expect(dropZoneAt(50, 0, 100, 0.4)).toBe('inside');
    expect(dropZoneAt(61, 0, 100, 0.4)).toBe('after');
  });

  it('falls back to inside for zero-height rows', () => {
    expect(dropZoneAt(10, 0, 0)).toBe('inside');
    expect(dropZoneAt(10, 0, -5)).toBe('inside');
  });
});

describe('reorderEdgeAt', () => {
  it('splits a row in half for before/after', () => {
    expect(reorderEdgeAt(0, 0, 40)).toBe('before');
    expect(reorderEdgeAt(19, 0, 40)).toBe('before');
    expect(reorderEdgeAt(20, 0, 40)).toBe('after');
    expect(reorderEdgeAt(39, 0, 40)).toBe('after');
    expect(reorderEdgeAt(305, 300, 40)).toBe('before');
    expect(reorderEdgeAt(321, 300, 40)).toBe('after');
  });
});

describe('insertionIndexAt', () => {
  const cards = [
    { top: 0, height: 80 },
    { top: 100, height: 80 },
    { top: 200, height: 80 },
  ];

  it('returns the slot before the first card when above its midpoint', () => {
    expect(insertionIndexAt(-10, cards)).toBe(0);
    expect(insertionIndexAt(0, cards)).toBe(0);
    expect(insertionIndexAt(39, cards)).toBe(0);
  });

  it('uses each card midpoint to choose the slot after it', () => {
    expect(insertionIndexAt(40, cards)).toBe(1);
    expect(insertionIndexAt(99, cards)).toBe(1);
    expect(insertionIndexAt(139, cards)).toBe(1);
  });

  it('counts gaps between cards as the next slot', () => {
    expect(insertionIndexAt(90, cards)).toBe(1);
    expect(insertionIndexAt(190, cards)).toBe(2);
  });

  it('returns cards.length below the last midpoint', () => {
    expect(insertionIndexAt(240, cards)).toBe(3);
    expect(insertionIndexAt(1000, cards)).toBe(3);
  });

  it('handles an empty column and zero-height measurements', () => {
    expect(insertionIndexAt(42, [])).toBe(0);
    expect(insertionIndexAt(42, [{ top: 0, height: 0 }])).toBe(1);
  });
});

describe('planIndexReorder', () => {
  it('plans a move to an explicit insertion slot', () => {
    expect(planIndexReorder(SIBLINGS, 'd', 0)).toEqual({ beforeId: 'a', index: 0 });
    expect(planIndexReorder(SIBLINGS, 'a', 2)).toEqual({ beforeId: 'd', index: 2 });
    expect(planIndexReorder(SIBLINGS, 'a', 4)).toEqual({ beforeId: null, index: 3 });
  });

  it('returns null for the current slot and unknown cards', () => {
    expect(planIndexReorder(SIBLINGS, 'b', 1)).toBeNull();
    expect(planIndexReorder(SIBLINGS, 'zzz', 0)).toBeNull();
    expect(planIndexReorder([], 'a', 0)).toBeNull();
  });

  it('clamps out-of-range slots instead of throwing', () => {
    expect(planIndexReorder(SIBLINGS, 'd', -10)).toEqual({ beforeId: 'a', index: 0 });
    expect(planIndexReorder(SIBLINGS, 'a', 99)).toEqual({ beforeId: null, index: 3 });
  });
});

describe('priorityInsertionIndex', () => {
  it('places a card between target-column cards by priority', () => {
    const cards = [{ priority: 2 }, { priority: 5 }, { priority: 9 }];
    expect(priorityInsertionIndex(cards, 1)).toBe(0);
    expect(priorityInsertionIndex(cards, 4)).toBe(1);
    expect(priorityInsertionIndex(cards, 5)).toBe(2);
    expect(priorityInsertionIndex(cards, 8)).toBe(2);
    expect(priorityInsertionIndex(cards, 10)).toBe(3);
  });

  it('returns 0 for an empty target column', () => {
    expect(priorityInsertionIndex([], 7)).toBe(0);
  });
});
