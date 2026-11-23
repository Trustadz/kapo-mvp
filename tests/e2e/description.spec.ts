import { expect, test, type Page } from '@playwright/test';

/**
 * Description capability journey (docs/add-on-platform.md §4):
 * Markdown provider, core-owned record, plaintext fallback and provider switch.
 */

const PASSWORD = 'kapo1234';

test.describe.configure({ mode: 'serial' });

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

async function selectProvider(page: Page, label: string): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Add-ons' }).click();
  const card = page.getByRole('region', { name: 'Description provider' });
  await expect(card).toBeVisible();
  await card.getByLabel('Active provider').selectOption({ label });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/settings') && response.request().method() === 'PUT',
  );
  await card.getByRole('button', { name: 'Save changes' }).click();
  await saved;
  await page.waitForLoadState('networkidle');
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, 'admin');
  const projectId = await findProjectId(page, 'Home improvement');
  await page.request.put('/api/settings', {
    data: { capabilities: { description: 'description-markdown' } },
  });
  await page.request.patch(`/api/projects/${projectId}/description`, {
    data: { body: '', format: 'markdown@1', plaintext: '' },
  });
  await page.close();
});

test('writes, searches, falls back and restores a description', async ({ page }) => {
  await login(page, 'admin');
  const projectId = await findProjectId(page, 'Home improvement');
  await page.goto(`/p/${projectId}`);

  await expect(page.getByRole('heading', { level: 2, name: 'Description' })).toBeVisible();
  await expect(page.getByText('No description yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add description' }).click();

  const editor = page.getByRole('textbox', { name: 'Description' });
  await editor.fill('**Plankton** notes for the basement');
  await page.getByRole('button', { name: 'Save description' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Description saved.' })).toBeVisible();
  await expect(page.locator('strong').filter({ hasText: 'Plankton' })).toBeVisible();

  const search = await page.request.get('/api/search?q=Plankton');
  const searchPayload = (await search.json()) as {
    results: Array<{ id: string; match: { field: string } }>;
  };
  expect(searchPayload.results).toEqual([
    expect.objectContaining({ id: projectId, match: expect.objectContaining({ field: 'Text' }) }),
  ]);

  await page.reload();
  await expect(page.locator('strong').filter({ hasText: 'Plankton' })).toBeVisible();

  await selectProvider(page, 'No provider (plain text only)');
  await page.goto(`/p/${projectId}`);
  await expect(
    page.getByText('No description provider is active. Showing plain text.'),
  ).toBeVisible();
  await expect(page.getByText('Plankton notes for the basement')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit description' })).toHaveCount(0);

  await selectProvider(page, 'Markdown description');
  await page.goto(`/p/${projectId}`);
  await expect(page.locator('strong').filter({ hasText: 'Plankton' })).toBeVisible();
});
