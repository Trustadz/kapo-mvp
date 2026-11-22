import { describe, expect, it } from 'vitest';
import {
  availableAddonFieldRefs,
  isAddonFieldRef,
  parseAddonFieldRef,
  serializeAddonFieldRef,
  type ProjectAddonEditorItem,
} from '@/lib/addons';
import {
  filterAvailableAddonRefs,
  isStoredProjectFieldKey,
  isStoredViewFieldKey,
} from '@/lib/projects';
import { parseProjectSettings } from '@/server/domain/projects';

/**
 * Generic add-on field slots: the opaque reference format, layout/view parsing
 * and availability filtering. No test names a concrete add-on renderer.
 */

describe('add-on field references', () => {
  it('round-trips identifier and field key', () => {
    const ref = serializeAddonFieldRef('assignee', 'assignee');
    expect(ref).toBe('addon:assignee:assignee');
    expect(parseAddonFieldRef(ref)).toEqual({
      identifier: 'assignee',
      fieldKey: 'assignee',
    });
  });

  it('keeps colons inside the field key and rejects malformed references', () => {
    expect(parseAddonFieldRef('addon:my-addon:group:field')).toEqual({
      identifier: 'my-addon',
      fieldKey: 'group:field',
    });
    for (const invalid of [
      'assignee',
      '',
      'addon:',
      'addon:assignee',
      'addon:Assignee:assignee',
      'addon:1assignee:assignee',
      'addon:add on:assignee',
      'addon:assignee:',
      null,
      42,
    ]) {
      expect(parseAddonFieldRef(invalid)).toBeNull();
      expect(isAddonFieldRef(invalid)).toBe(false);
    }
  });

  it('recognises core and add-on keys for both layout slot kinds', () => {
    expect(isStoredProjectFieldKey('projectId')).toBe(true);
    expect(isStoredProjectFieldKey('addon:assignee:assignee')).toBe(true);
    expect(isStoredProjectFieldKey('priority')).toBe(false);
    expect(isStoredProjectFieldKey('addon:bad ref:x')).toBe(false);

    expect(isStoredViewFieldKey('status')).toBe(true);
    expect(isStoredViewFieldKey('addon:assignee:assignee')).toBe(true);
    expect(isStoredViewFieldKey('addon:assignee')).toBe(false);
  });
});

describe('availability filtering', () => {
  it('only lets add-on refs through when the project offers them', () => {
    const available = new Set(['addon:assignee:assignee']);
    const keys = [
      'status',
      'addon:assignee:assignee',
      'addon:retired:field',
    ] as const;
    expect(filterAvailableAddonRefs(keys, available)).toEqual([
      'status',
      'addon:assignee:assignee',
    ]);
    expect(filterAvailableAddonRefs(['status'] as const, new Set())).toEqual(['status']);
  });

  it('derives the available refs from the editor items', () => {
    const items: ProjectAddonEditorItem[] = [
      {
        identifier: 'assignee',
        name: 'Assignee',
        version: '1.0.0',
        mode: 'optional',
        required: false,
        fields: [
          { key: 'assignee', label: 'Assigned to', type: 'user' },
          { key: 'note', label: 'Note', type: 'text' },
        ],
        values: {},
      },
    ];
    expect([...availableAddonFieldRefs(items)]).toEqual([
      'addon:assignee:assignee',
      'addon:assignee:note',
    ]);
  });
});

describe('stored layout and view settings', () => {
  it('preserves valid add-on refs and dedupes without disturbing core fields', () => {
    const settings = parseProjectSettings(
      JSON.stringify({
        layout_template: {
          main: [
            'projectId',
            'addon:assignee:assignee',
            'addon:assignee:assignee',
            'addon:retired:field',
            'not-a-field',
          ],
          sidebar: ['status', 'addon:assignee:assignee'],
        },
        view_fields: {
          kanban: ['status', 'addon:assignee:assignee', 'addon:assignee:assignee'],
          card: ['priority', 'addon:assignee:assignee'],
          tree: ['addon:retired:field', 'addon:assignee:assignee'],
          list: ['id'],
        },
      }),
    );

    expect(settings.layout_template).toEqual({
      main: ['projectId', 'addon:assignee:assignee', 'addon:retired:field'],
      sidebar: ['status', 'addon:assignee:assignee'],
    });
    // Retired core keys are dropped; syntactically valid add-on refs to an
    // unregistered add-on are preserved (presentation filters availability).
    expect(settings.view_fields).toEqual({
      kanban: ['status', 'addon:assignee:assignee'],
      card: ['addon:assignee:assignee'],
      tree: ['addon:retired:field', 'addon:assignee:assignee'],
      list: ['id'],
    });
  });

  it('leaves the default layout and view fields untouched', () => {
    const settings = parseProjectSettings(null);
    expect(settings.layout_template).toBeNull();
    expect(settings.view_fields).toEqual({
      kanban: [],
      card: [],
      tree: ['status'],
      list: [],
    });
  });

  it('drops malformed add-on refs from stored settings without throwing', () => {
    const settings = parseProjectSettings(
      JSON.stringify({
        layout_template: { main: ['addon:', 'addon:no-key', 'addon:Bad:x'], sidebar: [] },
        view_fields: { kanban: ['addon:', 'status'], card: [], tree: [], list: [] },
      }),
    );
    expect(settings.layout_template).toBeNull();
    expect(settings.view_fields.kanban).toEqual(['status']);
  });
});
