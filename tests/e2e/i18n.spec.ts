import { expect, test } from '@playwright/test';

/**
 * Issue #21: cookie-based English/Dutch UI translation.
 *
 * Each Playwright test gets a fresh browser context, so the locale cookie
 * never leaks between tests; the app must default to English without one.
 */

const PASSWORD = 'kapo1234';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
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
  const payload = (await response.json()) as { results: Array<{ id: string; title: string }> };
  const hit = payload.results.find((result) => result.title === title);
  if (!hit) throw new Error(`Project "${title}" not found`);
  return hit.id;
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('default locale and the login switcher', () => {
  test('defaults to English, switches to Dutch from Login and persists across reloads', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

    const language = page.getByLabel('Language');
    await expect(language).toHaveValue('en');
    await language.selectOption('nl');

    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(page.getByRole('heading', { level: 1, name: 'Inloggen' })).toBeVisible();
    await expect(page.getByLabel('Gebruikersnaam')).toBeVisible();
    await expect(page.getByLabel('Wachtwoord')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    await expect(page.getByText('Neem contact op met een applicatiebeheerder')).toBeVisible();

    const cookie = (await page.context().cookies()).find(
      (entry) => entry.name === 'kapo_locale',
    );
    expect(cookie?.value).toBe('nl');
    expect(cookie?.path).toBe('/');
    expect(cookie?.expires ?? 0).toBeGreaterThan((Date.now() + 300 * 24 * 60 * 60 * 1000) / 1000);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(page.getByRole('heading', { level: 1, name: 'Inloggen' })).toBeVisible();

    await page.getByLabel('Taal').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(
      (await page.context().cookies()).find((entry) => entry.name === 'kapo_locale')?.value,
    ).toBe('en');
  });
});

test.describe('authenticated Dutch UI and Profile switcher', () => {
  test('switches from Profile and translates shell, Inbox, project and settings chrome', async ({
    page,
  }) => {
    await login(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await page.getByLabel('Language').selectOption('nl');

    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(page.getByRole('heading', { level: 1, name: 'Profiel' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hoofdnavigatie' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start', exact: true })).toBeVisible();

    // Inbox chrome.
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    await expect(
      page.getByText('Bekijk vastgelegde projecten en zet ze om in werk.'),
    ).toBeVisible();

    // Project chrome (the seeded project title is user content and stays English).
    const projectId = await findProjectId(page, 'Home improvement');
    await page.goto(`/p/${projectId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Home improvement' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Eigenschappen' })).toBeVisible();
    await expect(page.getByText('Aanmelder', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Projectacties' })).toBeVisible();

    // Application settings chrome.
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Applicatie-instellingen' }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Back-ups' })).toBeVisible();

    // Switching back updates everything again and preserves the page.
    await page.goto('/profile');
    await page.getByLabel('Taal').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('keeps the Dutch layout inside a 390px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await page.getByLabel('Language').selectOption('nl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(page.getByRole('heading', { level: 1, name: 'Inloggen' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByLabel('Gebruikersnaam').fill('admin');
    await page.getByLabel('Wachtwoord').fill(PASSWORD);
    await page.getByRole('button', { name: 'Inloggen' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    await expect(page.getByRole('heading', { level: 1, name: 'Start' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mobiele navigatie' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
