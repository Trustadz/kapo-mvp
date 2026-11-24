import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AddonApplicationConfig } from '@/lib/addons';
import type { DescriptionCapabilitySettings } from '@/lib/description';
import type { BackupStatus } from '@/server/backup';
import type { ApplicationSettings } from '@/server/domain/settings';
import type { AccountUser } from '@/server/domain/users';
import { ApplicationSettingsForm } from '@/components/settings/ApplicationSettingsForm';

/**
 * Server-rendered contract for the tabbed Application settings page.
 *
 * Interaction (keyboard tab switching, draft preservation, request bodies) is
 * covered by the reducer tests and the Playwright spec; this pins the markup:
 * tablist/tab/tabpanel semantics, one form per tab, the add-on mode Select
 * instead of radios, add-on cards and generic settings controls.
 */

const settings: ApplicationSettings = {
  defaultAccountRole: 'user',
  enabledViews: ['kanban', 'card', 'tree', 'list'],
  trashPurgeEnabled: true,
  trashRetentionDays: 30,
  mcpEnabled: false,
  installationName: 'Kapo',
  backupEnabled: true,
  backupStartTime: '03:00',
  backupRetention: 7,
};

const users: AccountUser[] = [
  {
    id: 'user-admin',
    username: 'admin',
    email: 'admin@example.com',
    avatar: null,
    appRole: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const descriptionCapability: DescriptionCapabilitySettings = {
  activeProvider: 'description-markdown',
  providers: [
    {
      identifier: 'description-markdown',
      name: 'Markdown description',
      version: '1.0.0',
      reads: ['markdown@1'],
      writes: ['markdown@1'],
    },
  ],
  formatsInUse: [],
};

const backupStatus: BackupStatus = {
  enabled: true,
  startTime: '03:00',
  retention: 7,
  destination: '/data/backups',
  lastBackup: null,
  nextRun: '2026-11-22T02:00:00.000Z',
  running: false,
};

const addons: AddonApplicationConfig[] = [
  {
    identifier: 'assignee',
    name: 'Assignee',
    description: 'Assign a project to one household member.',
    version: '1.0.0',
    mode: 'optional',
    settings: {},
    settingsFields: [],
  },
  {
    identifier: 'digest',
    name: 'Digest',
    description: 'Send a weekly household digest.',
    version: '2.1.0',
    mode: 'always',
    settings: { paused: false, frequency: 'weekly' },
    settingsFields: [
      {
        key: 'paused',
        label: 'Pause the digest',
        description: 'Stop sending new digests.',
        type: 'boolean',
      },
      { key: 'days', label: 'Days to include', type: 'number', min: 1, max: 14 },
      { key: 'title', label: 'Digest title', type: 'text', maxLength: 40 },
      { key: 'notes', label: 'Footer notes', type: 'longtext' },
      { key: 'startsOn', label: 'Start date', type: 'date' },
      {
        key: 'frequency',
        label: 'Frequency',
        type: 'select',
        options: [
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
        ],
      },
      { key: 'owner', label: 'Owner', type: 'user' },
    ],
  },
];

function render(
  formAddons: AddonApplicationConfig[] = addons,
  formSettings: ApplicationSettings = settings,
  capability: DescriptionCapabilitySettings = descriptionCapability,
): string {
  return renderToStaticMarkup(
    <ApplicationSettingsForm
      settings={formSettings}
      backupStatus={backupStatus}
      addons={formAddons}
      descriptionCapability={capability}
      users={users}
      defaultRole="user"
    />,
  );
}

function openingTag(html: string, attribute: string, value: string): string {
  const tag = html.match(
    new RegExp(`<[a-z]+(?=[^>]*${attribute}="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")[^>]*>`),
  );
  if (!tag) throw new Error(`No element with ${attribute}="${value}"`);
  return tag[0];
}

describe('application settings tabs', () => {
  it('renders an accessible tablist with General selected by default', () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Application settings sections"');
    expect(html.match(/role="tab"/g)).toHaveLength(4);

    const generalTab = openingTag(html, 'id', 'application-settings-tab-general');
    expect(generalTab).toContain('aria-selected="true"');
    expect(generalTab).toContain('aria-controls="application-settings-panel-general"');
    expect(generalTab).toContain('tabindex="0"');

    for (const id of ['backups', 'addons', 'users']) {
      const tab = openingTag(html, 'id', `application-settings-tab-${id}`);
      expect(tab).toContain('aria-selected="false"');
      expect(tab).toContain('tabindex="-1"');
    }

    const generalPanel = openingTag(html, 'id', 'application-settings-panel-general');
    expect(generalPanel).not.toContain('hidden');
    expect(generalPanel).toContain('aria-labelledby="application-settings-tab-general"');
    expect(generalPanel).toContain('role="tabpanel"');

    for (const id of ['backups', 'addons', 'users']) {
      const panel = openingTag(html, 'id', `application-settings-panel-${id}`);
      expect(panel).toContain('hidden');
      expect(panel).toContain(`aria-labelledby="application-settings-tab-${id}"`);
    }
  });

  it('renders one labelled form per tab', () => {
    const html = render();
    expect(html).toContain('aria-label="General application settings"');
    expect(html).toContain('aria-label="Backup settings"');
    expect(html).toContain('aria-label="Add-on settings"');
    expect(html).toContain('id="settings-default-role"');
    expect(html).toContain('id="settings-backup-start"');
    expect(html).toContain('Views available to projects');
  });

  it('hides the Add-ons tab and panel when the registry is empty', () => {
    const html = render([], settings, {
      activeProvider: null,
      providers: [],
      formatsInUse: [],
    });
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).not.toContain('application-settings-tab-addons');
    expect(html).not.toContain('application-settings-panel-addons');
    expect(html).not.toContain('Add-on settings');
  });
});


describe('description provider settings', () => {
  it('shows the provider card when a capability exists without property add-ons', () => {
    const html = render([], settings);
    expect(html).toContain('application-settings-tab-addons');
    expect(html).toContain('Description provider');
    expect(html).toContain('id="description-provider"');
    expect(html).toContain('Markdown description');
  });

  it('warns about stored formats the selected provider cannot edit', () => {
    const html = render([], settings, {
      ...descriptionCapability,
      formatsInUse: [{ format: 'html@1', count: 2 }],
    });
    expect(html).toContain('using a format this provider cannot edit');
    expect(html).toContain('read-only plain text');
  });
});

describe('add-on cards', () => {
  it('renders name, version, description and a mode dropdown instead of radios', () => {
    const html = render();
    expect(html).toContain('Assignee');
    expect(html).toContain('v1.0.0');
    expect(html).toContain('Assign a project to one household member.');
    expect(html).toContain('Digest');
    expect(html).toContain('v2.1.0');

    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('addon-mode-assignee-radio');

    const select = openingTag(html, 'id', 'addon-mode-assignee');
    expect(select).toContain('<select');
    expect(html).toContain('<option value="required">Required</option>');
    expect(html).toContain('<option value="always">Always on</option>');
    expect(html).toContain('<option value="optional">Available</option>');
    expect(html).toContain('<option value="unavailable">Unavailable</option>');
    // The selected mode's concise note is associated with the Select.
    expect(html).toContain('Available to projects; project Admins choose whether to enable it.');
  });

  it('omits the settings area for an add-on with no settings fields', () => {
    const html = render();
    const assignee = html.match(/<section[^>]*aria-labelledby="addon-title-assignee"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(assignee).not.toContain('Add-on settings');
    expect(html).not.toContain('No additional settings for this add-on.');
    // The add-on that does have settings still gets its own section.
    expect(html).toContain('addon-setting-digest-paused');
  });

  it('renders generic controls for every supported settings field', () => {
    const html = render();
    expect(html).toContain('id="addon-setting-digest-paused"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('id="addon-setting-digest-days"');
    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="14"');
    expect(html).toContain('id="addon-setting-digest-title"');
    expect(html).toMatch(/maxlength="40"/i);
    expect(html).toContain('id="addon-setting-digest-notes"');
    expect(html).toContain('<textarea');
    expect(html).toContain('id="addon-setting-digest-startsOn"');
    expect(html).toContain('type="date"');
    expect(html).toContain('id="addon-setting-digest-frequency"');
    expect(html).toContain('<option value="daily">Daily</option>');
    expect(html).toMatch(/<option value="weekly"[^>]*>Weekly<\/option>/);
  });

  it('explains unsupported settings instead of rendering a broken control', () => {
    const html = render();
    expect(html).toContain('Owner');
    expect(html).toContain(
      'This setting type is not supported in Application settings. Its stored value is kept.',
    );
    expect(html).not.toContain('id="addon-setting-digest-owner"');
  });
});
