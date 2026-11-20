/**
 * Session-scoped record of fields changed in this visit (issue #56).
 *
 * Module-level on purpose: it survives client-side navigation and
 * `router.refresh()`, but a full document load re-evaluates the module and
 * starts clean. Nothing is written to the database and nothing is serialised
 * to the server — this is purely a visual aid.
 */

type Listener = () => void;

const changedFields = new Set<string>();
const listeners = new Set<Listener>();

export function changedFieldKey(projectId: string, field: string): string {
  return `${projectId}:${field}`;
}

export function markFieldChanged(projectId: string, field: string): void {
  const key = changedFieldKey(projectId, field);
  if (changedFields.has(key)) return;
  changedFields.add(key);
  for (const listener of listeners) listener();
}

export function isFieldChanged(projectId: string, field: string): boolean {
  return changedFields.has(changedFieldKey(projectId, field));
}

export function subscribeChangedFields(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Forget every changed field. Used by tests; the app relies on a full page
 * load for the reset.
 */
export function resetChangedFields(): void {
  if (changedFields.size === 0) return;
  changedFields.clear();
  for (const listener of listeners) listener();
}
