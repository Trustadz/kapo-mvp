import { describe, expect, it } from 'vitest';
import type { AddonFieldDefinition } from '@/lib/addons';
import {
  draftFromValue,
  isAddonValueDirty,
  toAddonFieldValue,
} from '@/components/projects/addonFieldValues';

/**
 * Pure conversion/dirty rules behind the inline add-on editors. They are the
 * part of the editor behaviour that can be tested without a DOM; the browser
 * interactions are covered by the targeted Playwright spec.
 */

const text: AddonFieldDefinition = { key: 'summary', label: 'Summary', type: 'text' };
const number: AddonFieldDefinition = { key: 'estimate', label: 'Estimate', type: 'number' };
const date: AddonFieldDefinition = { key: 'due', label: 'Due', type: 'date' };
const boolean: AddonFieldDefinition = { key: 'flagged', label: 'Flagged', type: 'boolean' };

describe('inline add-on value conversion', () => {
  it('keeps text as typed and treats an empty draft as null', () => {
    expect(toAddonFieldValue(text, '  Paint hallway  ')).toBe('  Paint hallway  ');
    expect(toAddonFieldValue(text, '')).toBeNull();
  });

  it('converts finite numbers and passes invalid input through for the server error', () => {
    expect(toAddonFieldValue(number, '42')).toBe(42);
    expect(toAddonFieldValue(number, '')).toBeNull();
    expect(toAddonFieldValue(number, 'not a number')).toBe('not a number');
  });

  it('keeps ISO dates unchanged and clears an empty date', () => {
    expect(toAddonFieldValue(date, '2026-11-22')).toBe('2026-11-22');
    expect(toAddonFieldValue(date, '')).toBeNull();
  });

  it('converts booleans without treating a missing draft as true', () => {
    expect(draftFromValue(boolean, true)).toBe(true);
    expect(draftFromValue(boolean, null)).toBe(false);
    expect(toAddonFieldValue(boolean, true)).toBe(true);
    expect(toAddonFieldValue(boolean, false)).toBe(false);
  });
});

describe('inline add-on dirty checks', () => {
  it('sends nothing when the converted value equals the stored value', () => {
    expect(isAddonValueDirty(number, '42', 42)).toBe(false);
    expect(isAddonValueDirty(text, 'Summary', 'Summary')).toBe(false);
    expect(isAddonValueDirty(date, '2026-11-22', '2026-11-22')).toBe(false);
    expect(isAddonValueDirty(boolean, true, true)).toBe(false);
    expect(isAddonValueDirty(text, '', null)).toBe(false);
  });

  it('detects real changes, including clearing a value', () => {
    expect(isAddonValueDirty(number, '43', 42)).toBe(true);
    expect(isAddonValueDirty(text, 'Changed', null)).toBe(true);
    expect(isAddonValueDirty(text, '', 'Summary')).toBe(true);
    expect(isAddonValueDirty(boolean, false, true)).toBe(true);
  });

  it('derives an editor draft from the stored value', () => {
    expect(draftFromValue(text, 'Summary')).toBe('Summary');
    expect(draftFromValue(number, 42)).toBe('42');
    expect(draftFromValue(date, null)).toBe('');
  });
});
