import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * First-install e2e (build-spec §1, §4, §10; product.md §12 scenario 0/1).
 *
 * Runs against a genuinely empty database (start-server.mjs recreates and
 * migrates it). Once this file finishes it seeds the documented mock household
 * so the dependent `desktop` and `mobile` projects have users to sign in with.
 */

const ROOT = process.cwd();
const DATABASE_PATH = './data/test-e2e.db';

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  const output = execFileSync('npm', ['run', 'db:seed'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_PATH: path.resolve(ROOT, DATABASE_PATH) },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  expect(output).toContain('Kapo seed complete');
});

test.describe('first install', () => {
  test('an empty installation redirects to the Create account screen', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirm password')).toBeVisible();

    // /login has nothing to sign in to yet, so it also routes to /setup.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/setup$/);
  });

  test('validation blocks an invalid Create account form', async ({ page }) => {
    await page.goto('/setup');
    await page.getByLabel('Username').fill('a');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('mismatch');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Username must be at least 3 characters.')).toBeVisible();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    await expect(page).toHaveURL(/\/setup$/);
  });

  test('creating the first Admin signs in and lands on the application shell', async ({ page }) => {
    await page.goto('/setup');
    await page.getByLabel('Username').fill('firstadmin');
    await page.getByLabel('Email').fill('firstadmin@example.com');
    await page.getByLabel('Password', { exact: true }).fill('first-pass-1');
    await page.getByLabel('Confirm password').fill('first-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();

    await page.waitForURL((url) => !url.pathname.startsWith('/setup'));
    await expect(page).not.toHaveURL(/\/setup$/);

    // The cookie is httpOnly and the shell renders for the new Admin.
    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === 'kapo_session');
    expect(session?.httpOnly).toBe(true);
    expect(session?.value).toBeTruthy();
    await expect(page.getByRole('textbox', { name: /add a project to root/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('the setup screen is no longer reachable once an account exists', async ({ page }) => {
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('signing out returns to the login screen', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('firstadmin');
    await page.getByLabel('Password').fill('first-pass-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    // Desktop sidebar account block shows the username as its accessible name.
    await page.getByRole('button', { name: /firstadmin/i }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
