import fs from 'node:fs';
import path from 'node:path';
import {
  closeDb,
  openDatabase,
  resetSingleton,
  type BetterSqliteDatabase,
} from '@/server/db';

/**
 * Test database harness.
 *
 * Every suite gets its own SQLite file under ./data (gitignored) plus a fresh
 * upload directory. DATABASE_PATH is pointed at the file *before* any module
 * lazily calls getDb(), so code that relies on the singleton (route handlers,
 * shell queries) also hits the test database. The real databases
 * (./data/kapo.db, ./data/projects.db, ./data/settings.db) are never touched.
 */

export interface TestDatabase {
  db: BetterSqliteDatabase;
  filename: string;
  uploadDir: string;
  cleanup(): void;
}

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data');

let sequence = 0;

function unlinkQuietly(target: string): void {
  try {
    fs.rmSync(target, { force: true });
  } catch {
    /* ignore */
  }
}

export interface CreateTestDatabaseOptions {
  /** Short label used in the generated filename, for debugging. */
  label?: string;
}

export function createTestDatabase(options: CreateTestDatabaseOptions = {}): TestDatabase {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  const label = (options.label ?? 'suite').replace(/[^a-z0-9-]+/gi, '-');
  const filename = path.join(
    TEST_DATA_DIR,
    `test-${label}-${process.pid}-${Date.now()}-${sequence++}.db`,
  );
  const uploadDir = `${filename}.uploads`;
  fs.mkdirSync(uploadDir, { recursive: true });

  // Close a connection left behind by a previous suite/process state before
  // repointing the singleton at the new file.
  closeDb();
  resetSingleton();
  process.env.DATABASE_PATH = filename;
  process.env.UPLOAD_DIR = uploadDir;
  // openDatabase() runs every migration before handing the connection out.
  const db = openDatabase({ filename, fresh: true });

  let cleaned = false;
  return {
    db,
    filename,
    uploadDir,
    cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      try {
        if (db.open) db.close();
      } catch {
        /* ignore */
      }
      // Close whatever connection the singleton opened for this suite.
      closeDb();
      resetSingleton();
      for (const suffix of ['', '-wal', '-shm']) unlinkQuietly(`${filename}${suffix}`);
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

/**
 * Replaces the singleton connection with the suite database. Useful after a
 * script (e.g. db:seed) has rewritten the same DATABASE_PATH file.
 */
export function reopenSingleton(): BetterSqliteDatabase {
  resetSingleton();
  closeDb();
  return openDatabase();
}
