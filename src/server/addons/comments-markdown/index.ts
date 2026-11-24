import type { AddonDefinition } from '../types';

/**
 * Basic Markdown comments provider.
 *
 * Core owns each comment record, author and plaintext fallback. This add-on
 * supplies a deliberately small format: bold, italic, underline and
 * strikethrough, with no links, lists, code blocks, mentions or replies.
 */
export const commentsMarkdownAddon: AddonDefinition = {
  identifier: 'comments-markdown',
  name: 'Markdown comments',
  description: 'Discuss a project with basic formatting.',
  version: '1.0.0',
  defaultMode: 'always',
  capabilities: ['comments'],
  formats: {
    reads: ['comment-md@1', 'text@1'],
    writes: ['comment-md@1'],
  },
  fields: [],
};
