import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCard, ProjectWithParent } from '@/lib/projects';
import {
  filterInboxDescendants,
  filterInboxItems,
  readShowInboxPreference,
  showInboxStorageKey,
  writeShowInboxPreference,
} from '@/components/projects/collectionVisibility';

/**
 * Issue #16: Inbox-flagged children are hidden from a project's collections
 * unless the viewer's per-project "Show Inbox items" preference is on.
 */

function card(id: string, inbox: boolean): ProjectCard {
  return {
    id,
    seq: 1,
    displayId: 'KAP-1',
    title: id,
    statusId: 'status-1',
    statusName: 'To do',
    priority: 0,
    inbox,
    archived: false,
    trashed: false,
    reporter: { id: 'user-1', username: 'tristan', avatar: null },
    parentId: null,
    parent: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function descendant(id: string, parentId: string | null, inbox: boolean): ProjectWithParent {
  return { ...card(id, inbox), parentId };
}

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('filterInboxItems', () => {
  const children = [card('visible-a', false), card('inbox-child', true), card('visible-b', false)];

  it('hides Inbox children by default while preserving order', () => {
    expect(filterInboxItems(children, false).map((project) => project.id)).toEqual([
      'visible-a',
      'visible-b',
    ]);
  });

  it('returns every child when the preference is on', () => {
    expect(filterInboxItems(children, true).map((project) => project.id)).toEqual([
      'visible-a',
      'inbox-child',
      'visible-b',
    ]);
  });

  it('does not expose the Inbox badge flag on hidden items', () => {
    const [first] = filterInboxItems(children, false);
    expect(first?.inbox).toBe(false);
  });
});

describe('filterInboxDescendants', () => {
  // depth-first: visible-a > grandchild > inbox-b > inbox-child
  const descendants = [
    descendant('visible-a', 'root', false),
    descendant('grandchild', 'visible-a', false),
    descendant('inbox-b', 'root', true),
    descendant('inbox-child', 'inbox-b', false),
  ];

  it('hides Inbox rows and their subtree by default', () => {
    expect(filterInboxDescendants(descendants, false).map((project) => project.id)).toEqual([
      'visible-a',
      'grandchild',
    ]);
  });

  it('keeps the full depth-first list when the preference is on', () => {
    expect(filterInboxDescendants(descendants, true).map((project) => project.id)).toEqual([
      'visible-a',
      'grandchild',
      'inbox-b',
      'inbox-child',
    ]);
  });
});

describe('show inbox preference storage', () => {
  it('is scoped to the project and defaults off', () => {
    expect(showInboxStorageKey('project-1')).toBe('kapo:show-inbox:project-1');
    expect(readShowInboxPreference('project-1')).toBe(false);
  });

  it('round-trips the preference per project', () => {
    vi.stubGlobal('window', { localStorage: fakeStorage() });
    writeShowInboxPreference('project-1', true);
    writeShowInboxPreference('project-2', false);
    expect(readShowInboxPreference('project-1')).toBe(true);
    expect(readShowInboxPreference('project-2')).toBe(false);
    expect(readShowInboxPreference('project-3')).toBe(false);

    writeShowInboxPreference('project-1', false);
    expect(readShowInboxPreference('project-1')).toBe(false);
  });
});
