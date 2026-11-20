import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxItem, ProjectCard } from '@/lib/projects';
import { InboxPage } from '@/components/inbox/InboxPage';

/**
 * Drag-to-release drop area (product.md §4). The per-card Release button must
 * remain the keyboard path, so it is asserted alongside the drag affordances.
 * These are structural tests; the release mutation is covered by the
 * domain/API suites.
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

const renderPage = (items: InboxItem[]) =>
  renderToStaticMarkup(<InboxPage initialItems={items} />);

describe('Inbox release drop area', () => {
  it('sits above the list with instructions and the keyboard Release button', () => {
    const html = renderPage([item({ id: 'p1', title: 'Book boiler service' })]);
    expect(html).toContain('aria-label="Release drop area"');
    expect(html).toContain('Drag a capture here to release it');
    expect(html).toContain('inbox-drop-hint');
    expect(html).toContain('Use the Release button on a card.');
    expect(html).toContain('Release to To do');
    // No acknowledgement until something has actually been released.
    expect(html).not.toContain('aria-label="Released capture"');
  });

  it('makes releasable cards draggable and leaves read-only cards alone', () => {
    const html = renderPage([
      item({ id: 'p1', title: 'Book boiler service' }),
      item({ id: 'p2', title: 'Read only capture', canRelease: false }),
    ]);
    const articles = html.match(/<article[\s\S]*?<\/article>/g) ?? [];
    expect(articles).toHaveLength(2);
    const editable = articles.find((article) => article.includes('Book boiler service'));
    const readOnly = articles.find((article) => article.includes('Read only capture'));
    expect(editable).toContain('draggable="true"');
    expect(readOnly).not.toContain('draggable="true"');
    // Both keep the normal Open action.
    expect(editable).toContain('aria-label="Open Book boiler service"');
    expect(readOnly).toContain('aria-label="Open Read only capture"');
  });

  it('keeps the empty state and hides the drop area when there is nothing to release', () => {
    const html = renderPage([]);
    expect(html).toContain('Inbox is empty');
    expect(html).not.toContain('aria-label="Release drop area"');
    expect(html).not.toContain('draggable="true"');
  });
});
