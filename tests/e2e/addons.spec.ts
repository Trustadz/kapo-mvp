import { expect, test, type Page } from '@playwright/test';

/**
 * Focused Assignee add-on journey (issue #7, docs/add-ons.md §12).
 *
 * Exercises the generic plumbing only: application mode, per-project
 * enablement, the add-on value editor, persistence, activity integration and
 * retention while the add-on is unavailable. No core code knows the identifier.
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

async function userId(page: Page, username: string): Promise<string> {
  const response = await page.request.get('/api/users');
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    users: Array<{ id: string; username: string }>;
  };
  const hit = payload.users.find((user) => user.username === username);
  if (!hit) throw new Error(`User "${username}" not found`);
  return hit.id;
}

async function setAddonMode(page: Page, mode: 'Available' | 'Unavailable'): Promise<void> {
  await page.goto('/settings');
  const group = page.getByRole('group', { name: /Assignee/i });
  await expect(group).toBeVisible();
  await group.getByRole('radio', { name: new RegExp(`^${mode}`) }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Application settings saved.');
}

test.describe('Assignee add-on', () => {
  test('enables per project, saves, persists and keeps values when unavailable', async ({
    page,
  }) => {
    await login(page, 'admin');
    const projectId = await findProjectId(page, 'Home improvement');
    const mayaId = await userId(page, 'maya');

    // Optional mode: enable the add-on for this project in project settings.
    await page.goto(`/p/${projectId}/settings?tab=addons`);
    await expect(page.getByRole('heading', { level: 1, name: 'Add-ons' })).toBeVisible();
    await page.getByLabel('Enable for this project').check();
    await page.getByRole('button', { name: 'Save add-ons' }).click();
    await expect(page.getByRole('status')).toContainText('Project add-ons saved.');

    // The project page now renders the generic add-on editor.
    await page.goto(`/p/${projectId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Add-ons' })).toBeVisible();
    await page.getByLabel('Assignee').selectOption({ label: 'maya' });
    await page.getByRole('button', { name: 'Save Assignee' }).click();
    await expect(page.getByRole('status')).toContainText('Add-on saved.');

    // Persisted after a full reload, and visible in Activity.
    await page.reload();
    await expect(page.getByLabel('Assignee')).toHaveValue(mayaId);
    await expect(page.getByText('updated the Assignee')).toBeVisible();

    // Unavailable hides the editor but keeps the value.
    await setAddonMode(page, 'Unavailable');
    await page.goto(`/p/${projectId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Add-ons' })).toHaveCount(0);

    // Available again: the stored assignee reappears without re-saving.
    await setAddonMode(page, 'Available');
    await page.goto(`/p/${projectId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Add-ons' })).toBeVisible();
    await expect(page.getByLabel('Assignee')).toHaveValue(mayaId);
  });
});
