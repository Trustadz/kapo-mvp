import type { AddonDefinition } from './types';

/**
 * End-to-end-only fixture add-on.
 *
 * The production registry ships only real user-facing add-ons. Playwright sets
 * `KAPO_E2E_ADDONS=1` so the same generic field model can be exercised across
 * every supported field type, including longtext Markdown, without giving the
 * inline editors any add-on-specific branches. Without that environment
 * variable this definition is neither registered nor visible anywhere.
 */
export const e2eFieldsAddon: AddonDefinition = {
  identifier: 'e2e-fields',
  name: 'E2E fields',
  description: 'Test-only add-on that exercises every generic add-on field type.',
  version: '1.0.0',
  defaultMode: 'always',
  fields: [
    {
      key: 'notes',
      label: 'Notes',
      type: 'longtext',
      maxLength: 2000,
      description: 'Markdown notes.',
    },
    { key: 'summary', label: 'Summary', type: 'text', maxLength: 80 },
    { key: 'estimate', label: 'Estimate', type: 'number', min: 0, max: 100 },
    { key: 'due', label: 'Due date', type: 'date' },
    { key: 'flagged', label: 'Flagged', type: 'boolean' },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      options: [
        { value: 'home', label: 'Home' },
        { value: 'work', label: 'Work' },
      ],
    },
    {
      key: 'reviewer',
      label: 'Reviewer',
      type: 'select',
      optionsSource: 'users',
      description: 'Select from the household.',
    },
  ],
  searchFields: ['notes'],
};
