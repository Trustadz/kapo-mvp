import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves runtime paths for the SQLite database and migrations.
 *
 * In a Next.js standalone container the source tree is not shipped, so the
 * Dockerfile copies migrations to /app/migrations and sets
 * KAPO_MIGRATIONS_DIR. For local development the repository path is used.
 */

export function databasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), 'data', 'kapo.db');
}

export function uploadDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), 'upload');
}

function hasSqlFiles(dir: string): boolean {
  try {
    return fs.readdirSync(/* turbopackIgnore: true */ dir).some((entry) => entry.endsWith('.sql'));
  } catch {
    return false;
  }
}

export function migrationsDir(): string {
  const configured = process.env.KAPO_MIGRATIONS_DIR?.trim();
  const candidates = [
    configured,
    path.resolve(process.cwd(), 'src', 'server', 'db', 'migrations'),
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), '..', 'migrations'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (hasSqlFiles(candidate)) return candidate;
  }

  throw new Error(
    `No migration directory found. Looked in: ${candidates.join(', ')}. ` +
      'Set KAPO_MIGRATIONS_DIR to the directory containing the .sql migrations.',
  );
}
