'use client';

import { Markdown, MarkdownTextarea } from '@/components/ui';
import { stripMarkdown } from '@/lib/markdown';
import type { DescriptionProviderClient } from '../description/types';

/**
 * Markdown description provider — client half.
 *
 * The editor is the shared Markdown textarea with Edit/Preview tabs. The
 * plaintext projection is stored with the record so core can render/search it
 * even when this provider is disabled.
 */
export const markdownDescriptionProviderClient: DescriptionProviderClient = {
  identifier: 'description-markdown',
  defaultFormat: 'markdown@1',
  Editor: ({ label, value, onChange, disabled, autoFocus }) => (
    <MarkdownTextarea
      label={label}
      value={value}
      onChange={onChange}
      rows={8}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  ),
  Renderer: ({ value }) => <Markdown value={value} />,
  serialize: (body) => ({
    body,
    format: 'markdown@1',
    plaintext: stripMarkdown(body),
  }),
};
