import {
  ADDON_CAPABILITIES,
  ADDON_MODES,
  type AddonCapability,
  type AddonDefinition,
  type AddonFormats,
} from './types';

/**
 * Add-on registry. Registration is intentionally strict so a malformed add-on
 * fails fast at startup instead of corrupting project data later. The manifest
 * (`src/server/addons/index.ts`) wraps each registration in a per-add-on
 * try/catch so one broken add-on can never take Kapo down.
 */

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/;
const FORMAT_ID_PATTERN = /^[a-z][a-z0-9+.-]*@\d+$/;
const TEXT_FIELD_TYPES: ReadonlySet<string> = new Set(['text', 'longtext']);

const addons = new Map<string, AddonDefinition>();

function isAddonMode(value: unknown): value is (typeof ADDON_MODES)[number] {
  return typeof value === 'string' && (ADDON_MODES as readonly string[]).includes(value);
}

function isAddonCapability(value: unknown): value is AddonCapability {
  return typeof value === 'string' && (ADDON_CAPABILITIES as readonly string[]).includes(value);
}

/** Omitted capabilities preserve the original property-only contract. */
export function capabilitiesOf(definition: AddonDefinition): readonly AddonCapability[] {
  return definition.capabilities ?? ['property'];
}

function assertValidFormats(identifier: string, formats: AddonFormats): void {
  if (!formats || typeof formats !== 'object') {
    throw new Error(`Add-on "${identifier}" has an invalid formats declaration.`);
  }
  for (const direction of ['reads', 'writes'] as const) {
    const values = formats[direction];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Add-on "${identifier}" must declare at least one format it ${direction}.`);
    }
    const seen = new Set<string>();
    for (const value of values) {
      if (typeof value !== 'string' || !FORMAT_ID_PATTERN.test(value)) {
        throw new Error(
          `Add-on "${identifier}" has an invalid ${direction} format "${String(value)}".`,
        );
      }
      if (seen.has(value)) {
        throw new Error(`Add-on "${identifier}" declares format "${value}" twice.`);
      }
      seen.add(value);
    }
  }
  for (const write of formats.writes) {
    if (!formats.reads.includes(write)) {
      throw new Error(
        `Add-on "${identifier}" writes format "${write}" but does not declare that it reads it.`,
      );
    }
  }
}

function assertValidCapabilities(definition: AddonDefinition): void {
  if (definition.capabilities !== undefined) {
    if (!Array.isArray(definition.capabilities)) {
      throw new Error(`Add-on "${definition.identifier}" has an invalid capabilities list.`);
    }
    const seen = new Set<string>();
    for (const capability of definition.capabilities) {
      if (!isAddonCapability(capability)) {
        throw new Error(
          `Add-on "${definition.identifier}" declares unknown capability "${String(capability)}".`,
        );
      }
      if (seen.has(capability)) {
        throw new Error(
          `Add-on "${definition.identifier}" declares capability "${capability}" more than once.`,
        );
      }
      seen.add(capability);
    }
  }

  const capabilities = capabilitiesOf(definition);
  if (capabilities.includes('description')) {
    if (!definition.formats) {
      throw new Error(
        `Add-on "${definition.identifier}" is a description provider but declares no formats.`,
      );
    }
    assertValidFormats(definition.identifier, definition.formats);
  } else if (definition.formats) {
    assertValidFormats(definition.identifier, definition.formats);
  }
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
  assertValidCapabilities(definition);

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

/** Add-ons that contribute project properties (the shipped field contract). */
export function listPropertyAddons(): AddonDefinition[] {
  return listAddons().filter((definition) => capabilitiesOf(definition).includes('property'));
}

/** Registered providers for one capability, in registration order. */
export function listCapabilityProviders(capability: AddonCapability): AddonDefinition[] {
  return listAddons().filter((definition) => capabilitiesOf(definition).includes(capability));
}

/** Test/development helper; the product itself never clears the registry. */
export function clearAddonsForTests(): void {
  addons.clear();
}
