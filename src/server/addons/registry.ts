import type { AddonDefinition } from './types';

/**
 * Add-on registry. Empty in the MVP: no add-ons ship (build-spec §1).
 *
 * Registration is intentionally strict so a malformed add-on fails fast at
 * startup instead of corrupting project data later.
 */

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/;

const addons = new Map<string, AddonDefinition>();

function assertValidDefinition(definition: AddonDefinition): void {
  if (!IDENTIFIER_PATTERN.test(definition.identifier)) {
    throw new Error(
      `Add-on identifier "${definition.identifier}" must match ${IDENTIFIER_PATTERN.source}.`,
    );
  }
  if (!definition.name.trim()) {
    throw new Error(`Add-on "${definition.identifier}" must have a name.`);
  }
  if (!definition.version.trim()) {
    throw new Error(`Add-on "${definition.identifier}" must have a version.`);
  }
  if (addons.has(definition.identifier)) {
    throw new Error(`Add-on "${definition.identifier}" is already registered.`);
  }

  const fieldKeys = new Set<string>();
  for (const field of definition.fields) {
    if (!field.key.trim()) {
      throw new Error(`Add-on "${definition.identifier}" has a field without a key.`);
    }
    if (fieldKeys.has(field.key)) {
      throw new Error(
        `Add-on "${definition.identifier}" defines field "${field.key}" more than once.`,
      );
    }
    fieldKeys.add(field.key);

    if (field.type === 'select') {
      const hasOptions = Array.isArray(field.options) && field.options.length > 0;
      const hasSource = field.optionsSource === 'users';
      if (!hasOptions && !hasSource) {
        throw new Error(
          `Add-on "${definition.identifier}" field "${field.key}" is a select but has neither options nor optionsSource.`,
        );
      }
    }

    if (field.type === 'user' && Array.isArray(field.options) && field.options.length > 0) {
      throw new Error(
        `Add-on "${definition.identifier}" field "${field.key}" is a user field and must not define static options.`,
      );
    }
  }

  for (const searchField of definition.searchFields ?? []) {
    if (!fieldKeys.has(searchField)) {
      throw new Error(
        `Add-on "${definition.identifier}" exposes unknown search field "${searchField}".`,
      );
    }
  }
}

export function registerAddon(definition: AddonDefinition): void {
  assertValidDefinition(definition);
  addons.set(definition.identifier, definition);
}

export function getAddon(identifier: string): AddonDefinition | undefined {
  return addons.get(identifier);
}

export function listAddons(): AddonDefinition[] {
  return [...addons.values()];
}

/** Test/development helper; the product itself never clears the registry. */
export function clearAddonsForTests(): void {
  addons.clear();
}
