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
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const dialog = page.getByRole('dialog', { name: 'Favorites', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Favorites', exact: true })).toBeVisible();
    const homeLink = dialog.getByRole('link', { name: 'Home improvement', exact: true });
    await expect(homeLink).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Household', exact: true })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Personal', exact: true })).toBeVisible();
    await expect(homeLink).toHaveAttribute('href', /^\/p\//);

    await homeLink.click();
    await expect(page).toHaveURL(/\/p\/[^/]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Home improvement' }),
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Favorites', exact: true })).toBeHidden();

    // The trigger stays highlighted while a favorite project is open.
    await expect(trigger).toHaveClass(/active/);
  });

  test('shows an empty state for a user without favorites', async ({ page }) => {
    await login(page, 'maya');
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await nav.getByRole('button', { name: 'Favorites' }).click();

    const dialog = page.getByRole('dialog', { name: 'Favorites', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Favorites', exact: true })).toBeVisible();
    await expect(dialog.getByText('No favorites yet')).toBeVisible();
    await expect(
      dialog.getByText('Open a project and tap Favorite to keep it here.'),
    ).toBeVisible();
    await expect(dialog.getByRole('link')).toHaveCount(0);
  });
});
