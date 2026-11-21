import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type {
  AddonApplicationConfig,
  ProjectAddonConfigView,
  ProjectAddonEditorData,
  ProjectAddonEditorItem,
  ProjectAddonUserOption,
} from '@/lib/addons';
import {
  addonSettingsFieldList,
  isEditableApplicationSetting,
  validateAddonApplicationSettings,
} from '@/lib/addon-settings';
import { AUDIT_ACTIONS } from '@/lib/audit';
import {
  ADDON_MODES,
  getAddon,
  listAddons,
  type AddonDefinition,
  type AddonFieldDefinition,
  type AddonFieldValue,
  type AddonMode,
  type AddonProjectConfig,
  type AddonValidationIssue,
  type ResolvedAddonConfig,
} from '@/server/addons';
import { indexProject, searchBodyFromAddonValues } from '@/server/db/search';
import { nowIso, parseJsonObject } from '@/server/db/util';
import { recordAuditEvent } from './audit';
import {
  DomainError,
  canAdminProject,
  canEditProject,
  canReadProject,
  isTrashedProject,
  loadAccessContext,
  type AccessUser,
} from './permissions';

/**
 * Core add-on plumbing (docs/add-ons.md §2–§4, §8, §10).
 *
 * This module owns everything generic about add-ons:
 *  - registry → `addons` table mode sync (never overwriting an Admin choice);
 *  - per-project enablement/inheritance resolution;
 *  - generic field-type validation and value writes into
 *    `projects.addon_data[identifier][fieldKey]`;
 *  - audit + FTS maintenance inside the write transaction;
 *  - application/project configuration writes that preserve unknown keys.
 *
 * No function here branches on an add-on identifier: all add-on-specific
 * behaviour comes from `AddonDefinition` and its hooks.
 */

const SETTINGS_KEY = 'addons';
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/;

interface ProjectAddonRow {
  id: string;
  parent_id: string | null;
  title: string;
  settings: string;
  addon_data: string;
  trashed_at: string | null;
}

function requireProjectRow(db: BetterSqliteDatabase, projectId: string): ProjectAddonRow {
  const row = db
    .prepare(
      'SELECT id, parent_id, title, settings, addon_data, trashed_at FROM projects WHERE id = ?',
    )
    .get(projectId) as ProjectAddonRow | undefined;
  if (!row) throw new DomainError(404, 'not_found', 'Project not found.');
  return row;
}

function loadProjectChain(db: BetterSqliteDatabase, projectId: string): ProjectAddonRow[] | null {
  const chain: ProjectAddonRow[] = [];
  let row = db
    .prepare(
      'SELECT id, parent_id, title, settings, addon_data, trashed_at FROM projects WHERE id = ?',
    )
    .get(projectId) as ProjectAddonRow | undefined;
  if (!row) return null;
  let guard = 0;
  while (row && guard < 200) {
    chain.push(row);
    row = row.parent_id
      ? (db
          .prepare(
            'SELECT id, parent_id, title, settings, addon_data, trashed_at FROM projects WHERE id = ?',
          )
          .get(row.parent_id) as ProjectAddonRow | undefined)
      : undefined;
    guard += 1;
  }
  return chain;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is AddonFieldValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function parseScalarSettings(value: unknown): Record<string, AddonFieldValue> {
  if (!isRecord(value)) return {};
  const result: Record<string, AddonFieldValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isScalar(entry)) result[key] = entry;
  }
  return result;
}

/** Reads and normalises the reserved `settings.addons[...]` shape. */
export function parseProjectAddonConfigs(
  rawSettings: string | null | undefined,
): Record<string, AddonProjectConfig> {
  const parsed = parseJsonObject(rawSettings);
  if (!isRecord(parsed[SETTINGS_KEY])) return {};
  const result: Record<string, AddonProjectConfig> = {};
  for (const [identifier, entry] of Object.entries(parsed[SETTINGS_KEY] as Record<string, unknown>)) {
    if (!isRecord(entry)) continue;
    const config: AddonProjectConfig = {};
    if (typeof entry.enabled === 'boolean') config.enabled = entry.enabled;
    if (typeof entry.inheritFromParent === 'boolean') {
      config.inheritFromParent = entry.inheritFromParent;
    }
    if (isRecord(entry.settings)) config.settings = parseScalarSettings(entry.settings);
    result[identifier] = config;
  }
  return result;
}

/** Reads `projects.addon_data[identifier]`, preserving only scalar field values. */
export function parseProjectAddonValues(
  rawAddonData: string | null | undefined,
  identifier: string,
): Record<string, AddonFieldValue> {
  const data = parseJsonObject(rawAddonData);
  const entry = data[identifier];
  return isRecord(entry) ? parseScalarSettings(entry) : {};
}

export function getAddonMode(db: BetterSqliteDatabase, identifier: string): AddonMode {
  const row = db.prepare('SELECT mode FROM addons WHERE identifier = ?').get(identifier) as
    | { mode: AddonMode }
    | undefined;
  return row?.mode ?? getAddon(identifier)?.defaultMode ?? 'optional';
}

function resolveFromChain(
  chain: ProjectAddonRow[],
  definition: AddonDefinition,
  mode: AddonMode,
): ResolvedAddonConfig {
  const configs = chain.map(
    (node) => parseProjectAddonConfigs(node.settings)[definition.identifier] ?? null,
  );

  let available = false;
  let decidingIndex = -1;
  if (mode === 'required' || mode === 'always') {
    available = true;
  } else if (mode === 'optional') {
    for (let index = 0; index < chain.length; index += 1) {
      const config = configs[index];
      if (!config) continue;
      if (config.enabled === true) {
        available = true;
        decidingIndex = index;
        break;
      }
      if (config.enabled === false) {
        available = false;
        decidingIndex = index;
        break;
      }
      // No explicit decision here: keep walking up only while this project
      // accepts inherited configuration.
      if (config.inheritFromParent === false) {
        decidingIndex = index;
        available = false;
        break;
      }
    }
  }

  // Collect settings from the project upwards while inheritance is allowed,
  // then apply root → leaf so the nearest (most specific) value wins.
  const reachableSettings: Array<Record<string, AddonFieldValue>> = [];
  let reachable = true;
  for (let index = 0; index < chain.length; index += 1) {
    const config = configs[index];
    if (reachable && config?.settings) reachableSettings.push(config.settings);
    if (config?.inheritFromParent === false) reachable = false;
  }
  const settings: Record<string, AddonFieldValue> = {};
  for (let index = reachableSettings.length - 1; index >= 0; index -= 1) {
    Object.assign(settings, reachableSettings[index]);
  }

  return {
    identifier: definition.identifier,
    mode,
    available,
    required: mode === 'required',
    inherited: decidingIndex > 0,
    settings,
  };
}

export function resolveAddonConfig(
  db: BetterSqliteDatabase,
  projectId: string,
  identifier: string,
): ResolvedAddonConfig {
  const chain = loadProjectChain(db, projectId);
  if (!chain) throw new DomainError(404, 'not_found', 'Project not found.');
  const definition = getAddon(identifier);
  if (!definition) throw new DomainError(404, 'not_found', 'Add-on not found.');
  return resolveFromChain(chain, definition, getAddonMode(db, identifier));
}

export function resolveProjectAddons(
  db: BetterSqliteDatabase,
  projectId: string,
): readonly ResolvedAddonConfig[] {
  const chain = loadProjectChain(db, projectId);
  if (!chain) return [];
  return listAddons().map((definition) =>
    resolveFromChain(chain, definition, getAddonMode(db, definition.identifier)),
  );
}

/* ------------------------------------------------------------------------- */
/* Registry ↔ addons table sync                                               */
/* ------------------------------------------------------------------------- */

/**
 * Inserts a row for every registered add-on. Existing modes/settings are never
 * overwritten, and rows for unregistered identifiers are never deleted — their
 * stored values must survive code removal (docs/add-ons.md §3.4/§10.1).
 */
export function syncAddonRegistry(db: BetterSqliteDatabase): string[] {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO addons (identifier, name, mode, settings, created_at)
     VALUES (?, ?, ?, '{}', ?)`,
  );
  const updateName = db.prepare('UPDATE addons SET name = ? WHERE identifier = ?');
  const identifiers: string[] = [];
  for (const definition of listAddons()) {
    insert.run(definition.identifier, definition.name, definition.defaultMode ?? 'optional', nowIso());
    updateName.run(definition.name, definition.identifier);
    identifiers.push(definition.identifier);
  }
  return identifiers;
}

/**
 * Startup repair: sync the registry then rebuild every project's add-on search
 * body so mode/config changes made while the process was down cannot leave
 * hidden text in FTS (docs/add-ons.md §8).
 */
export function syncAddonRegistryAndSearch(db: BetterSqliteDatabase): string[] {
  const identifiers = syncAddonRegistry(db);
  reindexAllProjectAddonSearch(db);
  return identifiers;
}

/* ------------------------------------------------------------------------- */
/* Application configuration                                                  */
/* ------------------------------------------------------------------------- */

export function listAddonApplicationConfigs(db: BetterSqliteDatabase): AddonApplicationConfig[] {
  return listAddons().map((definition) => {
    const row = db
      .prepare('SELECT mode, settings FROM addons WHERE identifier = ?')
      .get(definition.identifier) as { mode: AddonMode; settings: string } | undefined;
    return {
      identifier: definition.identifier,
      name: definition.name,
      ...(definition.description ? { description: definition.description } : {}),
      version: definition.version,
      mode: row?.mode ?? definition.defaultMode ?? 'optional',
      settings: row ? parseScalarSettings(parseJsonObject(row.settings)) : {},
      // Sanitised so a malformed add-on definition can never break page
      // serialisation or the client renderer (functions, bad options, …).
      settingsFields: addonSettingsFieldList(definition.settingsFields),
    };
  });
}

function isMode(value: unknown): value is AddonMode {
  return typeof value === 'string' && (ADDON_MODES as readonly string[]).includes(value);
}

export interface AddonConfigPatch {
  mode?: unknown;
  settings?: unknown;
}

/**
 * Admin mode/settings update. Only registered identifiers are accepted; a
 * single transaction applies every row and reindexes search so availability
 * changes take effect immediately.
 */
export function updateApplicationAddons(
  db: BetterSqliteDatabase,
  input: unknown,
): AddonApplicationConfig[] {
  if (!isRecord(input)) {
    throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
      addons: 'Choose a mode for each add-on.',
    });
  }
  const updates: Array<{ definition: AddonDefinition; mode: AddonMode; settings: string }> = [];
  for (const [identifier, rawPatch] of Object.entries(input)) {
    const definition = getAddon(identifier);
    if (!definition) {
      throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
        [`addons.${identifier}`]: 'This add-on is not registered.',
      });
    }
    if (!isRecord(rawPatch)) {
      throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
        [`addons.${identifier}`]: 'Choose an add-on mode.',
      });
    }
    const mode = rawPatch.mode;
    if (!isMode(mode)) {
      throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
        [`addons.${identifier}.mode`]: 'Choose Required, Always on, Available or Unavailable.',
      });
    }
    if (rawPatch.settings !== undefined && !isRecord(rawPatch.settings)) {
      throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
        [`addons.${identifier}.settings`]: 'Add-on settings must be a key/value object.',
      });
    }
    const existing = db
      .prepare('SELECT settings FROM addons WHERE identifier = ?')
      .get(identifier) as { settings: string } | undefined;
    const storedSettings = existing
      ? parseScalarSettings(parseJsonObject(existing.settings))
      : {};
    let mergedSettings: Record<string, AddonFieldValue> = storedSettings;

    if (rawPatch.settings !== undefined) {
      const rawSettings = rawPatch.settings as Record<string, unknown>;
      const declaredFields = addonSettingsFieldList(definition.settingsFields);
      const declared = new Set(declaredFields.map((field) => field.key));
      const editable = new Set(
        declaredFields
          .filter((field) => isEditableApplicationSetting(field))
          .map((field) => field.key),
      );
      const validationInput: Record<string, unknown> = { ...storedSettings };
      const incomingScalars: Record<string, AddonFieldValue> = {};

      for (const [key, value] of Object.entries(rawSettings)) {
        if (declared.has(key)) {
          // Feed the raw value to the validator (so arrays/objects are
          // rejected) but only merge editable fields: unsupported
          // declarations are read-only here and keep their stored value.
          validationInput[key] = value;
          if (editable.has(key) && isScalar(value)) incomingScalars[key] = value;
          continue;
        }
        // Unknown keys are preserved for compatibility. Non-scalar values stay
        // outside the contract and are ignored, as before.
        if (isScalar(value)) {
          validationInput[key] = value;
          incomingScalars[key] = value;
        }
      }

      const result = validateAddonApplicationSettings(
        definition.settingsFields,
        validationInput,
        { providedKeys: new Set(Object.keys(rawSettings)) },
      );
      if (result.issues.length > 0) {
        const fields: Record<string, string> = {};
        for (const issue of result.issues) {
          fields[
            `addons.${identifier}.settings${issue.field ? `.${issue.field}` : ''}`
          ] = issue.message;
        }
        throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', fields);
      }
      mergedSettings = {
        ...storedSettings,
        ...incomingScalars,
        ...result.values,
      };
    }

    updates.push({ definition, mode, settings: JSON.stringify(mergedSettings) });
  }

  if (updates.length === 0) {
    throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
      addons: 'Choose a mode for at least one add-on.',
    });
  }

  db.transaction(() => {
    const upsert = db.prepare(
      `INSERT INTO addons (identifier, name, mode, settings, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET
         name = excluded.name,
         mode = excluded.mode,
         settings = excluded.settings`,
    );
    for (const update of updates) {
      upsert.run(
        update.definition.identifier,
        update.definition.name,
        update.mode,
        update.settings,
        nowIso(),
      );
    }
    // Availability may have changed globally: hidden add-on text must leave
    // the index, newly available text must enter it.
    reindexAllProjectAddonSearch(db);
  })();

  return listAddonApplicationConfigs(db);
}

/* ------------------------------------------------------------------------- */
/* Project configuration                                                      */
/* ------------------------------------------------------------------------- */

function projectAddonParentTitle(chain: ProjectAddonRow[]): string | null {
  return chain[1]?.title ?? null;
}

export function getProjectAddonSettings(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): ProjectAddonConfigView[] {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  const chain = loadProjectChain(db, projectId);
  if (!chain) throw new DomainError(404, 'not_found', 'Project not found.');
  return listAddons().map((definition) => {
    const mode = getAddonMode(db, definition.identifier);
    const resolved = resolveFromChain(chain, definition, mode);
    const own = parseProjectAddonConfigs(chain[0]?.settings)[definition.identifier];
    return {
      identifier: definition.identifier,
      name: definition.name,
      ...(definition.description ? { description: definition.description } : {}),
      version: definition.version,
      mode,
      enabled: own?.enabled ?? null,
      inheritFromParent: own?.inheritFromParent ?? null,
      available: resolved.available,
      inherited: resolved.inherited,
      required: resolved.required,
      settings: own?.settings ?? {},
      effectiveSettings: { ...resolved.settings },
      parentTitle: projectAddonParentTitle(chain),
    };
  });
}

/**
 * Writes the reserved project configuration shape while preserving every
 * unknown identifier, entry key and setting key.
 */
export function updateProjectAddons(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  input: unknown,
): ProjectAddonConfigView[] {
  const ctx = loadAccessContext(db, user);
  const row = requireProjectRow(db, projectId);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(
      409,
      'trashed_read_only',
      'Restore this project before changing its add-ons.',
    );
  }
  if (!canAdminProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You must be a project Admin to change add-ons.');
  }
  if (!isRecord(input)) {
    throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
      addons: 'Choose an add-on to configure.',
    });
  }

  const patches: Array<{ identifier: string; entry: Record<string, unknown> }> = [];
  for (const [identifier, rawPatch] of Object.entries(input)) {
    if (!IDENTIFIER_PATTERN.test(identifier) || !getAddon(identifier)) {
      throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
        [`addons.${identifier}`]: 'This add-on is not registered.',
      });
    }
    if (!isRecord(rawPatch)) {
      throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
        [`addons.${identifier}`]: 'Choose the add-on configuration.',
      });
    }
    const patch: Record<string, unknown> = {};
    if (rawPatch.enabled !== undefined) {
      if (typeof rawPatch.enabled !== 'boolean') {
        throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
          [`addons.${identifier}.enabled`]: 'Choose whether the add-on is enabled.',
        });
      }
      patch.enabled = rawPatch.enabled;
    }
    if (rawPatch.inheritFromParent !== undefined) {
      if (typeof rawPatch.inheritFromParent !== 'boolean') {
        throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
          [`addons.${identifier}.inheritFromParent`]: 'Choose whether to inherit from the parent.',
        });
      }
      patch.inheritFromParent = rawPatch.inheritFromParent;
    }
    if (rawPatch.settings !== undefined) {
      if (!isRecord(rawPatch.settings)) {
        throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
          [`addons.${identifier}.settings`]: 'Add-on settings must be a key/value object.',
        });
      }
      patch.settings = parseScalarSettings(rawPatch.settings);
    }
    patches.push({ identifier, entry: patch });
  }

  if (patches.length === 0) {
    throw new DomainError(422, 'validation_failed', 'Check the add-on settings.', {
      addons: 'Choose an add-on to configure.',
    });
  }

  const rawSettings = parseJsonObject(row.settings);
  const rawAddons = isRecord(rawSettings[SETTINGS_KEY])
    ? (rawSettings[SETTINGS_KEY] as Record<string, unknown>)
    : {};
  for (const patch of patches) {
    const existing = isRecord(rawAddons[patch.identifier])
      ? (rawAddons[patch.identifier] as Record<string, unknown>)
      : {};
    rawAddons[patch.identifier] = { ...existing, ...patch.entry };
  }
  rawSettings[SETTINGS_KEY] = rawAddons;

  db.transaction(() => {
    db.prepare('UPDATE projects SET settings = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(rawSettings),
      nowIso(),
      projectId,
    );
    // Enabling/disabling here can change availability for the whole subtree.
    reindexProjectAddonSearchSubtree(db, projectId);
  })();

  return getProjectAddonSettings(db, user, projectId);
}

/* ------------------------------------------------------------------------- */
/* Page editor data                                                           */
/* ------------------------------------------------------------------------- */

function userOptions(db: BetterSqliteDatabase): ProjectAddonUserOption[] {
  const rows = db
    .prepare('SELECT id, username FROM users ORDER BY username COLLATE NOCASE ASC')
    .all() as Array<{ id: string; username: string }>;
  return rows.map((row) => ({ value: row.id, label: row.username }));
}

export function getProjectAddonsForPage(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): ProjectAddonEditorData {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) {
    return { items: [], canEdit: false, readOnlyReason: 'viewer' };
  }
  const row = requireProjectRow(db, projectId);
  const trashed = isTrashedProject(ctx, projectId);
  const canEdit = canEditProject(ctx, projectId) && !trashed;
  const resolved = resolveProjectAddons(db, projectId).filter((config) => config.available);
  const allValues = parseJsonObject(row.addon_data);
  const picker = resolved.some((config) =>
    getAddon(config.identifier)?.fields.some((field) => field.type === 'user'),
  )
    ? userOptions(db)
    : [];

  const items: ProjectAddonEditorItem[] = [];
  for (const config of resolved) {
    const definition = getAddon(config.identifier);
    if (!definition) continue;
    const raw = isRecord(allValues[definition.identifier])
      ? parseScalarSettings(allValues[definition.identifier])
      : {};
    const values: Record<string, AddonFieldValue> = {};
    for (const field of definition.fields) values[field.key] = raw[field.key] ?? null;
    items.push({
      identifier: definition.identifier,
      name: definition.name,
      ...(definition.description ? { description: definition.description } : {}),
      version: definition.version,
      mode: config.mode,
      required: config.required,
      fields: definition.fields,
      values,
      ...(definition.fields.some((field) => field.type === 'user')
        ? { userOptions: picker }
        : {}),
    });
  }

  return {
    items,
    canEdit,
    readOnlyReason: trashed ? 'trashed' : canEdit ? null : 'viewer',
  };
}

/* ------------------------------------------------------------------------- */
/* Generic field validation and value writes                                  */
/* ------------------------------------------------------------------------- */

interface NormalisedValue {
  value: AddonFieldValue;
}

function fieldValueError(
  db: BetterSqliteDatabase,
  field: AddonFieldDefinition,
  value: unknown,
): NormalisedValue | { error: string } {
  if (value === null) return { value: null };
  if (typeof value === 'object') {
    return { error: 'Use a single value for this field.' };
  }
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean'
        ? { value }
        : { error: 'Choose yes or no.' };
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { error: 'Enter a number.' };
      }
      if (field.min !== undefined && value < field.min) {
        return { error: `Enter a value of at least ${field.min}.` };
      }
      if (field.max !== undefined && value > field.max) {
        return { error: `Enter a value of at most ${field.max}.` };
      }
      return { value };
    }
    case 'text':
    case 'longtext': {
      if (typeof value !== 'string') return { error: 'Enter text.' };
      const trimmed = value.trim();
      if (field.type === 'text' && /[\r\n]/.test(trimmed)) {
        return { error: 'Use a single line of text.' };
      }
      if (field.maxLength !== undefined && trimmed.length > field.maxLength) {
        return { error: `Keep this value to ${field.maxLength} characters.` };
      }
      return { value: trimmed === '' ? null : trimmed };
    }
    case 'date': {
      if (typeof value !== 'string') return { error: 'Choose a date.' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: 'Choose a valid date.' };
      const [year, month, day] = value.split('-').map(Number) as [number, number, number];
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
      ) {
        return { error: 'Choose a valid date.' };
      }
      return { value };
    }
    case 'select': {
      if (typeof value !== 'string' || value.trim() === '') {
        return { error: 'Choose an option.' };
      }
      if (field.optionsSource === 'users') {
        const exists = db.prepare('SELECT 1 AS found FROM users WHERE id = ?').get(value);
        return exists ? { value } : { error: 'Choose an existing account.' };
      }
      const known = (field.options ?? []).some((option) => option.value === value);
      return known ? { value } : { error: 'Choose one of the available options.' };
    }
    case 'user': {
      if (typeof value !== 'string' || value.trim() === '') {
        return { error: 'Choose an existing account.' };
      }
      const exists = db.prepare('SELECT 1 AS found FROM users WHERE id = ?').get(value);
      return exists ? { value } : { error: 'Choose an existing account.' };
    }
    default:
      return { error: 'This field type is not supported.' };
  }
}

function runValidateHook(
  definition: AddonDefinition,
  context: {
    projectId: string;
    values: Record<string, AddonFieldValue>;
    mode: AddonMode;
  },
): AddonValidationIssue[] {
  if (!definition.hooks?.validate) return [];
  try {
    return definition.hooks.validate(context) ?? [];
  } catch (error) {
    console.error(`[kapo:addons] "${definition.identifier}" validate hook failed`, error);
    return [{ message: `${definition.name} could not validate this project. Try again.` }];
  }
}

function displayValue(db: BetterSqliteDatabase, field: AddonFieldDefinition, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (field.type === 'user' && typeof value === 'string') {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(value) as
      | { username: string }
      | undefined;
    return row?.username ?? 'Former member';
  }
  if (field.type === 'select' && typeof value === 'string') {
    return field.options?.find((option) => option.value === value)?.label ?? value;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export interface AddonValueWriteResult {
  identifier: string;
  values: Record<string, AddonFieldValue>;
  mode: AddonMode;
  available: boolean;
}

/**
 * PATCH /api/projects/:id/addons/:identifier — partial value merge.
 *
 * Core field-type checks run first, then the add-on's `validate` hook, then
 * the merge, audit events and FTS update in one transaction. Unknown add-on
 * identifiers and unknown field keys already stored are preserved.
 */
export function writeAddonValues(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  identifier: string,
  input: unknown,
): AddonValueWriteResult {
  const ctx = loadAccessContext(db, user);
  const row = requireProjectRow(db, projectId);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'This project is in Trash and is read-only.');
  }
  if (!canEditProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to change add-on values.');
  }
  const definition = getAddon(identifier);
  if (!definition) throw new DomainError(404, 'not_found', 'Add-on not found.');
  const resolved = resolveAddonConfig(db, projectId, identifier);
  if (!resolved.available) {
    throw new DomainError(
      403,
      'forbidden',
      'This add-on is not available for this project.',
    );
  }
  if (!isRecord(input)) {
    throw new DomainError(422, 'validation_failed', 'Provide add-on values.', {
      values: 'Provide at least one value.',
    });
  }

  const existing = parseProjectAddonValues(row.addon_data, identifier);
  const next: Record<string, AddonFieldValue> = { ...existing };
  const fields: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    const field = definition.fields.find((candidate) => candidate.key === key);
    if (!field) {
      fields[key] = 'This add-on does not define that field.';
      continue;
    }
    const result = fieldValueError(db, field, raw);
    if ('error' in result) {
      fields[key] = result.error;
      continue;
    }
    next[key] = result.value;
  }
  if (Object.keys(fields).length > 0) {
    throw new DomainError(422, 'validation_failed', 'Check the highlighted fields.', fields);
  }

  const issues = runValidateHook(definition, {
    projectId,
    values: next,
    mode: resolved.mode,
  });
  if (issues.length > 0) {
    const issueFields: Record<string, string> = {};
    for (const issue of issues) {
      if (issue.field) issueFields[issue.field] = issue.message;
    }
    throw new DomainError(
      422,
      'addon_validation',
      issues.map((issue) => issue.message).join(' ') || 'The add-on rejected these values.',
      Object.keys(issueFields).length > 0 ? issueFields : undefined,
    );
  }

  const changed: Array<{ field: AddonFieldDefinition; from: unknown; to: unknown }> = [];
  for (const [key, value] of Object.entries(next)) {
    const field = definition.fields.find((candidate) => candidate.key === key);
    if (!field) continue;
    if (existing[key] !== value) changed.push({ field, from: existing[key] ?? null, to: value });
  }

  if (changed.length > 0) {
    db.transaction(() => {
      const data = parseJsonObject(row.addon_data);
      data[identifier] = next;
      db.prepare('UPDATE projects SET addon_data = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(data),
        nowIso(),
        projectId,
      );
      for (const change of changed) {
        const detail = JSON.stringify({
          addon: identifier,
          field: change.field.key,
          from: change.from,
          to: change.to,
        });
        recordAuditEvent(db, {
          projectId,
          actor: user,
          action: AUDIT_ACTIONS.addonValueChanged,
          field: change.field.label,
          oldValue: displayValue(db, change.field, change.from),
          newValue: displayValue(db, change.field, change.to),
          detail,
        });
      }
      reindexProjectAddonSearch(db, projectId);
    })();
  }

  return {
    identifier,
    values: next,
    mode: resolved.mode,
    available: resolved.available,
  };
}

/* ------------------------------------------------------------------------- */
/* Search integration                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Rebuilds one project's FTS body from the add-ons that are effectively
 * available. Hidden/unavailable values never reach the index.
 */
export function reindexProjectAddonSearch(db: BetterSqliteDatabase, projectId: string): void {
  const row = db
    .prepare('SELECT title, addon_data FROM projects WHERE id = ?')
    .get(projectId) as { title: string; addon_data: string } | undefined;
  if (!row) return;
  const searchable: Record<string, readonly string[]> = {};
  for (const definition of listAddons()) {
    const fields = definition.searchFields ?? [];
    if (fields.length === 0) continue;
    const resolved = resolveAddonConfig(db, projectId, definition.identifier);
    if (!resolved.available) continue;
    searchable[definition.identifier] = fields;
  }
  const body = searchBodyFromAddonValues(parseJsonObject(row.addon_data), searchable);
  indexProject(db, { projectId, title: row.title, body });
}

export function reindexAllProjectAddonSearch(db: BetterSqliteDatabase): number {
  const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;
  for (const row of rows) reindexProjectAddonSearch(db, row.id);
  return rows.length;
}

/** Rebuilds the project and every descendant (config inheritance flows down). */
export function reindexProjectAddonSearchSubtree(
  db: BetterSqliteDatabase,
  projectId: string,
): number {
  const rows = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM projects WHERE id = ?
         UNION ALL
         SELECT p.id FROM projects p JOIN subtree s ON p.parent_id = s.id
       )
       SELECT id FROM subtree`,
    )
    .all(projectId) as Array<{ id: string }>;
  for (const row of rows) reindexProjectAddonSearch(db, row.id);
  return rows.length;
}
