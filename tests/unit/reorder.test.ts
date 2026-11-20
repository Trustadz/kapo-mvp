import { describe, expect, it } from 'vitest';
import {
  dropZoneAt,
  planSiblingReorder,
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
