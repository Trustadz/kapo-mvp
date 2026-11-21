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
    await login(page, 'admin');
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

test.describe('mobile Inbox tree', () => {
  test('shows the application tree without horizontal page scroll', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/inbox');
    await page.getByRole('button', { name: 'Tree' }).click();

    const tree = page.getByRole('region', { name: 'Application tree' });
    await expect(tree).toBeVisible();
    await expect(tree.getByRole('row', { name: /Renovate basement/ })).toBeVisible();

    // Long project titles must wrap inside the fixed table instead of widening
    // the document (issue #54).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(tree.getByRole('checkbox', { name: 'Select Renovate basement' })).toBeVisible();
  });
});

test.describe('mobile browser chrome', () => {
  test('top/bottom edges use the bar surface colours instead of the canvas', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/inbox');

    const edges = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
      const metas = Array.from(
        document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
      ).map((meta) => ({
        media: meta.getAttribute('media'),
        content: meta.getAttribute('content')?.toLowerCase(),
      }));
      return {
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        nav: nav ? getComputedStyle(nav).backgroundColor : null,
        metas,
      };
    });

    expect(edges.html).toBe('rgb(255, 255, 255)');
    expect(edges.body).toBe('rgb(245, 243, 236)');
    expect(edges.nav).toBe('rgb(255, 255, 255)');
    expect(edges.metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ media: '(prefers-color-scheme: light)', content: '#ffffff' }),
        expect.objectContaining({ media: '(prefers-color-scheme: dark)', content: '#242a25' }),
      ]),
    );

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    const dark = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
      return {
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        nav: nav ? getComputedStyle(nav).backgroundColor : null,
      };
    });
    expect(dark).toEqual({
      html: 'rgb(36, 42, 37)',
      body: 'rgb(24, 28, 25)',
      nav: 'rgb(36, 42, 37)',
    });
  });
});
