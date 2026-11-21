import { expect, test, type Page } from '@playwright/test';

/**
 * MCP capability end-to-end: opt-in toggle, personal token creation, a write
 * through the MCP endpoint, AI provenance in project history, and revocation.
 *
 * Runs against the seeded household installed by the `first-install` project.
 * The project title is restored through MCP so later suites are unaffected.
 */

const PASSWORD = 'kapo1234';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function login(page: Page, username = 'admin'): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function projectIdByTitle(page: Page, title: string): Promise<string> {
  const response = await page.request.get(`/api/search?q=${encodeURIComponent(title)}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    results: Array<{ id: string; title: string }>;
  };
  const hit = payload.results.find((result) => result.title === title);
  if (!hit) throw new Error(`Project "${title}" not found`);
  return hit.id;
}

test.describe('MCP access', () => {
  test('is opt-in, writes with an AI marker in history, and stops after revocation', async ({
    page,
  }) => {
    await login(page);
    const projectId = await projectIdByTitle(page, 'Home improvement');

    // 1. Enable MCP access in application settings (off by default).
    await page.goto('/settings');
    const toggle = page.getByRole('checkbox', { name: 'Allow MCP access' });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toContainText('Application settings saved.');

    // 2. Create a personal token on the profile page; the raw value is shown once.
    await page.goto('/profile');
    await page.getByLabel('Token name').fill('E2E Agent');
    await page.getByRole('button', { name: 'Create token' }).click();
    const tokenCode = page.locator('code').filter({ hasText: 'kapo_mcp_' });
    await expect(tokenCode).toBeVisible();
    const token = (await tokenCode.innerText()).trim();
    expect(token.startsWith('kapo_mcp_')).toBe(true);

    // Copy works from the page (secure origin here; the insecure-origin
    // fallback is unit-tested in tests/unit/clipboard.test.ts).
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(token);

    const rpc = (body: unknown) =>
      page.request.post('/api/mcp', {
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        data: body,
      });

    // 3. Initialize and list tools over the MCP endpoint.
    const init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    });
    expect(init.status()).toBe(200);
    const initBody = (await init.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(initBody.result.serverInfo.name).toBe('kapo');

    const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listedBody = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listedBody.result.tools.map((tool) => tool.name)).toContain('update_project');

    // 4. Rename through MCP; history must mark the change as AI-originated.
    const renamed = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'update_project',
        arguments: { projectId, title: 'Home improvement (MCP)' },
      },
    });
    const renamedBody = (await renamed.json()) as {
      result: { isError?: boolean; structuredContent?: { project: { title: string } } };
    };
    expect(renamedBody.result.isError).toBeUndefined();
    expect(renamedBody.result.structuredContent?.project.title).toBe('Home improvement (MCP)');

    await page.goto(`/p/${projectId}`);
    const activity = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Activity' }) });
    await expect(activity.getByText('(via E2E Agent)')).toBeVisible();
    await expect(activity.getByTitle('Changed by an AI agent through MCP')).toBeVisible();

    // 5. Restore the title through MCP so later suites see the seed data.
    const restored = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'update_project',
        arguments: { projectId, title: 'Home improvement' },
      },
    });
    expect(restored.status()).toBe(200);

    // 6. Revoke the token; the endpoint rejects it immediately.
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Revoke', exact: true }).first().click();
    await page.getByRole('button', { name: 'Revoke token' }).click();
    await expect(page.getByText('You have no MCP tokens yet.')).toBeVisible();

    const afterRevoke = await rpc({ jsonrpc: '2.0', id: 9, method: 'ping' });
    expect(afterRevoke.status()).toBe(401);
  });
});
