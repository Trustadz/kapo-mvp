import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { AUDIT_ACTIONS, AUDIT_FIELDS } from '@/lib/audit';
import type {
  DescriptionCapabilitySettings,
  DescriptionFormatUsage,
  DescriptionProviderSummary,
  ProjectDescriptionData,
  ProjectDescriptionRecordView,
} from '@/lib/description';
import { listCapabilityProviders, type AddonDefinition } from '@/server/addons';
import { nowIso } from '@/server/db/util';
import { recordAuditEvent } from './audit';
import {
  DomainError,
  canEditProject,
  canReadProject,
  isTrashedProject,
  loadAccessContext,
  type AccessUser,
} from './permissions';
import { reindexProjectAddonSearch } from './project-addons';

/**
 * Core description capability (docs/add-on-platform.md §4).
 *
 * Core owns the durable record, permissions, retention and plaintext fallback.
 * The active add-on owns `body` and `format`; core never parses the rich body.
 * A record whose format the active provider cannot read is served as plaintext.
 */

export const DESCRIPTION_CAPABILITY = 'description';
export const MAX_DESCRIPTION_TEXT_LENGTH = 100_000;
/** Stored sentinel for an explicit "no description provider" Admin choice. */
const NONE_PROVIDER = '@none';
const MAX_MENTIONS = 50;

interface DescriptionRow {
  body: string;
  format: string;
  plaintext: string;
  updated_at: string;
}

function providerSummary(definition: AddonDefinition): DescriptionProviderSummary | null {
  const formats = definition.formats;
  if (!formats) return null;
  return {
    identifier: definition.identifier,
    name: definition.name,
    version: definition.version,
    reads: [...formats.reads],
    writes: [...formats.writes],
  };
}

/** All registered description providers, in registration order. */
export function listDescriptionProviders(): DescriptionProviderSummary[] {
  return listCapabilityProviders(DESCRIPTION_CAPABILITY)
    .map(providerSummary)
    .filter((provider): provider is DescriptionProviderSummary => provider !== null);
}

/**
 * The effective provider: the saved choice when it is still registered and
 * capable; otherwise the only registered provider when there is exactly one.
 * A saved choice pointing at a removed add-on resolves to null (plaintext).
 */
export function getActiveDescriptionProvider(
  db: BetterSqliteDatabase,
): DescriptionProviderSummary | null {
  const providers = listDescriptionProviders();
  if (providers.length === 0) return null;
  const row = db
    .prepare('SELECT provider FROM addon_capabilities WHERE capability = ?')
    .get(DESCRIPTION_CAPABILITY) as { provider: string } | undefined;
  if (row) {
    if (row.provider === NONE_PROVIDER) return null;
    return providers.find((provider) => provider.identifier === row.provider) ?? null;
  }
  return providers.length === 1 ? (providers[0] ?? null) : null;
}

function formatUsage(db: BetterSqliteDatabase): DescriptionFormatUsage[] {
  return db
    .prepare(
      `SELECT format, COUNT(*) AS count
         FROM project_descriptions
        GROUP BY format
        ORDER BY format ASC`,
    )
    .all() as DescriptionFormatUsage[];
}

export function getDescriptionCapabilitySettings(
  db: BetterSqliteDatabase,
): DescriptionCapabilitySettings {
  return {
    activeProvider: getActiveDescriptionProvider(db)?.identifier ?? null,
    providers: listDescriptionProviders(),
    formatsInUse: formatUsage(db),
  };
}

/** Admin choice for the exclusive description capability. */
export function setDescriptionProvider(
  db: BetterSqliteDatabase,
  provider: unknown,
): DescriptionCapabilitySettings {
  if (provider !== null && typeof provider !== 'string') {
    throw new DomainError(422, 'validation_failed', 'Choose a description provider.', {
      provider: 'Choose a registered description provider.',
    });
  }
  if (provider === null) {
    db.prepare(
      `INSERT INTO addon_capabilities (capability, provider, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(capability) DO UPDATE SET
         provider = excluded.provider,
         updated_at = excluded.updated_at`,
    ).run(DESCRIPTION_CAPABILITY, NONE_PROVIDER, nowIso());
    return getDescriptionCapabilitySettings(db);
  }
  const known = listDescriptionProviders().some((candidate) => candidate.identifier === provider);
  if (!known) {
    throw new DomainError(422, 'validation_failed', 'Choose a description provider.', {
      provider: 'This add-on is not a registered description provider.',
    });
  }
  db.prepare(
    `INSERT INTO addon_capabilities (capability, provider, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(capability) DO UPDATE SET
       provider = excluded.provider,
       updated_at = excluded.updated_at`,
  ).run(DESCRIPTION_CAPABILITY, provider, nowIso());
  return getDescriptionCapabilitySettings(db);
}

function readDescriptionRow(
  db: BetterSqliteDatabase,
  projectId: string,
): DescriptionRow | undefined {
  return db
    .prepare(
      `SELECT body, format, plaintext, updated_at
         FROM project_descriptions
        WHERE project_id = ?`,
    )
    .get(projectId) as DescriptionRow | undefined;
}

function toRecordView(row: DescriptionRow): ProjectDescriptionRecordView {
  return {
    body: row.body,
    format: row.format,
    plaintext: row.plaintext,
    updatedAt: row.updated_at,
  };
}

/** Page/API read model. `canEdit` comes from the caller's access context. */
export function getProjectDescriptionData(
  db: BetterSqliteDatabase,
  projectId: string,
  canEdit: boolean,
): ProjectDescriptionData {
  const provider = getActiveDescriptionProvider(db);
  const row = readDescriptionRow(db, projectId);
  const record = row ? toRecordView(row) : null;
  return {
    provider,
    record,
    canEdit,
    unsupportedFormat: record !== null && (provider === null || !provider.reads.includes(record.format)),
  };
}

/** API GET with permission handling. */
export function getProjectDescriptionForUser(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
): ProjectDescriptionData {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  const canEdit = canEditProject(ctx, projectId) && !isTrashedProject(ctx, projectId);
  return getProjectDescriptionData(db, projectId, canEdit);
}

export interface SaveDescriptionInput {
  body?: unknown;
  format?: unknown;
  plaintext?: unknown;
  metadata?: unknown;
  mentions?: unknown;
}

function textField(
  value: unknown,
  field: string,
  label: string,
  issues: Record<string, string>,
): string | null {
  if (typeof value !== 'string') {
    issues[field] = `Enter ${label}.`;
    return null;
  }
  if (value.length > MAX_DESCRIPTION_TEXT_LENGTH) {
    issues[field] = `Keep this under ${MAX_DESCRIPTION_TEXT_LENGTH} characters.`;
    return null;
  }
  return value;
}

function parseMentions(value: unknown, issues: Record<string, string>): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.mentions = 'Mentions must be a list.';
    return [];
  }
  if (value.length > MAX_MENTIONS) {
    issues.mentions = `Mention at most ${MAX_MENTIONS} people.`;
    return [];
  }
  const mentions: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      issues.mentions = 'Mentions must be user ids.';
      return [];
    }
    mentions.push(entry);
  }
  return [...new Set(mentions)];
}

/**
 * Save the description through the active provider. The provider supplies the
 * opaque body, its versioned format and the plaintext projection. Core validates
 * permissions and format compatibility, stores the record, audits it and
 * reindexes the plaintext.
 */
export function saveProjectDescription(
  db: BetterSqliteDatabase,
  user: AccessUser,
  projectId: string,
  input: SaveDescriptionInput,
): ProjectDescriptionData {
  const ctx = loadAccessContext(db, user);
  if (!canReadProject(ctx, projectId)) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  if (isTrashedProject(ctx, projectId)) {
    throw new DomainError(409, 'trashed_read_only', 'This project is in Trash and is read-only.');
  }
  if (!canEditProject(ctx, projectId)) {
    throw new DomainError(403, 'forbidden', 'You need edit access to change the description.');
  }

  const provider = getActiveDescriptionProvider(db);
  if (!provider) {
    throw new DomainError(
      409,
      'description_unavailable',
      'No description provider is active. An Admin can choose one in Application settings.',
    );
  }

  const issues: Record<string, string> = {};
  const body = textField(input.body, 'body', 'the description', issues);
  const plaintext = textField(input.plaintext, 'plaintext', 'the plain text', issues);
  let format: string | null = null;
  if (typeof input.format !== 'string' || input.format.trim() === '') {
    issues.format = 'Choose a valid description format.';
  } else if (!provider.writes.includes(input.format)) {
    issues.format = 'The active provider cannot write this format.';
  } else {
    format = input.format;
  }

  let metadata: Record<string, unknown> = {};
  if (input.metadata !== undefined) {
    if (
      typeof input.metadata !== 'object' ||
      input.metadata === null ||
      Array.isArray(input.metadata)
    ) {
      issues.metadata = 'Metadata must be a key/value object.';
    } else {
      metadata = input.metadata as Record<string, unknown>;
    }
  }
  const mentions = parseMentions(input.mentions, issues);

  if (Object.keys(issues).length > 0 || body === null || plaintext === null || format === null) {
    throw new DomainError(422, 'validation_failed', 'Check the description.', issues);
  }

  const existing = readDescriptionRow(db, projectId);
  const empty = body.trim() === '';
  const metadataJson = JSON.stringify(metadata);
  const mentionsJson = JSON.stringify(mentions);
  const unchanged =
    existing !== undefined &&
    !empty &&
    existing.body === body &&
    existing.format === format &&
    existing.plaintext === plaintext;
  if (unchanged) return getProjectDescriptionData(db, projectId, true);
  if (empty && !existing) return getProjectDescriptionData(db, projectId, true);

  const timestamp = nowIso();
  db.transaction(() => {
    if (empty) {
      if (existing) {
        db.prepare('DELETE FROM project_descriptions WHERE project_id = ?').run(projectId);
      }
      recordAuditEvent(db, {
        projectId,
        actor: user,
        action: AUDIT_ACTIONS.descriptionUpdated,
        field: AUDIT_FIELDS.description,
        detail: JSON.stringify({ removed: true }),
        createdAt: timestamp,
      });
    } else {
      db.prepare(
        `INSERT INTO project_descriptions
           (project_id, body, format, plaintext, metadata, mentions,
            created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           body = excluded.body,
           format = excluded.format,
           plaintext = excluded.plaintext,
           metadata = excluded.metadata,
           mentions = excluded.mentions,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).run(
        projectId,
        body,
        format,
        plaintext,
        metadataJson,
        mentionsJson,
        user.id,
        user.id,
        timestamp,
        timestamp,
      );
      recordAuditEvent(db, {
        projectId,
        actor: user,
        action: AUDIT_ACTIONS.descriptionUpdated,
        field: AUDIT_FIELDS.description,
        detail: JSON.stringify({ format, characters: plaintext.length }),
        createdAt: timestamp,
      });
    }
    reindexProjectAddonSearch(db, projectId);
  })();

  return getProjectDescriptionData(db, projectId, true);
}
