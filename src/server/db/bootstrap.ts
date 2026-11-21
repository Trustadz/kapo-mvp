import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { DEFAULT_DASHBOARD } from '../../lib/types';
import { indexProject } from './search';
import { newId, nowIso } from './util';

/** Bootstrap defaults shared by /api/setup and the seed script. */

export const TRASH_RETENTION_DAYS = 30;
export const MIN_TRASH_RETENTION_DAYS = 1;
export const MAX_TRASH_RETENTION_DAYS = 365;
export const DEFAULT_TRASH_PURGE_ENABLED = true;

/** Rolling database/uploads backups (Admin settings, issue #13). */
export const DEFAULT_BACKUP_ENABLED = true;
export const DEFAULT_BACKUP_START_TIME = '02:00';
export const DEFAULT_BACKUP_RETENTION = 3;
export const MIN_BACKUP_RETENTION = 1;
export const MAX_BACKUP_RETENTION = 30;

export interface AppSettingDefault {
  key: string;
  value: string;
}

export const DEFAULT_APP_SETTINGS: AppSettingDefault[] = [
  { key: 'default_account_role', value: 'user' },
  { key: 'enabled_views', value: JSON.stringify(['kanban', 'card', 'tree', 'list']) },
  { key: 'trash_retention_days', value: String(TRASH_RETENTION_DAYS) },
  { key: 'trash_purge_enabled', value: DEFAULT_TRASH_PURGE_ENABLED ? '1' : '0' },
  { key: 'installation_name', value: 'Kapo' },
  { key: 'backup_enabled', value: DEFAULT_BACKUP_ENABLED ? '1' : '0' },
  { key: 'backup_start_time', value: DEFAULT_BACKUP_START_TIME },
  { key: 'backup_retention', value: String(DEFAULT_BACKUP_RETENTION) },
];

export interface ProjectSettingsDefaults {
  access: 'inherit' | 'custom';
  inherit_layout: boolean;
  child_position: 'below' | 'above';
  default_view: 'kanban' | 'card' | 'tree' | 'list';
  enabled_views: string[];
  hidden_statuses: string[];
  skip_inbox: boolean;
  layout_template: null;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettingsDefaults = {
  access: 'inherit',
  // Layout and add-on configuration are copied from the parent once at
  // creation, so new rows always start explicit. Legacy rows that still have
  // `inherit_layout` absent/true are converted by the one-time inheritance
  // snapshot at startup.
  inherit_layout: false,
  child_position: 'below',
  default_view: 'kanban',
  enabled_views: ['kanban', 'card', 'tree', 'list'],
  hidden_statuses: [],
  skip_inbox: false,
  layout_template: null,
};

export function defaultUserDashboard(): string {
  return JSON.stringify(DEFAULT_DASHBOARD);
}

export function insertDefaultSettings(db: BetterSqliteDatabase): void {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const setting of DEFAULT_APP_SETTINGS) {
    insert.run(setting.key, setting.value);
  }
}

export interface WorkflowStatusSeed {
  name: string;
  isStart?: boolean;
  isFinish?: boolean;
}

/** Root workflow from build-spec §10. New workflows default to To do / Done. */
export const ROOT_WORKFLOW: WorkflowStatusSeed[] = [
  { name: 'To do', isStart: true },
  { name: 'In progress' },
  { name: 'Done', isFinish: true },
];

export const DEFAULT_CHILD_WORKFLOW: WorkflowStatusSeed[] = [
  { name: 'To do', isStart: true },
  { name: 'Done', isFinish: true },
];

export interface WorkflowStatusRow {
  id: string;
  parentId: string;
  name: string;
  position: number;
  isStart: boolean;
  isFinish: boolean;
}

export function insertWorkflow(
  db: BetterSqliteDatabase,
  parentId: string,
  statuses: WorkflowStatusSeed[],
): WorkflowStatusRow[] {
  const rows: WorkflowStatusRow[] = [];
  const insert = db.prepare(
    `INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  statuses.forEach((status, position) => {
    const row: WorkflowStatusRow = {
      id: newId(),
      parentId,
      name: status.name,
      position,
      isStart: status.isStart === true,
      isFinish: status.isFinish === true,
    };
    insert.run(
      row.id,
      row.parentId,
      row.name,
      row.position,
      row.isStart ? 1 : 0,
      row.isFinish ? 1 : 0,
    );
    rows.push(row);
  });
  return rows;
}

export interface RootProject {
  id: string;
  seq: number;
  statuses: WorkflowStatusRow[];
}

/**
 * Creates the single Root project plus its child workflow. Used by first-run
 * setup and by the seed script; the database trigger prevents a second Root.
 */
export function createRootProject(
  db: BetterSqliteDatabase,
  createdBy: string,
  createdAt: string = nowIso(),
): RootProject {
  const existing = db
    .prepare('SELECT id FROM projects WHERE parent_id IS NULL LIMIT 1')
    .get() as { id: string } | undefined;
  if (existing) {
    throw new Error('Root project already exists');
  }

  const lastSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM projects').get() as {
    seq: number;
  };
  const rootId = newId();
  db.prepare(
    `INSERT INTO projects (
       id, seq, title, reporter_id, parent_id, status_id, priority, inbox, archived,
       trashed_at, trash_action_id, purge_deadline, addon_data, settings,
       created_by, created_at, updated_at
     ) VALUES (?, ?, 'Root', ?, NULL, NULL, 0, 0, 0, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
  ).run(
    rootId,
    lastSeq.seq + 1,
    createdBy,
    JSON.stringify({ ...DEFAULT_PROJECT_SETTINGS, access: 'custom' }),
    createdBy,
    createdAt,
    createdAt,
  );

  const statuses = insertWorkflow(db, rootId, ROOT_WORKFLOW);
  indexProject(db, { projectId: rootId, title: 'Root', body: '' });
  return { id: rootId, seq: lastSeq.seq + 1, statuses };
}
