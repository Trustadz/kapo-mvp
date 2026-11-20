import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxItem, ProjectCard } from '@/lib/projects';
import { InboxPage, InboxTree } from '@/components/inbox/InboxPage';

/**
 * Inbox presentations (product.md §4/§5): Card stays the default, and Tree is
 * an Inbox-specific flat table for selecting several captures and releasing
 * them to their own parents' start statuses. These are structural tests; the
 * release mutation itself is covered by the domain/API suites.
 */

function card(overrides: Partial<ProjectCard> & { id: string; title: string }): ProjectCard {
  const { id, title, ...rest } = overrides;
  return {
    id,
    title,
    seq: 1,
    displayId: 'PROJ-1',
    statusId: 'status-todo',
    statusName: 'To do',
    priority: 0,
    inbox: true,
    archived: false,
    trashed: false,
    reporter: { id: 'user-1', username: 'tristan', avatar: null },
    parentId: 'parent-1',
    parent: { id: 'parent-1', title: 'Home improvement' },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...rest,
  };
}

function item(overrides: Partial<InboxItem> & { id: string; title: string }): InboxItem {
  const { id, title, ...rest } = overrides;
  return {
    project: card({ id, title }),
    parentTitle: 'Home improvement',
    startStatusId: 'status-todo',
    startStatusName: 'To do',
    canRelease: true,
    ...rest,
  };
}

const renderPage = (items: InboxItem[]) => renderToStaticMarkup(<InboxPage initialItems={items} />);

const renderTree = (
  items: InboxItem[],
  options: { pulled?: string[]; selected?: string[]; bulkPending?: boolean } = {},
) =>
  renderToStaticMarkup(
    <InboxTree
      items={items}
      pulled={new Set(options.pulled ?? [])}
      selected={new Set(options.selected ?? [])}
      bulkPending={options.bulkPending ?? false}
      anyPending={false}
      onToggle={() => {}}
      onToggleAll={() => {}}
      onReleaseSelected={() => {}}
      onClearSelection={() => {}}
    />,
  );

function inputTag(html: string, id: string): string {
  const match = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  expect(match, `input ${id}`).not.toBeNull();
  return match![0];
}

function isChecked(html: string, id: string): boolean {
  return /\schecked=""/.test(inputTag(html, id));
}

describe('Inbox view switcher', () => {
  it('keeps Card as the default presentation with a Tree option', () => {
    const html = renderPage([item({ id: 'p1', title: 'Book boiler service' })]);
    expect(html).toContain('aria-label="Inbox view"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>.*Card/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>.*Tree/);
    expect(html).toContain('Release to To do');
    expect(html).toContain('Open');
    expect(html).not.toContain('<table');
  });

  it('keeps the empty state and hides the switcher when there is nothing to refine', () => {
    const html = renderPage([]);
    expect(html).toContain('Inbox is empty');
    expect(html).not.toContain('aria-label="Inbox view"');
  });
});

describe('Inbox Tree', () => {
  it('renders labelled table headers, rows and the Open action', () => {
    const html = renderTree([item({ id: 'p1', title: 'Book boiler service' })]);
    expect(html).toContain('<table');
    expect(html).toContain('>Title</th>');
    expect(html).toContain('>Parent</th>');
    expect(html).toContain('>Status</th>');
    expect(html).toContain('Select all Inbox captures');
    expect(html).toContain('Select Book boiler service');
    expect(html).toContain('Under');
    expect(html).toContain('Home improvement');
    expect(html).toContain('To do');
    expect(html).toContain('aria-label="Open Book boiler service"');
    expect(html).toContain('Release selected');
  });

  it('disables selection for released and read-only captures while keeping their rows', () => {
    const html = renderTree(
      [
        item({ id: 'p1', title: 'Released capture' }),
        item({ id: 'p2', title: 'Read only capture', canRelease: false }),
        item({ id: 'p3', title: 'Still queued' }),
      ],
      { pulled: ['p1'] },
    );
    expect(html).toContain('Released capture');
    expect(html).toContain('Pulled');
    expect(html).toContain('Read only capture');
    expect(inputTag(html, 'inbox-tree-select-p1')).toContain('disabled=""');
    expect(inputTag(html, 'inbox-tree-select-p2')).toContain('disabled=""');
    expect(inputTag(html, 'inbox-tree-select-p3')).not.toContain('disabled');
    expect(html).toContain('Already released');
    expect(html).toContain('You need edit access to release this capture');
  });

  it('shows the bulk toolbar state and a disabled Release selected with no selection', () => {
    const html = renderTree([item({ id: 'p1', title: 'Book boiler service' })], {
      selected: [],
      bulkPending: true,
    });
    expect(html).toContain('Select captures to release them together');
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*>.*Release selected/);
  });

  it('reports how many captures are selected', () => {
    const html = renderTree(
      [
        item({ id: 'p1', title: 'First' }),
        item({ id: 'p2', title: 'Second' }),
        item({ id: 'p3', title: 'Third' }),
      ],
      { selected: ['p1', 'p2'] },
    );
    expect(html).toContain('2 selected');
    expect(isChecked(html, 'inbox-tree-select-p1')).toBe(true);
    expect(isChecked(html, 'inbox-tree-select-p2')).toBe(true);
    expect(isChecked(html, 'inbox-tree-select-p3')).toBe(false);
  });
});
