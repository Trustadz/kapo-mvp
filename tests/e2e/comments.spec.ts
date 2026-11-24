import { expect, test, type Page } from '@playwright/test';

/**
 * Basic comments PoC: tabs beside History, bold/italic/underline/strikethrough,
 * no replies or mentions.
 */

const PASSWORD = 'kapo1234';

test.describe.configure({ mode: 'serial' });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
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

test('posts a formatted comment and switches between comments and history', async ({ page }) => {
  await login(page);
  const projectId = await findProjectId(page, 'Home improvement');
  await page.goto(`/p/${projectId}`);

  const commentsTab = page.getByRole('tab', { name: 'Comments' });
  const historyTab = page.getByRole('tab', { name: 'History' });
  await expect(commentsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Add a comment' }).fill(
    '**Bold** *italic* __under__ ~~gone~~',
  );
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Comment posted.' })).toBeVisible();

  await expect(page.locator('strong').filter({ hasText: 'Bold' })).toBeVisible();
  await expect(page.locator('em').filter({ hasText: 'italic' })).toBeVisible();
  await expect(page.locator('u').filter({ hasText: 'under' })).toBeVisible();
  await expect(page.locator('del').filter({ hasText: 'gone' })).toBeVisible();

  await page.reload();
  await expect(page.locator('strong').filter({ hasText: 'Bold' })).toBeVisible();

  await historyTab.click();
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

  await commentsTab.click();
  await expect(page.locator('strong').filter({ hasText: 'Bold' })).toBeVisible();
});
