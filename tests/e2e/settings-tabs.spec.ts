import { expect, test, type Page } from '@playwright/test';

/**
 * Copy-on-create project settings UI.
 *
 * Live layout/add-on inheritance is no longer editable, and a tab with local
 * edits asks before navigating away. This spec pins the removed controls and
 * the dirty-tab guard (cancel stays, discard navigates, clean/saved tabs do not
 * warn).
 */

const PASSWORD = 'kapo1234';

async function login(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function findProjectId(page: Page, title: string): Promise<string> {
  const response = await page.request.get(`/api/search?q=${encodeURIComponent(title)}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    results: Array<{ id: string; title: string }>;
  };
  const hit = payload.results.find((result) => result.title === title);
  if (!hit) throw new Error(`Project "${title}" not found in search results`);
  return hit.id;
}

test.describe('project settings copy-on-create', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
    // Keep the per-project enable control editable regardless of what an
    // earlier spec left in the shared seeded database.
    await page.request.put('/api/settings', {
      data: { addons: { assignee: { mode: 'optional' } } },
    });
  });

  test('removes the inheritance controls and guards unsaved tab changes', async ({ page }) => {
    const projectId = await findProjectId(page, 'Home improvement');

    await page.goto(`/p/${projectId}/settings?tab=general`);
    await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
    const title = page.locator('#settings-title');
    await expect(title).toBeVisible();
    // Duplicate live-inheritance controls are gone from General.
    await expect(page.getByText('Inherit layout from the parent project')).toHaveCount(0);
    await expect(page.locator('#settings-default-view')).toHaveCount(0);

    const original = await title.inputValue();
    const edited = `${original} edited`;
    await title.fill(edited);
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();

    // Cancel keeps the user on the dirty tab and preserves the edit.
    await page.getByRole('link', { name: 'Layout' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Discard unsaved changes?' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/tab=general/);
    await expect(page.locator('#settings-title')).toHaveValue(edited);

    // Confirming discards and navigates.
    await page.getByRole('link', { name: 'Layout' }).click();
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(/tab=layout/);
    await expect(page.getByRole('heading', { level: 1, name: 'Layout' })).toBeVisible();
    await expect(page.locator('#layout-inherit')).toHaveCount(0);
    await expect(page.getByText('Inherit layout from the parent project')).toHaveCount(0);
    // The kept controls still render.
    await expect(page.getByLabel('Default view')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Main area' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Enabled views' })).toBeVisible();

    await page.getByRole('link', { name: 'Add-ons' }).click();
    await expect(page).toHaveURL(/tab=addons/);
    await expect(page.getByText('Inherit from parent')).toHaveCount(0);
    await expect(page.locator('#addon-inherit-assignee')).toHaveCount(0);
    await expect(page.getByLabel('Enable for this project')).toBeVisible();
  });

  test('does not warn on a clean tab or after a successful save', async ({ page }) => {
    const projectId = await findProjectId(page, 'Home improvement');

    // Clean tab: no guard.
    await page.goto(`/p/${projectId}/settings?tab=general`);
    await page.getByRole('link', { name: 'Workflow' }).click();
    await expect(page).toHaveURL(/tab=workflow/);
    await expect(page.getByRole('heading', { name: 'Discard unsaved changes?' })).toHaveCount(0);

    // Dirty tab, save successfully: no guard afterwards.
    await page.getByRole('link', { name: 'General' }).click();
    const title = page.locator('#settings-title');
    const original = await title.inputValue();
    await title.fill(`${original} e2e`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-toast]')).toContainText('Project settings saved.');
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Workflow' }).click();
    await expect(page).toHaveURL(/tab=workflow/);
    await expect(page.getByRole('heading', { name: 'Discard unsaved changes?' })).toHaveCount(0);

    // Restore the shared fixture's title for other specs.
    await page.goto(`/p/${projectId}/settings?tab=general`);
    await page.locator('#settings-title').fill(original);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-toast]')).toContainText('Project settings saved.');
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  });
});
