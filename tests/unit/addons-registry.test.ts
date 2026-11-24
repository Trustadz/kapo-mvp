import { afterEach, describe, expect, it } from 'vitest';
import type { AddonDefinition, AddonFieldDefinition } from '@/server/addons/types';
import {
  clearAddonsForTests,
  getAddon,
  listAddons,
  listCapabilityProviders,
  listPropertyAddons,
  registerAddon,
} from '@/server/addons/registry';

/** Add-on registry validation (build-spec §12, product.md §7). */

afterEach(() => {
  clearAddonsForTests();
});

function addon(overrides: Partial<AddonDefinition> = {}): AddonDefinition {
  return {
    identifier: 'assignee',
    name: 'Assignee',
    version: '1.0.0',
    fields: [{ key: 'owner', label: 'Assignee', type: 'user' }],
    ...overrides,
  };
}

function field(overrides: Partial<AddonFieldDefinition> = {}): AddonFieldDefinition {
  return { key: 'notes', label: 'Notes', type: 'text', ...overrides };
}

describe('empty registry', () => {
  it('starts empty when the manifest is not imported', () => {
    expect(listAddons()).toEqual([]);
    expect(getAddon('assignee')).toBeUndefined();
  });
});

describe('valid definitions', () => {
  it('registers a valid add-on and lists it', () => {
    const definition = addon();
    registerAddon(definition);
    expect(listAddons()).toEqual([definition]);
    expect(getAddon('assignee')).toBe(definition);
  });

  it('accepts identifier shapes allowed by /^[a-z][a-z0-9-]*$/', () => {
    for (const [index, identifier] of ['a', 'assignee', 'my-addon-2', 'a1-b2-c3'].entries()) {
      registerAddon(
        addon({ identifier, fields: [{ key: `field${index}`, label: 'F', type: 'text' }] }),
      );
      expect(getAddon(identifier)?.identifier).toBe(identifier);
    }
    expect(listAddons()).toHaveLength(4);
  });

  it('accepts select fields with static options', () => {
    registerAddon(
      addon({
        fields: [
          {
            key: 'priority',
            label: 'Priority',
            type: 'select',
            options: [
              { value: 'low', label: 'Low' },
              { value: 'high', label: 'High' },
            ],
          },
        ],
      }),
    );
    expect(listAddons()).toHaveLength(1);
  });

  it('accepts select fields with the users optionsSource', () => {
    registerAddon(
      addon({
        fields: [
          { key: 'assignee', label: 'Assignee', type: 'select', optionsSource: 'users' },
        ],
      }),
    );
    expect(listAddons()).toHaveLength(1);
  });

  it('accepts searchFields that reference known field keys', () => {
    registerAddon(addon({ fields: [field({ key: 'notes' })], searchFields: ['notes'] }));
    expect(getAddon('assignee')?.searchFields).toEqual(['notes']);
  });
});

describe('identifier validation', () => {
  it.each(['Assignee', '1assignee', 'assignee_1', '-assignee', 'add on', ''])(
    'rejects invalid identifier %p',
    (identifier) => {
      expect(() => registerAddon(addon({ identifier }))).toThrow(/identifier/);
      expect(listAddons()).toEqual([]);
    },
  );

  it('rejects a duplicate add-on identifier', () => {
    registerAddon(addon());
    expect(() => registerAddon(addon({ name: 'Second' }))).toThrow(/already registered/);
    expect(listAddons()).toHaveLength(1);
  });

  it('rejects an invalid default mode', () => {
    expect(() =>
      registerAddon(addon({ defaultMode: 'sometimes' as never })),
    ).toThrow(/defaultMode/);
    expect(listAddons()).toEqual([]);
  });

  it('rejects an empty name or version', () => {
    expect(() => registerAddon(addon({ name: '   ' }))).toThrow(/name/);
    expect(() => registerAddon(addon({ version: '' }))).toThrow(/version/);
    expect(listAddons()).toEqual([]);
  });
});

describe('field validation', () => {
  it('rejects duplicate field keys', () => {
    expect(() =>
      registerAddon(
        addon({
          fields: [field({ key: 'owner' }), field({ key: 'owner', label: 'Owner again' })],
        }),
      ),
    ).toThrow(/more than once/);
    expect(listAddons()).toEqual([]);
  });

  it('rejects an empty field key', () => {
    expect(() => registerAddon(addon({ fields: [field({ key: '  ' })] }))).toThrow(/key/);
  });

  it('rejects a select field with neither options nor optionsSource', () => {
    expect(() =>
      registerAddon(addon({ fields: [field({ type: 'select' })] })),
    ).toThrow(/neither options nor optionsSource/);
  });

  it('rejects a select field with an empty options array', () => {
    expect(() =>
      registerAddon(addon({ fields: [field({ type: 'select', options: [] })] })),
    ).toThrow(/neither options nor optionsSource/);
  });

  it('rejects a user field that defines static options', () => {
    expect(() =>
      registerAddon(
        addon({
          fields: [
            field({
              type: 'user',
              options: [{ value: 'u1', label: 'User One' }],
            }),
          ],
        }),
      ),
    ).toThrow(/must not define options or optionsSource/);
  });

  it('rejects a user field that defines an optionsSource (build-spec §12: user fields have neither)', () => {
    expect(() =>
      registerAddon(addon({ fields: [field({ type: 'user', optionsSource: 'users' })] })),
    ).toThrow(/must not define options or optionsSource/);
  });

  it('rejects searchFields that are not text or longtext', () => {
    expect(() =>
      registerAddon(
        addon({ fields: [field({ key: 'count', type: 'number' })], searchFields: ['count'] }),
      ),
    ).toThrow(/non-text search field/);
    expect(listAddons()).toEqual([]);
  });

  it('rejects searchFields that reference unknown fields', () => {
    expect(() =>
      registerAddon(addon({ fields: [field({ key: 'notes' })], searchFields: ['notes', 'ghost'] })),
    ).toThrow(/unknown search field "ghost"/);
    expect(listAddons()).toEqual([]);
  });
});


describe('capability definitions', () => {
  it('accepts a description provider with format compatibility', () => {
    registerAddon(
      addon({
        identifier: 'description-markdown',
        capabilities: ['description'],
        formats: { reads: ['markdown@1'], writes: ['markdown@1'] },
        fields: [],
      }),
    );
    expect(listCapabilityProviders('description').map((entry) => entry.identifier)).toEqual([
      'description-markdown',
    ]);
    expect(listPropertyAddons()).toEqual([]);
  });

  it('rejects a description provider without formats', () => {
    expect(() =>
      registerAddon(
        addon({
          identifier: 'description-broken',
          capabilities: ['description'],
          fields: [],
        }),
      ),
    ).toThrow(/declares no formats/);
  });

  it('rejects a format it writes but does not read', () => {
    expect(() =>
      registerAddon(
        addon({
          identifier: 'description-broken',
          capabilities: ['description'],
          formats: { reads: ['markdown@1'], writes: ['html@1'] },
          fields: [],
        }),
      ),
    ).toThrow(/does not declare that it reads it/);
  });

  it('rejects an unknown capability', () => {
    expect(() =>
      registerAddon(
        addon({
          identifier: 'description-broken',
          capabilities: ['made-up' as never],
          fields: [],
        }),
      ),
    ).toThrow(/unknown capability/);
  });


  it('accepts a comments provider with content formats', () => {
    registerAddon(
      addon({
        identifier: 'comments-markdown',
        capabilities: ['comments'],
        formats: { reads: ['comment-md@1'], writes: ['comment-md@1'] },
        fields: [],
      }),
    );
    expect(listCapabilityProviders('comments').map((entry) => entry.identifier)).toEqual([
      'comments-markdown',
    ]);
  });

  it('rejects a comments provider without formats', () => {
    expect(() =>
      registerAddon(
        addon({
          identifier: 'comments-broken',
          capabilities: ['comments'],
          fields: [],
        }),
      ),
    ).toThrow(/content provider/);
  });

  it('keeps definitions without capabilities as property add-ons', () => {
    registerAddon(addon());
    expect(listPropertyAddons().map((entry) => entry.identifier)).toEqual(['assignee']);
    expect(listCapabilityProviders('description')).toEqual([]);
  });
});

describe('registry lifecycle', () => {
  it('clearAddonsForTests empties the registry', () => {
    registerAddon(addon());
    expect(listAddons()).toHaveLength(1);
    clearAddonsForTests();
    expect(listAddons()).toEqual([]);
    expect(getAddon('assignee')).toBeUndefined();
  });
});
