'use client';

import { commentMarkdownProviderClient } from '../comments-markdown';
import type { CommentProviderClient } from './types';

const providers = new Map<string, CommentProviderClient>([
  [commentMarkdownProviderClient.identifier, commentMarkdownProviderClient],
]);

export function getCommentProviderClient(
  identifier: string,
): CommentProviderClient | null {
  return providers.get(identifier) ?? null;
}
