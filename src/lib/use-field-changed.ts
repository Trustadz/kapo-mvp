'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { isFieldChanged, subscribeChangedFields } from './changed-fields';

/**
 * `true` when this field has been saved in the current app session.
 *
 * `getServerSnapshot` returns `false` so server-rendered markup and hydration
 * stay identical; after hydration React re-reads the client snapshot and shows
 * the changed state without a hydration mismatch.
 */
export function useFieldChanged(projectId: string, field: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => subscribeChangedFields(listener),
    [],
  );
  const getSnapshot = useCallback(
    () => isFieldChanged(projectId, field),
    [projectId, field],
  );
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
