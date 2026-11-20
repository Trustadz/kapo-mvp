import { expect, test } from '@playwright/test';

/**
 * Mobile layout regressions (issue #30).
 *
 * Runs at 390×844 in the `mobile` Playwright project, itself depending on
 * `first-install`, whose afterAll seeds the documented mock household.
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

test.describe('mobile collection view menu', () => {
  test('opens the collection view selector inside the 390px viewport', async ({ page }) => {
    await login(page, 'tristan');
    const homeId = await findProjectId(page, 'Home improvement');
    await page.goto(`/p/${homeId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Home improvement' }),
    ).toBeVisible();

    // The wrapped section header puts the actions at the left, which used to
    // push the end-aligned 224px panel past the left edge (issue #30).
    const trigger = page.getByRole('button', { name: /^Collection view:/ });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.getByRole('menu', { name: 'Collection view' });
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!box || !viewport) throw new Error('menu or viewport has no bounding box');

    // The panel is clamped with an 8–12px margin; allow the lower bound here.
    const margin = 8;
    expect(box.x).toBeGreaterThanOrEqual(margin);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - margin);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // The selector still works after being repositioned.
    await menu.getByRole('menuitemradio', { name: 'Card' }).click();
    await expect(
      page.getByRole('button', { name: 'Collection view: Card' }),
    ).toBeVisible();
  });
});
