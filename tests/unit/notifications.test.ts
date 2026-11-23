import { describe, expect, it } from 'vitest';
import {
  notificationIcon,
  notificationText,
  type NotificationItem,
} from '@/lib/notifications';
import { safeNotificationHref } from '@/server/domain/notifications';

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    kind: 'project.renamed',
    message: 'Maya renamed the project.',
    translations: {},
    data: { oldValue: 'Home improvement', newValue: 'Home improvement v2' },
    origin: 'Home improvement v2',
    originType: 'project',
    originId: 'p1',
    href: '/p/p1',
    projectId: 'p1',
    addonIdentifier: null,
    actor: { id: 'u1', username: 'maya', avatar: null },
    createdAt: '2026-11-23T12:00:00.000Z',
    readAt: null,
    ...overrides,
  };
}

describe('notification presentation', () => {
  it('localizes core watch notifications', () => {
    expect(notificationText(item(), 'en')).toBe(
      'Maya renamed the project to “Home improvement v2”',
    );
    expect(notificationText(item(), 'nl')).toBe(
      'Maya heeft het project hernoemd naar “Home improvement v2”',
    );
  });

  it('renders add-on translations, then the English fallback, then the message', () => {
    const addon = item({
      kind: 'test.assigned',
      origin: 'Test notifier',
      originType: 'addon',
      addonIdentifier: 'test-notify',
      translations: {
        en: 'You were assigned to {origin}.',
        nl: 'Je bent toegewezen aan {origin}.',
      },
      message: 'Fallback message',
    });
    expect(notificationText(addon, 'en')).toBe('You were assigned to Test notifier.');
    expect(notificationText(addon, 'nl')).toBe('Je bent toegewezen aan Test notifier.');

    const noDutch = item({
      kind: 'test.assigned',
      translations: { en: 'English only: {origin}' },
      message: 'Fallback message',
    });
    expect(notificationText(noDutch, 'nl')).toBe('English only: Home improvement v2');

    const unknown = item({
      kind: 'vendor.custom',
      translations: {},
      message: 'Custom {origin}',
    });
    expect(notificationText(unknown, 'nl')).toBe('Custom Home improvement v2');
  });

  it('uses a sensible icon per core kind and origin', () => {
    expect(notificationIcon(item())).toBe('edit');
    expect(notificationIcon(item({ kind: 'project.trashed' }))).toBe('delete');
    expect(notificationIcon(item({ kind: 'vendor.custom', originType: 'addon' }))).toBe(
      'extension',
    );
    expect(notificationIcon(item({ kind: 'vendor.custom', originType: 'system' }))).toBe(
      'campaign',
    );
  });
});

describe('notification links', () => {
  it('allows internal application paths and rejects external or protocol-relative URLs', () => {
    expect(safeNotificationHref('/p/123')).toBe('/p/123');
    expect(safeNotificationHref('/notifications')).toBe('/notifications');
    expect(safeNotificationHref(null)).toBeNull();
    expect(safeNotificationHref('https://evil.example')).toBeNull();
    expect(safeNotificationHref('//evil.example')).toBeNull();
    expect(safeNotificationHref('/\\evil.example')).toBeNull();
    expect(safeNotificationHref('javascript:alert(1)')).toBeNull();
  });
});
