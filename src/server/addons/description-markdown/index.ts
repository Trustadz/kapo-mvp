import type { AddonDefinition } from '../types';

/**
 * Markdown description provider.
 *
 * The first capability add-on. Core owns the durable description record and the
 * plaintext fallback; this definition supplies the editable representation and
 * the format it can read and write.
 */
export const descriptionMarkdownAddon: AddonDefinition = {
  identifier: 'description-markdown',
  name: 'Markdown description',
  description: 'Write the project description with simple Markdown.',
  version: '1.0.0',
  defaultMode: 'always',
  capabilities: ['description'],
  formats: {
    reads: ['markdown@1', 'text@1'],
    writes: ['markdown@1'],
  },
  fields: [],
};
