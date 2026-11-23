import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

/**
 * Playwright end-to-end configuration.
 *
 * The suite runs against a real `next start` build on port 3301 with an
 * isolated SQLite file (./data/test-e2e.db) and an isolated dist directory
 * (.next-tests). The dev database ./data/kapo.db is never opened.
 * `KAPO_E2E_PORT` and `KAPO_E2E_DATABASE` override the port and file so
 * parallel worktrees never collide.
 *
 * Chromium is installed into a writable cache inside the workspace:
 *   PLAYWRIGHT_BROWSERS_PATH=./data/pw-browsers npx playwright install chromium
 * `PLAYWRIGHT_BROWSERS_PATH` is defaulted below (workspace cache first, then the
 * /tmp cache used by CI) so `npm run test:e2e` works after that install. If no
 * browser can be installed, the suite cannot run in this environment; the
 * config still loads so `npx playwright test --list` works.
 */

const WORKSPACE_BROWSERS_PATH = './data/pw-browsers';
const TMP_BROWSERS_PATH = '/tmp/pw-browsers';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = fs.existsSync(WORKSPACE_BROWSERS_PATH)
    ? WORKSPACE_BROWSERS_PATH
    : TMP_BROWSERS_PATH;
}

// Overridable so several worktrees can run the suite at the same time without
// sharing a port or a database file. Defaults match the single-checkout setup.
export const TEST_PORT = Number(process.env.KAPO_E2E_PORT ?? 3301);
export const TEST_DATABASE_PATH =
  process.env.KAPO_E2E_DATABASE ?? './data/test-e2e.db';
export const TEST_DIST_DIR = '.next-tests';
const MOCK_OIDC_PORT = Number(process.env.KAPO_E2E_MOCK_OIDC_PORT ?? 3402);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      command: 'npx tsx tests/e2e/mock-oidc-server.ts',
      url: `http://127.0.0.1:${MOCK_OIDC_PORT}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        MOCK_OIDC_PORT: String(MOCK_OIDC_PORT),
      },
    },
    {
      command: 'node tests/e2e/start-server.mjs',
      url: `http://127.0.0.1:${TEST_PORT}/healthz`,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_PATH: TEST_DATABASE_PATH,
        UPLOAD_DIR: './data/test-e2e-uploads',
        NEXT_DIST_DIR: TEST_DIST_DIR,
        PORT: String(TEST_PORT),
        KAPO_E2E_RESET_DB: '1',
        KAPO_E2E_BUILD: process.env.KAPO_E2E_BUILD ?? 'auto',
        KAPO_PUBLIC_URL: `http://127.0.0.1:${TEST_PORT}`,
        KAPO_OIDC_ISSUER: `http://localhost:${MOCK_OIDC_PORT}`,
        KAPO_OIDC_CLIENT_ID: 'kapo-e2e',
        KAPO_OIDC_CLIENT_SECRET: 'e2e-secret',
        KAPO_OIDC_PROVIDER_NAME: 'PocketID',
        KAPO_OIDC_ALLOW_INSECURE: '1',
      },
    },
  ],
  projects: [
    {
      name: 'first-install',
      testMatch: /first-install\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'desktop',
      testMatch:
        /(app|login|motion|views-reorder|project-filters|kanban-placeholder|project-layout-mode|inbox-tree|inbox-drag|a11y-keyboard|a11y-labels|contrast|drag-free|i18n|addons|description|settings-tabs|application-settings-tabs|mcp|sso|notifications)\.spec\.ts/,
      dependencies: ['first-install'],
      // Drag/reorder specs should measure stable rects; the motion spec opts
      // back into animation explicitly.
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'mobile',
      testMatch: /mobile(-favorites|-kanban-drag|-touch-dnd)?\.spec\.ts/,
      dependencies: ['first-install'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        reducedMotion: 'reduce',
      },
    },
  ],
});
