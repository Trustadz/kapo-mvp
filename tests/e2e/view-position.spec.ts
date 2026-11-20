import { expect, test, type Page } from '@playwright/test';

/**
 * Project view position: the collection view/child-project area can be moved
 * above or below the Details + Properties cards from the Project actions menu.
 * The same per-project setting is also editable under Project settings.
 */

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1100 } });

const PASSWORD = 'kapo1234';
const HOME = 'Home improvement';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function homeId(page: Page): Promise<string> {
  const response = await page.request.get(`/api/search?q=${encodeURIComponent(HOME)}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    results: Array<{ id: string; title: string }>;
  };
  const hit = payload.results.find((result) => result.title === HOME);
  if (!hit) throw new Error('Home improvement not found');
  return hit.id;
}

test.afterEach(async ({ page }) => {
  // Never leave the shared seeded project above Details for other specs.
  const id = await homeId(page);
  await page.request.put(`/api/projects/${id}/settings`, {
    data: { child_position: 'below' },
  });
});

test('moves the project view above and below details from Project actions', async ({ page }) => {
  await login(page);
  const id = await homeId(page);
  // Other specs may have changed this shared seeded project's layout.
  await page.request.put(`/api/projects/${id}/settings`, {
    data: { child_position: 'below' },
  });
  await page.goto(`/p/${id}`);

  const view = page.locator('section[aria-label="Child projects"]');
  const details = page.locator('section[aria-labelledby="details-heading"]');
  await expect(view).toBeVisible();
  await expect(details).toBeVisible();

  const y = async (locator: typeof view) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Element is not visible');
    return box.y;
  };

  expect(await y(view)).toBeGreaterThan(await y(details));

  const viewIs = async (position: 'above' | 'below') => {
    const [viewBox, detailsBox] = await Promise.all([
      view.boundingBox(),
      details.boundingBox(),
    ]);
    if (!viewBox || !detailsBox) return false;
    return position === 'above' ? viewBox.y < detailsBox.y : viewBox.y > detailsBox.y;
  };

  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Move view above details' }).click();
  await expect(page.getByText('View moved above details and properties.')).toBeVisible();
  await expect.poll(() => viewIs('above')).toBe(true);

  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Move view below details' }).click();
  await expect(page.getByText('View moved below details and properties.')).toBeVisible();
  await expect.poll(() => viewIs('below')).toBe(true);
});
