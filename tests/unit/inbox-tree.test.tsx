import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxItem, InboxTreeNode, ProjectCard } from '@/lib/projects';
import { InboxPage, InboxTree } from '@/components/inbox/InboxPage';

/**
 * Inbox presentations (product.md §4/§5, issue #54): Card stays the default and
 * Tree is the application-wide, expandable overview. Inbox captures are the
 * only actionable rows; every other project is read-only context. These are
 * structural tests; release/reorder mutations are covered by domain/API suites.
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
    reporter: { id: 'user-1', username: 'admin', avatar: null },
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
    canChangeParent: true,
    ...rest,
  };
}

function node(
  overrides: Partial<InboxTreeNode> & { id: string; title: string },
): InboxTreeNode {
  const { id, title, ...rest } = overrides;
  return {
    id,
    title,
    parentId: null,
    statusName: 'To do',
    inbox: false,
    archived: false,
    canEdit: true,
    canAdmin: true,
    priority: 0,
    ...rest,
  };
}

const renderPage = (items: InboxItem[], tree: InboxTreeNode[] = []) =>
  renderToStaticMarkup(<InboxPage initialItems={items} initialTree={tree} />);

const renderTree = (
  items: InboxItem[],
  tree: InboxTreeNode[],
  options: { pulled?: string[]; selected?: string[]; bulkPending?: boolean } = {},
) =>
  renderToStaticMarkup(
    <InboxTree
      items={items}
      tree={tree}
      pulled={new Set(options.pulled ?? [])}
      selected={new Set(options.selected ?? [])}
      bulkPending={options.bulkPending ?? false}
      anyPending={false}
      onToggle={() => {}}
      onToggleAll={() => {}}
      onReleaseSelected={() => {}}
      onClearSelection={() => {}}
      onReorder={() => {}}
      onReparent={() => {}}
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

const ROOT = node({ id: 'root', title: 'Root', priority: 0 });
const HOME = node({ id: 'home', title: 'Home improvement', parentId: 'root', priority: 1 });
const HOUSEHOLD = node({ id: 'household', title: 'Household', parentId: 'root', priority: 2 });

describe('Inbox view switcher', () => {
  it('keeps Card as the default presentation with a Tree option', () => {
    const html = renderPage(
      [item({ id: 'p1', title: 'Book boiler service' })],
      [ROOT, HOME],
    );
    expect(html).toContain('aria-label="Inbox view"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>.*Card/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>.*Tree/);
    expect(html).toContain('Release to To do');
    expect(html).toContain('Open');
    expect(html).not.toContain('<table');
  });

  it('keeps the switcher and the Tree app overview reachable when the Inbox is empty', () => {
    const page = renderPage([], [ROOT, HOME]);
    // Card is the default, so it shows the empty state...
    expect(page).toContain('Inbox is empty');
    // ...but the switcher (and therefore Tree) is still there.
    expect(page).toContain('aria-label="Inbox view"');

    const tree = renderTree([], [ROOT, HOME]);
    expect(tree).toContain('No Inbox captures right now');
    expect(tree).toContain('Home improvement');
    expect(tree).not.toContain('data-inbox="true"');
  });
});

describe('Inbox Tree — application overview', () => {
  it('nests projects under their parents in global priority order', () => {
    const html = renderTree(
      [item({ id: 'capture', title: 'Book boiler service', project: card({ id: 'capture', title: 'Book boiler service', parentId: 'home' }) })],
      [
        ROOT,
        HOME,
        HOUSEHOLD,
        node({ id: 'capture', title: 'Book boiler service', parentId: 'home', inbox: true, priority: 3 }),
      ],
    );
    expect(html).toContain('<table');
    expect(html).toContain('>Project</th>');
    expect(html).toContain('>Status</th>');
    const rootAt = html.indexOf('>Root</a>');
    const homeAt = html.indexOf('>Home improvement</a>');
    const householdAt = html.indexOf('>Household</a>');
    const captureAt = html.indexOf('>Book boiler service</a>');
    expect(rootAt).toBeGreaterThan(-1);
    expect(rootAt).toBeLessThan(homeAt);
    expect(homeAt).toBeLessThan(captureAt);
    expect(captureAt).toBeLessThan(householdAt);
    // Default expanded: the capture under Home improvement is rendered.
    expect(html).toContain('aria-label="Collapse Root"');
    expect(html).toContain('aria-expanded="true"');
  });

  it('renders non-Inbox rows as read-only, compact context with a navigable title', () => {
    const html = renderTree(
      [item({ id: 'capture', title: 'Book boiler service', project: card({ id: 'capture', title: 'Book boiler service', parentId: 'home' }) })],
      [
        ROOT,
        HOME,
        node({ id: 'capture', title: 'Book boiler service', parentId: 'home', inbox: true, priority: 3 }),
      ],
    );
    const contextRows = html.match(/<tr[^>]*data-context="true"[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    const homeRow = contextRows.find((row) => row.includes('Home improvement')) ?? '';
    expect(homeRow).toContain('href="/p/home"');
    // No checkbox, no Open action, no inline editing affordance.
    expect(homeRow).not.toContain('type="checkbox"');
    expect(homeRow).not.toContain('aria-label="Open Home improvement"');
    expect(homeRow).not.toContain('<select');
  });

  it('highlights and enables Inbox rows: checkbox, status, Open', () => {
    const html = renderTree(
      [item({ id: 'capture', title: 'Book boiler service', project: card({ id: 'capture', title: 'Book boiler service', parentId: 'home' }) })],
      [
        ROOT,
        HOME,
        node({ id: 'capture', title: 'Book boiler service', parentId: 'home', inbox: true, priority: 3 }),
      ],
    );
    expect(html).toContain('data-inbox="true"');
    expect(inputTag(html, 'inbox-tree-select-capture')).not.toContain('disabled');
    expect(html).toContain('aria-label="Open Book boiler service"');
    expect(html).toContain('To do');
    // Non-inbox parents keep their rows but no selection control.
    expect(html).not.toContain('inbox-tree-select-home');
    expect(html).not.toContain('inbox-tree-select-root');
  });

  it('drives select-all from Inbox rows only', () => {
    const html = renderTree(
      [
        item({ id: 'p1', title: 'First capture', project: card({ id: 'p1', title: 'First capture', parentId: 'home' }) }),
        item({
          id: 'p2',
          title: 'Read only capture',
          canRelease: false,
          project: card({ id: 'p2', title: 'Read only capture', parentId: 'home' }),
        }),
      ],
      [
        ROOT,
        HOME,
        node({ id: 'p1', title: 'First capture', parentId: 'home', inbox: true, priority: 3 }),
        node({ id: 'p2', title: 'Read only capture', parentId: 'home', inbox: true, priority: 4 }),
      ],
      { selected: ['p1'] },
    );
    expect(html).toContain('1 selected');
    expect(isChecked(html, 'inbox-tree-select-p1')).toBe(true);
    expect(isChecked(html, 'inbox-tree-select-p2')).toBe(false);
    expect(inputTag(html, 'inbox-tree-select-p2')).toContain('disabled=""');
    // No real project outside the Inbox is ever selectable.
    expect(html).not.toContain('inbox-tree-select-home');
  });

  it('disables released captures and keeps them highlighted as Pulled', () => {
    const html = renderTree(
      [item({ id: 'p1', title: 'Released capture', project: card({ id: 'p1', title: 'Released capture', parentId: 'home' }) })],
      [ROOT, HOME, node({ id: 'p1', title: 'Released capture', parentId: 'home', inbox: true })],
      { pulled: ['p1'] },
    );
    expect(html).toContain('Pulled');
    expect(inputTag(html, 'inbox-tree-select-p1')).toContain('disabled=""');
    expect(html).toContain('Already released');
    expect(html).toContain('data-pulled="true"');
  });

  it('renders a direct-access capture as a top-level row', () => {
    const html = renderTree(
      [item({ id: 'direct', title: 'Private capture', project: card({ id: 'direct', title: 'Private capture', parentId: null, parent: null }) })],
      [
        node({ id: 'root', title: 'Root', priority: 0 }),
        // The parent is not readable, so the server already nulled parentId.
        node({ id: 'direct', title: 'Private capture', parentId: null, inbox: true, priority: 2 }),
      ],
    );
    const directRow = html.match(/<tr[^>]*data-inbox="true"[^>]*>[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(directRow).toContain('Private capture');
    expect(html).toContain('style="padding-inline-start:0"');
  });

  it('makes only Inbox rows draggable drag sources', () => {
    const html = renderTree(
      [
        item({
          id: 'capture',
          title: 'Book boiler service',
          project: card({ id: 'capture', title: 'Book boiler service', parentId: 'home' }),
        }),
      ],
      [
        ROOT,
        HOME,
        node({
          id: 'capture',
          title: 'Book boiler service',
          parentId: 'home',
          inbox: true,
          priority: 3,
        }),
      ],
    );
    const inboxRow = html.match(/<tr[^>]*data-inbox="true"[^>]*>/)?.[0] ?? '';
    const contextRow = html.match(/<tr[^>]*data-context="true"[^>]*>/)?.[0] ?? '';
    expect(inboxRow).toContain('draggable="true"');
    expect(contextRow).toContain('draggable="false"');
    expect(html).toContain('Drop one on another row’s middle');
  });

  it('reports bulk state and keeps Release selected disabled with no selection', () => {
    const html = renderTree(
      [item({ id: 'p1', title: 'Book boiler service', project: card({ id: 'p1', title: 'Book boiler service', parentId: 'home' }) })],
      [ROOT, HOME, node({ id: 'p1', title: 'Book boiler service', parentId: 'home', inbox: true })],
      { selected: [], bulkPending: true },
    );
    expect(html).toContain('Select captures to release them together');
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*>.*Release selected/);
  });
});
