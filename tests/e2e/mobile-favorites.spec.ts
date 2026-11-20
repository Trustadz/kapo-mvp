import { expect, test } from '@playwright/test';

/**
 * Mobile Favorites (issue #31): the bottom bar exposes Favorites instead of a
 * redundant Search tab, while Search stays in the mobile top header.
 *
 * Runs at 390×844 in the `mobile` Playwright project, which depends on
 * `first-install` and its seeded mock household (Tristan has favorites, Maya
 * has none).
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

test.describe('mobile favorites', () => {
  test('opens favorites from the bottom bar and navigates to a project', async ({ page }) => {
    await login(page, 'tristan');

    // Search remains reachable from the mobile top header.
    await expect(page.getByRole('link', { name: 'Search', exact: true })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Search' })).toHaveCount(0);

    const trigger = nav.getByRole('button', { name: 'Favorites' });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const menu = page.getByRole('menu', { name: 'Favorites', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Favorites', { exact: true })).toBeVisible();
    const homeItem = menu.getByRole('menuitem', { name: 'Home improvement', exact: true });
    await expect(homeItem).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Household', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Personal', exact: true })).toBeVisible();
    await expect(homeItem).toHaveAttribute('href', /^\/p\//);

    await homeItem.click();
    await expect(page).toHaveURL(/\/p\/[^/]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Home improvement' }),
    ).toBeVisible();
    await expect(menu).toBeHidden();

    // The trigger stays highlighted while a favorite project is open.
    await expect(trigger).toHaveClass(/active/);
  });

  test('shows an empty state for a user without favorites', async ({ page }) => {
    await login(page, 'maya');
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await nav.getByRole('button', { name: 'Favorites' }).click();

    const menu = page.getByRole('menu', { name: 'Favorites', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByText('No favorites yet. Open a project and tap Favorite.')).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(0);
  });
});
