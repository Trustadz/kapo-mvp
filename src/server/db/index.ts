export {
  closeDb,
  configureConnection,
  getDb,
  openDatabase,
  resetSingleton,
  type BetterSqliteDatabase,
  type OpenDatabaseOptions,
} from './connection';
export {
  currentMigrationNames,
  loadMigrations,
  runMigrations,
  type MigrationFile,
  type MigrationResult,
} from './migrate';
export { databasePath, migrationsDir, uploadDir } from './paths';
export {
  defaultUserDashboard,
  createRootProject,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CHILD_WORKFLOW,
  DEFAULT_PROJECT_SETTINGS,
  insertDefaultSettings,
  insertWorkflow,
  ROOT_WORKFLOW,
  TRASH_RETENTION_DAYS,
  type ProjectSettingsDefaults,
  type RootProject,
  type WorkflowStatusRow,
  type WorkflowStatusSeed,
} from './bootstrap';
export {
  getFavoriteProjects,
  getInstallationName,
  getRootProjectId,
  getShellData,
  type ShellData,
} from './shell-queries';
export {
  indexProject,
  removeProjectFromSearch,
  searchBodyFromAddonValues,
  type ProjectSearchDocument,
} from './search';
export { newId, nowIso, addDaysIso, parseJsonArray, parseJsonObject } from './util';
