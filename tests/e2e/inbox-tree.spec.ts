import { expect, test } from '@playwright/test';

/**
 * Inbox application-wide Tree (issue #54).
 *
 * The Tree is no longer a flat list of captures: it shows every readable project
 * nested by parent in global priority order. Inbox rows stay highlighted and
 * actionable; all other rows are read-only context. Runs against the seeded
 * installation from `first-install`.
 */

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'kapo1234';

async function login(page: import('@playwright/test').Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function capture(page: import('@playwright/test').Page, title: string): Promise<void> {
  const input = page.getByRole('textbox', { name: /add a project to root/i });
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('status')).toContainText(`Added "${title}" to Inbox.`);
}

async function findProjectId(
  page: import('@playwright/test').Page,
  title: string,
): Promise<string> {
  const response = await page.request.get(`/api/search?q=${encodeURIComponent(title)}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    results: Array<{ id: string; title: string }>;
  };
  const hit = payload.results.find((result) => result.title === title);
  if (!hit) throw new Error(`Project "${title}" not found in search results`);
  return hit.id;
}

test.describe('Inbox application tree', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('nests readable projects and keeps non-Inbox rows read-only', async ({ page }) => {
    await page.goto('/inbox');
    await page.getByRole('button', { name: 'Tree' }).click();

    const tree = page.getByRole('region', { name: 'Application tree' });
    await expect(tree).toBeVisible();
    await expect(tree.getByRole('table', { name: 'Application projects' })).toBeVisible();

    const homeRow = tree.getByRole('row', { name: /Home improvement/ });
    const renovateRow = tree.getByRole('row', { name: /Renovate basement/ });
    const householdRow = tree.getByRole('row', { name: /Household/ });

    await expect(homeRow).toBeVisible();
    await expect(householdRow).toBeVisible();
    // Renovate basement is an Inbox capture nested under Home improvement.
    await expect(renovateRow).toBeVisible();
    await expect(renovateRow.getByRole('checkbox')).toBeVisible();
    // The non-Inbox parent keeps its title link but no checkbox or Open action.
    await expect(homeRow.getByRole('checkbox')).toHaveCount(0);
    await expect(homeRow.getByRole('link', { name: 'Home improvement' })).toBeVisible();
    await expect(homeRow.getByRole('link', { name: 'Open Home improvement' })).toHaveCount(0);
  });

  test('selects only Inbox rows and bulk releases them together', async ({ page }) => {
    const stamp = Date.now();
    const first = `E2E tree first ${stamp}`;
    const second = `E2E tree second ${stamp}`;
    await capture(page, first);
    await capture(page, second);

    await page.goto('/inbox');
    await page.getByRole('button', { name: 'Tree' }).click();
    const tree = page.getByRole('region', { name: 'Application tree' });

    const firstRow = tree.getByRole('row', { name: new RegExp(first) });
    const secondRow = tree.getByRole('row', { name: new RegExp(second) });
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();

    await firstRow.getByRole('checkbox').check();
    await secondRow.getByRole('checkbox').check();
    await expect(tree.getByText('2 selected')).toBeVisible();
    await tree.getByRole('button', { name: 'Release selected' }).click();

    await expect(firstRow.getByText('Pulled')).toBeVisible();
    await expect(secondRow.getByText('Pulled')).toBeVisible();

    // Released captures leave the Inbox in the database.
    for (const title of [first, second]) {
      const projectId = await findProjectId(page, title);
      const response = await page.request.get(`/api/projects/${projectId}`);
      const payload = (await response.json()) as { project: { inbox: boolean } };
      expect(payload.project.inbox).toBe(false);
    }
  });

  test('expands and collapses every branch', async ({ page }) => {
    await page.goto('/inbox');
    await page.getByRole('button', { name: 'Tree' }).click();
    const tree = page.getByRole('region', { name: 'Application tree' });
    const renovateRow = tree.getByRole('row', { name: /Renovate basement/ });

    // Expanded by default.
    await expect(renovateRow).toBeVisible();
    await tree.getByRole('button', { name: 'Collapse Home improvement' }).click();
    await expect(renovateRow).toHaveCount(0);
    await tree.getByRole('button', { name: 'Expand Home improvement' }).click();
    await expect(renovateRow).toBeVisible();
  });

  test('keeps the Card | Tree switcher and shows the application tree', async ({ page }) => {
    // The switcher is no longer conditional on Inbox items: Tree must always be
    // reachable, including when a viewer has no captures of their own.
    await page.goto('/inbox');
    const switcher = page.getByRole('group', { name: 'Inbox view' });
    await expect(switcher).toBeVisible();
    await page.getByRole('button', { name: 'Tree' }).click();
    const tree = page.getByRole('region', { name: 'Application tree' });
    await expect(tree).toBeVisible();
    await expect(tree.getByRole('row', { name: /Root/ })).toBeVisible();
  });
});
