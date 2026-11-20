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

/** Vertical bounds of one card in a column-like stack. */
export interface CardBounds {
  top: number;
  height: number;
}

/**
 * Insertion index for a pointer over a vertical stack of cards (Kanban).
 *
 * The returned index is a slot in the list the caller passed in: 0 means
 * "before the first card", `cards.length` means "after the last card". Cards
 * are split at their midpoint, which is the same before/after rule as
 * `reorderEdgeAt`, but expressed as a slot so a gap can be rendered between
 * cards and inside the empty space below the last one.
 *
 * Kanban callers must pass the column without the dragged card so the index
 * describes the list that will exist after the move.
 */
export function insertionIndexAt(
  clientY: number,
  cards: readonly CardBounds[],
): number {
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!card || card.height <= 0) continue;
    if (clientY < card.top + card.height / 2) return index;
  }
  return cards.length;
}

/**
 * Plan a reorder when the pointer has already been resolved to an insertion
 * slot. This is the Kanban equivalent of `planSiblingReorder`: the visible gap
 * and the drop use the same index, so the card lands exactly where it was
 * previewed. Returns `null` for a no-op (including a drop on the dragged card's
 * current slot).
 */
export function planIndexReorder(
  siblingIds: readonly string[],
  draggedId: string,
  insertionIndex: number,
): ReorderPlan | null {
  const currentIndex = siblingIds.indexOf(draggedId);
  if (currentIndex < 0) return null;
  const remaining = siblingIds.filter((id) => id !== draggedId);
  const index = Math.min(Math.max(insertionIndex, 0), remaining.length);
  if (index === currentIndex) return null;
  if (remaining.length === 0) return null;
  const targetId = remaining[index] ?? remaining[remaining.length - 1];
  if (!targetId) return null;
  return planSiblingReorder(
    siblingIds,
    draggedId,
    targetId,
    index < remaining.length ? 'before' : 'after',
  );
}

/**
 * Where a card will appear after a cross-column drop.
 *
 * Cross-column Kanban drops change status only, so the dragged card keeps its
 * global sibling priority and lands between the target column's cards at that
 * priority. The gap is placed there instead of under the pointer, which keeps
 * the preview truthful.
 */
export function priorityInsertionIndex(
  cards: readonly { priority: number }[],
  priority: number,
): number {
  const index = cards.findIndex((card) => card.priority > priority);
  return index === -1 ? cards.length : index;
}
