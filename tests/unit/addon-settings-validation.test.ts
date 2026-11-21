import { describe, expect, it } from 'vitest';
import type {
  AddonApplicationConfig,
  AddonFieldDefinition,
} from '@/lib/addons';
import {
  addonSettingsFieldList,
  applicationAddonSettingsPayload,
  initialAddonSettings,
  isEditableApplicationSetting,
  validateAddonApplicationSettings,
} from '@/lib/addon-settings';

/**
 * Generic application add-on settings contract:
 * boolean/number/text/longtext/date/static-select controls validate types,
 * required, bounds/length, dates and options; unsupported declarations stay
 * read-only; malformed definitions never throw.
 */

const fields: AddonFieldDefinition[] = [
  { key: 'enabled', label: 'Enabled', type: 'boolean' },
  { key: 'limit', label: 'Limit', type: 'number', min: 1, max: 5 },
  { key: 'label', label: 'Label', type: 'text', maxLength: 4 },
  { key: 'notes', label: 'Notes', type: 'longtext' },
  { key: 'starts_on', label: 'Starts on', type: 'date' },
  {
    key: 'frequency',
    label: 'Frequency',
    type: 'select',
    options: [
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
    ],
  },
  { key: 'required_note', label: 'Required note', type: 'text', required: true },
  { key: 'owner', label: 'Owner', type: 'user' },
];

function validValues(): Record<string, unknown> {
  return {
    enabled: true,
    limit: 3,
    label: 'abc',
    notes: 'line one\nline two',
    starts_on: '2026-11-21',
    frequency: 'weekly',
    required_note: 'hello',
    legacy_key: 'preserved',
  };
}

describe('addonSettingsFieldList', () => {
  it('returns a serialisable, de-duplicated field list', () => {
    const list = addonSettingsFieldList([
      { key: 'a', label: 'A', type: 'text', options: [{ value: 'x', label: 'X' }] },
      { key: 'a', label: 'Duplicate', type: 'text' },
      { key: '', label: 'Empty key', type: 'text' },
      { key: 'b', type: 'number', min: 1, max: 2, defaultValue: 1 },
      null,
      'not a field',
      { key: 'c', label: 'C', type: 'text', options: 'broken' },
    ]);
    expect(list.map((field) => field.key)).toEqual(['a', 'b', 'c']);
    expect(list[0]?.options).toEqual([{ value: 'x', label: 'X' }]);
    expect(list[2]?.options).toBeUndefined();
  });

  it('never throws on malformed definitions', () => {
    for (const raw of [undefined, null, 'nope', 42, {}, [null, 1, [], { key: 3 }]]) {
      expect(() => addonSettingsFieldList(raw)).not.toThrow();
      expect(addonSettingsFieldList(raw)).toEqual([]);
    }
  });
});

describe('validateAddonApplicationSettings', () => {
  it('accepts and normalises every supported type', () => {
    const result = validateAddonApplicationSettings(fields, validValues());
    expect(result.issues).toEqual([]);
    expect(result.values).toEqual({
      enabled: true,
      limit: 3,
      label: 'abc',
      notes: 'line one\nline two',
      starts_on: '2026-11-21',
      frequency: 'weekly',
      required_note: 'hello',
    });
    // Unknown keys and read-only unsupported fields are not rewritten here.
    expect(result.values).not.toHaveProperty('legacy_key');
    expect(result.values).not.toHaveProperty('owner');
  });

  it('reports required fields and required booleans', () => {
    const missing = validateAddonApplicationSettings(fields, {
      ...validValues(),
      required_note: '   ',
    });
    expect(missing.issues).toContainEqual({
      field: 'required_note',
      message: 'Required note is required.',
    });

    const unchecked = validateAddonApplicationSettings(
      [{ key: 'accept', label: 'Accept', type: 'boolean', required: true }],
      { accept: false },
    );
    expect(unchecked.issues).toEqual([
      { field: 'accept', message: 'Accept must be checked.' },
    ]);
  });

  it('validates boolean, number, bounds and unknown value shapes', () => {
    const wrongBoolean = validateAddonApplicationSettings(fields, {
      ...validValues(),
      enabled: 'yes',
    });
    expect(wrongBoolean.issues).toContainEqual({
      field: 'enabled',
      message: 'Choose yes or no.',
    });

    const wrongNumber = validateAddonApplicationSettings(fields, {
      ...validValues(),
      limit: '3',
    });
    expect(wrongNumber.issues).toContainEqual({
      field: 'limit',
      message: 'Enter a number.',
    });

    const tooLow = validateAddonApplicationSettings(fields, {
      ...validValues(),
      limit: 0,
    });
    expect(tooLow.issues).toContainEqual({
      field: 'limit',
      message: 'Enter a value of at least 1.',
    });

    const tooHigh = validateAddonApplicationSettings(fields, {
      ...validValues(),
      limit: 6,
    });
    expect(tooHigh.issues).toContainEqual({
      field: 'limit',
      message: 'Enter a value of at most 5.',
    });

    const objectValue = validateAddonApplicationSettings(fields, {
      ...validValues(),
      limit: [3],
    });
    expect(objectValue.issues).toContainEqual({
      field: 'limit',
      message: 'Enter a number.',
    });
  });

  it('validates text single-line and maxLength, while longtext keeps newlines', () => {
    const newline = validateAddonApplicationSettings(fields, {
      ...validValues(),
      label: 'ab\ncd',
    });
    expect(newline.issues).toContainEqual({
      field: 'label',
      message: 'Use a single line of text.',
    });

    const tooLong = validateAddonApplicationSettings(fields, {
      ...validValues(),
      label: 'abcde',
    });
    expect(tooLong.issues).toContainEqual({
      field: 'label',
      message: 'Keep this value to 4 characters.',
    });

    const longtext = validateAddonApplicationSettings(fields, {
      ...validValues(),
      notes: 'first\nsecond',
    });
    expect(longtext.issues).toEqual([]);
    expect(longtext.values.notes).toBe('first\nsecond');
  });

  it('validates dates and select options', () => {
    const impossible = validateAddonApplicationSettings(fields, {
      ...validValues(),
      starts_on: '2026-02-30',
    });
    expect(impossible.issues).toContainEqual({
      field: 'starts_on',
      message: 'Choose a valid date.',
    });

    const badOption = validateAddonApplicationSettings(fields, {
      ...validValues(),
      frequency: 'monthly',
    });
    expect(badOption.issues).toContainEqual({
      field: 'frequency',
      message: 'Choose one of the available options.',
    });

    const missingOptions = validateAddonApplicationSettings(
      [{ key: 'frequency', label: 'Frequency', type: 'select' }],
      { frequency: 'daily' },
    );
    expect(missingOptions.issues).toEqual([
      {
        field: 'frequency',
        message:
          'This setting is a dynamic select and cannot be edited in Application settings.',
      },
    ]);
  });

  it('treats unsupported types as read-only unless the caller writes them', () => {
    const preserved = validateAddonApplicationSettings(fields, validValues(), {
      providedKeys: new Set(['limit']),
    });
    expect(preserved.issues).toEqual([]);
    expect(preserved.values).not.toHaveProperty('owner');

    const writeAttempt = validateAddonApplicationSettings(
      fields,
      { ...validValues(), owner: 'user-2' },
      { providedKeys: new Set(['owner']) },
    );
    expect(writeAttempt.issues).toEqual([
      {
        field: 'owner',
        message: 'This setting type is not supported in Application settings.',
      },
    ]);
  });

  it('never throws on malformed definitions', () => {
    for (const raw of [undefined, null, 'nope', {}, [null, { key: 'x' }]]) {
      expect(() =>
        validateAddonApplicationSettings(raw as never, { anything: true }),
      ).not.toThrow();
    }
  });
});

describe('add-on settings payloads', () => {
  it('sends only editable declared fields and keeps defaults in drafts', () => {
    const settingsFields: AddonFieldDefinition[] = [
      ...fields,
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        optionsSource: 'users',
      },
      {
        key: 'defaulted',
        label: 'Defaulted',
        type: 'boolean',
        defaultValue: true,
      },
    ];
    const config: Pick<AddonApplicationConfig, 'settings' | 'settingsFields'> = {
      settingsFields,
      settings: { owner: 'user-1', legacy_key: 'keep' },
    };
    expect(initialAddonSettings(config)).toEqual({
      owner: 'user-1',
      legacy_key: 'keep',
      defaulted: true,
    });
    expect(applicationAddonSettingsPayload(config, initialAddonSettings(config))).toEqual({
      enabled: null,
      limit: null,
      label: null,
      notes: null,
      starts_on: null,
      frequency: null,
      required_note: null,
      defaulted: true,
    });
  });

  it('marks dynamic selects and user fields as not editable', () => {
    expect(
      isEditableApplicationSetting({ key: 'owner', label: 'Owner', type: 'user' }),
    ).toBe(false);
    expect(
      isEditableApplicationSetting({
        key: 'owner',
        label: 'Owner',
        type: 'select',
        optionsSource: 'users',
      }),
    ).toBe(false);
    expect(
      isEditableApplicationSetting({
        key: 'owner',
        label: 'Owner',
        type: 'select',
        options: [{ value: 'a', label: 'A' }],
      }),
    ).toBe(true);
  });
});
