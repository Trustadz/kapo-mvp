import { expect, test } from '@playwright/test';

/**
 * PocketID / OIDC smoke test.
 *
 * Playwright starts a local mock provider (tests/e2e/mock-oidc-server.ts) and
 * configures Kapo to use it. This proves the full browser redirect flow, the
 * email match against an existing Admin and the Viewer auto-provisioning path
 * without requiring a PocketID container in CI.
 */

const MOCK_OIDC_PORT = Number(process.env.KAPO_E2E_MOCK_OIDC_PORT ?? 3402);
const MOCK_OIDC_URL = `http://127.0.0.1:${MOCK_OIDC_PORT}`;
const MOCK_OIDC_ISSUER_URL = `http://localhost:${MOCK_OIDC_PORT}`;

test.describe('PocketID sign-in', () => {
  test('signs an existing Admin in by matching the email', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Continue with PocketID' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Continue with PocketID' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('button', { name: /admin/i })).toBeVisible();
    // The mock provider's picture claim is imported into local avatar storage.
    await expect(
      page.locator('img[src^="/api/me/avatar/"]').first(),
    ).toBeVisible();
  });

  test('provisions an unknown email as a read-only Viewer', async ({
    page,
    request,
  }) => {
    const setUser = await request.post(`${MOCK_OIDC_URL}/__test/user`, {
      data: {
        sub: 'e2e-viewer-sub',
        email: 'sso-viewer@example.com',
        email_verified: true,
        preferred_username: 'sso-viewer',
        name: 'SSO Viewer',
        picture: `${MOCK_OIDC_ISSUER_URL}/avatar`,
      },
    });
    expect(setUser.ok()).toBe(true);

    await page.goto('/login');
    await page.getByRole('link', { name: 'Continue with PocketID' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByRole('button', { name: /sso-viewer/i })).toBeVisible();
    await expect(
      page.locator('img[src^="/api/me/avatar/"]').first(),
    ).toBeVisible();

    // A Viewer cannot open Admin-only application settings.
    await page.goto('/settings');
    await expect(page).toHaveURL((url) => url.pathname === '/');
  });
});
