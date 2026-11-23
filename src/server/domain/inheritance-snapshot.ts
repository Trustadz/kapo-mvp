import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  DEFAULT_LAYOUT_TEMPLATE,
  type ProjectLayoutTemplate,
} from '@/lib/projects';
import { parseJsonObject } from '@/server/db/util';
import { listPropertyAddons } from '@/server/addons';
import { parseProjectSettings } from './projects';
import {
  reindexAllProjectAddonSearch,
  resolveLegacyProjectAddons,
} from './project-addons';

/**
 * One-time upgrade snapshot for layout and add-on configuration.
 *
 * Before this change a project without its own layout template / add-on config
 * resolved those values live from its parent chain. That is no longer the
 * product behaviour: configuration is copied from the parent once at creation.
 * Existing databases therefore need one upgrade pass that writes each
 * project's *pre-upgrade effective* layout and add-on configuration into the
 * project's own row, so nothing visibly changes.
 *
 * The pass is idempotent and guarded by an application setting. Everything is
 * computed from the old state before any row is written (a parent's snapshot
 * must not change what its child saw), and the writes plus the marker commit in
 * one transaction. A failure therefore leaves both the data and the marker
 * untouched, so startup can retry on the next boot.
 */

export const INHERITANCE_SNAPSHOT_SETTING_KEY = 'inheritance_snapshot_v1';

export interface InheritanceSnapshotResult {
  /** True when the marker already existed; nothing was written. */
  alreadySnapshotted: boolean;
  /** Number of projects whose settings were made explicit. */
  projects: number;
  /** Number of registered add-ons snapshotted on each project. */
  addons: number;
}

interface SnapshotRow {
  id: string;
  parent_id: string | null;
  settings: string;
}

interface PreparedSnapshot {
  id: string;
  settings: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasSnapshotMarker(db: BetterSqliteDatabase): boolean {
  const row = db
    .prepare('SELECT 1 AS found FROM settings WHERE key = ?')
    .get(INHERITANCE_SNAPSHOT_SETTING_KEY) as { found: number } | undefined;
  return row !== undefined;
}

/**
 * Exact equivalent of the retired `effectiveLayoutTemplate` read path: a child
 * that still inherited used its parent's own stored template when the parent
 * had one, else its own template, else the default.
 */
function legacyEffectiveLayout(
  settings: ReturnType<typeof parseProjectSettings>,
  parentSettings: ReturnType<typeof parseProjectSettings> | null,
): ProjectLayoutTemplate {
  if (settings.inherit_layout && parentSettings?.layout_template) {
    return parentSettings.layout_template;
  }
  return settings.layout_template ?? DEFAULT_LAYOUT_TEMPLATE;
}

function prepareSnapshots(db: BetterSqliteDatabase): PreparedSnapshot[] {
  const rows = db
    .prepare('SELECT id, parent_id, settings FROM projects ORDER BY seq ASC')
    .all() as SnapshotRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parsed = new Map(
    rows.map((row) => [row.id, parseProjectSettings(row.settings)]),
  );
  const resolvedAddons = new Map(
    rows.map((row) => [row.id, resolveLegacyProjectAddons(db, row.id)]),
  );

  return rows.map((row) => {
    const raw = parseJsonObject(row.settings);
    const settings = parsed.get(row.id)!;
    const parent = row.parent_id ? byId.get(row.parent_id) ?? null : null;
    const layout = legacyEffectiveLayout(
      settings,
      parent ? parsed.get(parent.id)! : null,
    );

    const existingAddons = isRecord(raw.addons)
      ? (raw.addons as Record<string, unknown>)
      : {};
    const nextAddons: Record<string, unknown> = { ...existingAddons };
    const resolved = resolvedAddons.get(row.id) ?? [];
    for (const config of resolved) {
      const existing = isRecord(nextAddons[config.identifier])
        ? (nextAddons[config.identifier] as Record<string, unknown>)
        : {};
      // Preserve unknown entry keys (e.g. legacy add-on options) while making
      // availability/settings explicit and pinning inheritance off.
      nextAddons[config.identifier] = {
        ...existing,
        enabled: config.available,
        inheritFromParent: false,
        settings: { ...config.settings },
      };
    }

    raw.layout_template = layout;
    raw.inherit_layout = false;
    if (Object.keys(existingAddons).length > 0 || resolved.length > 0) {
      raw.addons = nextAddons;
    }

    return { id: row.id, settings: raw };
  });
}

/**
 * Applies the one-time snapshot. Safe to call from every startup/CLI entry
 * point: once the marker exists this is a single indexed read and a no-op.
 *
 * Throws on any write failure after rolling the transaction back; callers that
 * must not take the process down (startup) log and continue, leaving the
 * marker unset for a later retry.
 */
export function snapshotInheritanceOnce(
  db: BetterSqliteDatabase,
): InheritanceSnapshotResult {
  if (hasSnapshotMarker(db)) {
    return { alreadySnapshotted: true, projects: 0, addons: 0 };
  }

  const prepared = prepareSnapshots(db);
  const registeredAddons = listPropertyAddons().length;

  db.transaction(() => {
    const update = db.prepare('UPDATE projects SET settings = ? WHERE id = ?');
    for (const entry of prepared) {
      update.run(JSON.stringify(entry.settings), entry.id);
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(INHERITANCE_SNAPSHOT_SETTING_KEY);
    // Startup may already have rebuilt FTS with the new own-only resolver
    // before this snapshot ran; rebuild it again so the now-explicit
    // availability produces exactly the pre-upgrade searchable text.
    reindexAllProjectAddonSearch(db);
  })();

  return {
    alreadySnapshotted: false,
    projects: prepared.length,
    addons: registeredAddons,
  };
}
