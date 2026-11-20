import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  changedFieldKey,
  isFieldChanged,
  markFieldChanged,
  resetChangedFields,
  subscribeChangedFields,
} from '@/lib/changed-fields';
import { useFieldChanged } from '@/lib/use-field-changed';

/**
 * Session-scoped changed-field markers (issue #56). The store is deliberately
 * module-level so it survives router.refresh() and resets on a full load; these
 * tests pin the key shape, the notification behaviour and SSR safety.
 */

function Probe({ projectId, field }: { projectId: string; field: string }) {
  const changed = useFieldChanged(projectId, field);
  return <span data-changed={changed ? 'true' : undefined}>{String(changed)}</span>;
}

describe('changed-fields store', () => {
  beforeEach(() => {
    resetChangedFields();
  });

  it('keys changes by project and field', () => {
    expect(changedFieldKey('p1', 'status')).toBe('p1:status');

    markFieldChanged('p1', 'status');
    expect(isFieldChanged('p1', 'status')).toBe(true);
    // Same field name on another project is a different change.
    expect(isFieldChanged('p2', 'status')).toBe(false);
    // Another field on the same project is a different change.
    expect(isFieldChanged('p1', 'title')).toBe(false);
  });

  it('notifies subscribers once per new key and on reset', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeChangedFields(listener);

    markFieldChanged('p1', 'status');
    expect(listener).toHaveBeenCalledTimes(1);

    // Re-marking the same key must not churn subscribers.
    markFieldChanged('p1', 'status');
    expect(listener).toHaveBeenCalledTimes(1);

    markFieldChanged('p1', 'title');
    expect(listener).toHaveBeenCalledTimes(2);

    resetChangedFields();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(isFieldChanged('p1', 'status')).toBe(false);

    unsubscribe();
    markFieldChanged('p1', 'status');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('renders as unchanged during server rendering even after a session change', () => {
    markFieldChanged('p1', 'status');
    // getServerSnapshot keeps the server markup and hydration in sync; the
    // client snapshot takes over after hydration.
    const html = renderToStaticMarkup(<Probe projectId="p1" field="status" />);
    expect(html).not.toContain('data-changed');
    expect(html).toContain('false');
  });
});
