'use client';

import { markdownDescriptionProviderClient } from '../description-markdown';
import type { DescriptionProviderClient } from './types';

/**
 * Static client registry for compiled-in description providers.
 *
 * Adding a provider means adding its client module here and its server
 * definition to `src/server/addons/index.ts`. The core description component
 * resolves by id and never branches on a concrete provider.
 */
const providers = new Map<string, DescriptionProviderClient>([
  [markdownDescriptionProviderClient.identifier, markdownDescriptionProviderClient],
]);

export function getDescriptionProviderClient(
  identifier: string,
): DescriptionProviderClient | null {
  return providers.get(identifier) ?? null;
}

export function listDescriptionProviderClients(): DescriptionProviderClient[] {
  return [...providers.values()];
}
