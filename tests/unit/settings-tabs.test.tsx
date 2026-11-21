import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ProjectPageData,
  WorkflowViewData,
} from '@/components/projects/types';
import { DEFAULT_VIEW_FIELDS } from '@/lib/projects';
import type { ProjectAddonConfigView } from '@/lib/addons';
import {
  AddonsTab,
  GeneralTab,
  LayoutTab,
} from '@/components/projects/ProjectSettingsPage';

/**
 * Project settings UI after copy-on-create.
 *
 * The live-inheritance controls are gone: General no longer duplicates Default
 * view or Inherit layout, the Layout tab no longer offers Inherit layout, and
 * the Add-ons tab only exposes an explicit enable/disable snapshot.
 */

const settings: ProjectPageData['settings'] = {
  access: 'inherit',
  inherit_layout: false,
  child_position: 'below',
  default_view: 'kanban',
  enabled_views: ['kanban', 'card', 'tree', 'list'],
  hidden_statuses: [],
  skip_inbox: false,
  layout_template: null,
  view_fields: { ...DEFAULT_VIEW_FIELDS },
};

const data = {
  project: {
    id: 'project-1',
    title: 'Home improvement',
    reporter: { username: 'admin' },
    canEdit: true,
  },
  settings,
  layout: { main: [], sidebar: ['status', 'reporter'] },
} as unknown as ProjectPageData;

const workflow: WorkflowViewData = {
  statuses: [],
  usage: {},
  retired: [],
};

const addon: ProjectAddonConfigView = {
  identifier: 'assignee',
  name: 'Assignee',
  version: '1.0.0',
  mode: 'optional',
  enabled: true,
  inheritFromParent: true,
  available: true,
  inherited: true,
  required: false,
  settings: {},
  effectiveSettings: {},
  parentTitle: 'Parent project',
};

function noop(): void {}

describe('project settings tabs after copy-on-create', () => {
  it('General keeps title/reporter/child capture but not Default view or Inherit layout', () => {
    const html = renderToStaticMarkup(
      <GeneralTab data={data} notify={noop} refresh={noop} />,
    );
    expect(html).toContain('Project defaults');
    expect(html).toContain('settings-title');
    expect(html).toContain('settings-reporter');
    expect(html).toContain('Send new children to the Inbox');
    expect(html).not.toContain('settings-default-view');
    expect(html).not.toContain('Inherit layout from the parent project');
    expect(html).not.toContain('settings-inherit-layout');
  });

  it('Layout keeps Default view, view position, field layout, views and view fields', () => {
    const html = renderToStaticMarkup(
      <LayoutTab data={data} workflow={workflow} notify={noop} refresh={noop} />,
    );
    expect(html).toContain('layout-default-view');
    expect(html).toContain('Project view appears');
    expect(html).toContain('Main area');
    expect(html).toContain('Properties sidebar');
    expect(html).toContain('Enabled views');
    expect(html).toContain('View properties');
    expect(html).not.toContain('layout-inherit');
    expect(html).not.toContain('Inherit layout from the parent project');
  });

  it('Add-ons no longer renders the Inherit from parent checkbox', () => {
    const html = renderToStaticMarkup(
      <AddonsTab projectId="project-1" addons={[addon]} notify={noop} refresh={noop} />,
    );
    expect(html).toContain('Enable for this project');
    expect(html).toContain('Save add-ons');
    expect(html).not.toContain('addon-inherit-assignee');
    expect(html).not.toContain('Inherit from parent');
  });
});
