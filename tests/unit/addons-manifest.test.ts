import { describe, expect, it } from 'vitest';
import { getAddon, listAddons } from '@/server/addons';

/**
 * The server manifest (`src/server/addons/index.ts`) registers the shipped
 * add-ons and isolates per-add-on failures (docs/add-ons.md §3/§12).
 */
describe('add-on manifest', () => {
  it('registers the Assignee reference add-on', () => {
    const assignee = getAddon('assignee');
    expect(assignee?.identifier).toBe('assignee');
    expect(assignee?.version).toBe('1.0.0');
    expect(assignee?.defaultMode).toBe('always');
    expect(assignee?.fields).toEqual([
      expect.objectContaining({ key: 'assignee', type: 'user' }),
    ]);
    expect(assignee?.searchFields).toEqual([]);
    expect(assignee?.hooks?.validate).toBeTypeOf('function');
    expect(assignee?.hooks?.beforeLeaveInbox).toBeTypeOf('function');
    expect(assignee?.dashboardWidgets?.[0]?.id).toBe('assignee.assigned_to_me');
  });

  it('does not expose a second registration of assignee', () => {
    expect(listAddons().filter((entry) => entry.identifier === 'assignee')).toHaveLength(1);
  });

  it('registers the Markdown description capability provider', () => {
    const description = getAddon('description-markdown');
    expect(description?.capabilities).toEqual(['description']);
    expect(description?.formats).toEqual({
      reads: ['markdown@1'],
      writes: ['markdown@1'],
    });
  });
});
