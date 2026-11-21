import { ADDON_MODES, type AddonDefinition } from './types';

/**
 * Add-on registry. Registration is intentionally strict so a malformed add-on
 * fails fast at startup instead of corrupting project data later. The manifest
 * (`src/server/addons/index.ts`) wraps each registration in a per-add-on
 * try/catch so one broken add-on can never take Kapo down.
 */

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/;
const TEXT_FIELD_TYPES: ReadonlySet<string> = new Set(['text', 'longtext']);

const addons = new Map<string, AddonDefinition>();

function isAddonMode(value: unknown): value is (typeof ADDON_MODES)[number] {
  return typeof value === 'string' && (ADDON_MODES as readonly string[]).includes(value);
}

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
  if (definition.defaultMode !== undefined && !isAddonMode(definition.defaultMode)) {
    throw new Error(
      `Add-on "${definition.identifier}" has an invalid defaultMode "${String(definition.defaultMode)}".`,
    );
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

    if (field.type === 'user') {
      const hasStaticOptions = Array.isArray(field.options) && field.options.length > 0;
      if (hasStaticOptions || field.optionsSource !== undefined) {
        throw new Error(
          `Add-on "${definition.identifier}" field "${field.key}" is a user field and must not define options or optionsSource.`,
        );
      }
    }
  }

  for (const searchField of definition.searchFields ?? []) {
    const field = definition.fields.find((candidate) => candidate.key === searchField);
    if (!field) {
      throw new Error(
        `Add-on "${definition.identifier}" exposes unknown search field "${searchField}".`,
      );
    }
    // Only text/longtext may be indexed (docs/add-ons.md §8; privacy contract).
    if (!TEXT_FIELD_TYPES.has(field.type)) {
      throw new Error(
        `Add-on "${definition.identifier}" exposes non-text search field "${searchField}".`,
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
