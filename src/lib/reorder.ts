/**
 * Pure helpers for sibling reordering in the collection views (issue #28).
 *
 * Projects have one app-wide priority sequence (issue #53), so a parent's
 * sibling order is that sequence restricted to its children. The reorder API
 * accepts any readable project as `beforeId`; these helpers still plan a drop
 * inside one visible collection by translating a drag gesture into the
 * neighbouring sibling's id (or `null` for "end of the list"). They contain no
 * DOM or React code so the same rules are unit-testable and shared by Card,
 * Tree and List.
 */

export type ReorderEdge = 'before' | 'after';

/** Vertical drop zones: the edges reorder, the middle means "drop inside". */
export type DropZone = ReorderEdge | 'inside';

export interface ReorderPlan {
  /** `beforeId` for the reorder request; `null` appends after every project. */
  beforeId: string | null;
  /** Zero-based index the project occupies once the move is applied. */
  index: number;
}

/**
 * Plan a sibling reorder for dropping `draggedId` before/after `targetId`.
 *
 * `siblingIds` must be the current ordered priority list of one parent's
 * children. Returns `null` when the drop is not a valid reorder: the dragged
 * project or target is not in the list, the drop is on the dragged project
 * itself, or the resulting order would be identical (no-op).
 */
export function planSiblingReorder(
  siblingIds: readonly string[],
  draggedId: string,
  targetId: string,
  edge: ReorderEdge,
): ReorderPlan | null {
  if (draggedId === targetId) return null;
  const currentIndex = siblingIds.indexOf(draggedId);
  const targetIndex = siblingIds.indexOf(targetId);
  if (currentIndex < 0 || targetIndex < 0) return null;

  const remaining = siblingIds.filter((id) => id !== draggedId);
  const targetIndexWithoutDragged = remaining.indexOf(targetId);
  if (targetIndexWithoutDragged < 0) return null;

  const index =
    edge === 'before' ? targetIndexWithoutDragged : targetIndexWithoutDragged + 1;
  if (index === currentIndex) return null;

  const beforeId =
    edge === 'before' ? targetId : (remaining[targetIndexWithoutDragged + 1] ?? null);
  return { beforeId, index };
}

/**
 * Classify a pointer position against a row/card's vertical bounds.
 *
 * The top and bottom `edgeRatio` slices mean "insert before/after"; the middle
 * means "drop inside" (used by Tree and Card to open the Move dialog).
 */
export function dropZoneAt(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  edgeRatio = 0.25,
): DropZone {
  if (rectHeight <= 0) return 'inside';
  const offset = clientY - rectTop;
  if (offset < rectHeight * edgeRatio) return 'before';
  if (offset > rectHeight * (1 - edgeRatio)) return 'after';
  return 'inside';
}

/**
 * Two-zone variant for List rows: the top half inserts before, the bottom half
 * after. List view only reorders (it has no reparent affordance).
 */
export function reorderEdgeAt(
  clientY: number,
  rectTop: number,
  rectHeight: number,
): ReorderEdge {
  return clientY - rectTop < rectHeight / 2 ? 'before' : 'after';
}
