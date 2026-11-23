import { expect, test, type Page } from '@playwright/test';

/**
 * Focused project layout: children + project history with no Details or
 * Properties cards. Root uses it by default and drops its redundant
 * breadcrumb, title and Favorite while keeping the project actions menu.
 */

const PASSWORD = 'kapo1234';

async function login(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function rootHref(page: Page): Promise<string> {
  const href = await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Root', exact: true })
    .getAttribute('href');
  if (!href) throw new Error('Root navigation link not found');
  return href;
}

test.describe('focused project layout', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('Root shows only the child viewer and history, without title, breadcrumb or Favorite', async ({
    page,
  }) => {
    await page.goto(await rootHref(page));

    // The accessible heading stays in the document, but not on screen.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveClass(/visually-hidden/);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Favorite' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Project actions' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Details' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Properties' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Child projects' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  });

  test('a project can switch to children + history and back', async ({ page }) => {
    const href = await rootHref(page);
    const rootId = href.split('/').pop();
    const title = `Focused layout ${Date.now()}`;
    const created = await page.request.post('/api/projects', {
      data: { parentId: rootId, title },
    });
    expect(created.status()).toBe(201);
    const payload = (await created.json()) as { project: { id: string } };

    await page.goto(`/p/${payload.project.id}/settings?tab=layout`);
    await page.getByRole('radio', { name: 'Children and history only' }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-toast]')).toContainText('Layout settings saved.');

    await page.goto(`/p/${payload.project.id}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Details' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Properties' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Child projects' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();

    const stored = await page.request.get(`/api/projects/${payload.project.id}/settings`);
    const storedPayload = (await stored.json()) as { settings: { layout_mode: string | null } };
    expect(storedPayload.settings.layout_mode).toBe('children');

    await page.goto(`/p/${payload.project.id}/settings?tab=layout`);
    await page.getByRole('radio', { name: 'Details, properties and children' }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-toast]')).toContainText('Layout settings saved.');

    await page.goto(`/p/${payload.project.id}`);
    await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
  });
});
