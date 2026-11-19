/**
 * Dedicated server for the Playwright suite.
 *
 * 1. Recreates ./data/test-e2e.db (never ./data/kapo.db) and runs migrations so
 *    the first-install spec starts from a genuinely empty installation.
 * 2. Builds Next.js into .next-tests when needed (KAPO_E2E_BUILD=0 reuses an
 *    existing build, KAPO_E2E_REBUILD=1 forces one).
 * 3. Starts `next start` on port 3301 and proxies signals.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const distDir = process.env.NEXT_DIST_DIR?.trim() || '.next-tests';
const databasePath = process.env.DATABASE_PATH?.trim() || './data/test-e2e.db';
const port = process.env.PORT?.trim() || '3301';

const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_DIST_DIR: distDir,
  DATABASE_PATH: databasePath,
  UPLOAD_DIR: process.env.UPLOAD_DIR?.trim() || './data/test-e2e-uploads',
};

function absolute(target) {
  return path.isAbsolute(target) ? target : path.resolve(root, target);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// 1. Fresh, migrated database.
if (process.env.KAPO_E2E_RESET_DB !== '0') {
  const dbFile = absolute(databasePath);
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbFile}${suffix}`, { force: true });
  }
  fs.rmSync(absolute(env.UPLOAD_DIR), { recursive: true, force: true });
  console.log(`[e2e] reset ${dbFile}`);
  run('npx', ['tsx', 'scripts/migrate.ts']);
}

// 2. Build when the dist directory is missing.
const buildId = path.join(absolute(distDir), 'BUILD_ID');
const shouldBuild =
  process.env.KAPO_E2E_BUILD !== '0' &&
  (process.env.KAPO_E2E_BUILD === '1' || !fs.existsSync(buildId));
if (shouldBuild) {
  // `next build` rewrites tsconfig.json to add its dist types. Restore the
  // committed config afterwards so the build is side-effect free.
  const tsconfigPath = path.join(root, 'tsconfig.json');
  const tsconfigBefore = fs.readFileSync(tsconfigPath, 'utf8');
  console.log(`[e2e] building with NEXT_DIST_DIR=${distDir}`);
  run('npx', ['next', 'build']);
  if (fs.readFileSync(tsconfigPath, 'utf8') !== tsconfigBefore) {
    fs.writeFileSync(tsconfigPath, tsconfigBefore);
    console.log('[e2e] restored tsconfig.json after build');
  }
} else {
  console.log(`[e2e] reusing build in ${distDir}`);
}

// 3. Serve.
const child = spawn('npx', ['next', 'start', '-p', port], {
  cwd: root,
  stdio: 'inherit',
  env,
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
