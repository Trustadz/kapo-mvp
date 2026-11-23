import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CardView,
  KanbanView,
  ListView,
  TreeView,
} from '@/components/views/CollectionViews';
import type { CollectionViewContext } from '@/components/views/types';
import type { CollectionView, Status } from '@/lib/types';
import {
  DEFAULT_LAYOUT_TEMPLATE,
  DEFAULT_VIEW_FIELDS,
  type ProjectCard,
  type ProjectSettingsData,
} from '@/lib/projects';
import type { ProjectCardAddonField } from '@/lib/addons';

/**
 * Compact add-on fields in the four collection views. The views share one
 * `ViewMeta` renderer, so all four are rendered to pin that the add-on label and
 * resolved value appear instead of the raw `addon:` reference.
 */

const ASSIGNEE_REF = 'addon:assignee:assignee';

const status: Status = {
  id: 'status-todo',
  parentId: 'parent',
  name: 'To do',
  position: 0,
  isStart: true,
  isFinish: false,
};

const addonField: ProjectCardAddonField = {
  ref: ASSIGNEE_REF,
  identifier: 'assignee',
  fieldKey: 'assignee',
  addonName: 'Assignee',
  label: 'Assigned to',
  type: 'user',
  value: 'user-maya',
  displayValue: 'Maya',
  avatar: null,
};

function card(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: 'project-1',
    seq: 1,
    displayId: 'KAP-1',
    title: 'Paint hallway',
    statusId: status.id,
    statusName: status.name,
    priority: 0,
    inbox: false,
    archived: false,
    trashed: false,
    reporter: { id: 'user-admin', username: 'admin', avatar: null },
    parentId: 'parent',
    parent: { id: 'parent', title: 'Home improvement' },
    createdAt: '2026-11-17T12:00:00.000Z',
    updatedAt: '2026-11-17T12:00:00.000Z',
    ...overrides,
  };
}

function context(
  view: CollectionView,
  fields: ProjectSettingsData['view_fields'][CollectionView],
  project: ProjectCard,
): CollectionViewContext {
  const settings: ProjectSettingsData = {
    access: 'custom',
    inherit_layout: false,
    child_position: 'below',
    layout_mode: null,
    default_view: view,
    enabled_views: ['kanban', 'card', 'tree', 'list'],
    hidden_statuses: [],
    skip_inbox: false,
    layout_template: DEFAULT_LAYOUT_TEMPLATE,
    view_fields: { ...DEFAULT_VIEW_FIELDS, [view]: fields },
  };
  return {
    projectId: 'parent',
    projectTitle: 'Home improvement',
    statuses: [status],
    settings,
    canEdit: false,
    view,
    children: view === 'tree' ? [] : [project],
    descendants:
      view === 'tree'
        ? [{ ...project, parentId: 'parent', canAdmin: false }]
        : [],
    refresh: () => {},
    notify: () => {},
    openMoveDialog: () => {},
    openCreateDialog: () => {},
  };
}

const views: Array<{
  view: CollectionView;
  render: (ctx: CollectionViewContext) => string;
}> = [
  { view: 'kanban', render: (ctx) => renderToStaticMarkup(<KanbanView ctx={ctx} />) },
  { view: 'card', render: (ctx) => renderToStaticMarkup(<CardView ctx={ctx} />) },
  { view: 'tree', render: (ctx) => renderToStaticMarkup(<TreeView ctx={ctx} />) },
  { view: 'list', render: (ctx) => renderToStaticMarkup(<ListView ctx={ctx} />) },
];

describe('compact add-on fields in collection views', () => {
  it.each(views)('$view renders the label and resolved value', ({ view, render }) => {
    const html = render(context(view, [ASSIGNEE_REF], card({ addonFields: [addonField] })));
    expect(html).toContain('Assigned to: Maya');
    expect(html).not.toContain(ASSIGNEE_REF);
  });

  it.each(views)('$view omits the field when the card has no value', ({ view, render }) => {
    const html = render(context(view, [ASSIGNEE_REF], card()));
    expect(html).not.toContain('Assigned to:');
    expect(html).not.toContain(ASSIGNEE_REF);
  });

  it.each(views)('$view keeps core meta fields alongside add-on fields', ({ view, render }) => {
    const html = render(
      context(view, ['status', ASSIGNEE_REF], card({ addonFields: [addonField] })),
    );
    expect(html).toContain('Status: To do');
    expect(html).toContain('Assigned to: Maya');
  });
});
