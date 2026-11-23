import { expect, test } from '@playwright/test';

/**
 * In-app notification center (issue: notifications core): watch a project,
 * receive another user's change, see the unread badge, open the overflow
 * panel, and observe the panel-close read behaviour plus the full page.
 *
 * The desktop project runs these; the second test narrows the viewport to the
 * mobile breakpoint to verify the bell sits between Search and the avatar.
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

test('watches a project and receives a notification from another user', async ({
  page,
  browser,
}) => {
  await login(page, 'admin');
  const homeId = await findProjectId(page, 'Home improvement');
  await page.goto(`/p/${homeId}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Home improvement' }),
  ).toBeVisible();

  const watch = page.getByRole('button', { name: 'Watch', exact: true });
  await expect(watch).toHaveAttribute('aria-pressed', 'false');
  await watch.click();
  await expect(page.getByRole('button', { name: 'Watching', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Maya shares the project and can rename it. Use a separate browser context
  // so the admin session's cookies stay untouched.
  const mayaContext = await browser.newContext();
  const mayaPage = await mayaContext.newPage();
  await login(mayaPage, 'maya');
  const renamed = await mayaPage.request.patch(`/api/projects/${homeId}`, {
    data: { title: 'Home improvement notified' },
  });
  expect(renamed.status()).toBe(200);
  await mayaContext.close();

  await page.reload();
  const bell = page.getByRole('button', { name: '1 unread notification' });
  await expect(bell).toBeVisible();
  await expect(bell.getByText('1', { exact: true })).toBeVisible();

  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Maya renamed the project to “Home improvement notified”/)).toBeVisible();
  await expect(panel.getByText('Home improvement notified', { exact: true })).toBeVisible();
  await expect(panel.getByText('Unread', { exact: true })).toHaveCount(1);
  await expect(
    panel.getByRole('link', { name: /Maya renamed the project/ }),
  ).toHaveAttribute('href', `/p/${homeId}`);
  await expect(panel.locator('time')).toHaveAttribute('dateTime', /.+/);

  const markedRead = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/notifications/read') &&
      response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Close' }).click();
  await markedRead;
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open notifications' })).toBeVisible();

  // Reopening shows the same item as read, and the full page is reachable.
  await page.getByRole('button', { name: 'Open notifications' }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Unread', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'View all' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  await expect(page.getByText(/Maya renamed the project/)).toBeVisible();

  // Restore the seeded title and stop watching so later specs see the fixture.
  const restored = await page.request.patch(`/api/projects/${homeId}`, {
    data: { title: 'Home improvement' },
  });
  expect(restored.status()).toBe(200);
  await page.goto(`/p/${homeId}`);
  await page.getByRole('button', { name: 'Watching', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Watch', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('places the bell between Search and the avatar on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'admin');

  const search = page.getByRole('link', { name: 'Search', exact: true });
  const bell = page.getByRole('button', { name: /notifications/i });
  const account = page.getByRole('button', { name: 'Account menu' });
  await expect(search).toBeVisible();
  await expect(bell).toBeVisible();
  await expect(account).toBeVisible();

  const [searchBox, bellBox, accountBox] = await Promise.all([
    search.boundingBox(),
    bell.boundingBox(),
    account.boundingBox(),
  ]);
  expect(searchBox).not.toBeNull();
  expect(bellBox).not.toBeNull();
  expect(accountBox).not.toBeNull();
  expect(searchBox!.x).toBeLessThan(bellBox!.x);
  expect(bellBox!.x).toBeLessThan(accountBox!.x);

  await bell.click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeHidden();
});
