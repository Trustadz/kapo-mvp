import { expect, test } from '@playwright/test';

/**
 * Core e2e journeys against a seeded installation (build-spec §6, §10;
 * product.md §12): login, capture → Inbox → release, status change,
 * Viewer read-only, dashboard persistence and trash restore.
 *
 * This project depends on `first-install`, whose afterAll seeds the documented
 * mock household. The database is ./data/test-e2e.db on port 3301; the real
 * ./data/kapo.db is never touched.
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

async function capture(page: import('@playwright/test').Page, title: string): Promise<void> {
  const input = page.getByRole('textbox', { name: /add a project to root/i });
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('status')).toContainText(`Added "${title}" to Inbox.`);
}

test.describe('seeded application', () => {
  test('signs in as the seeded Admin and shows the home dashboard', async ({ page }) => {
    await login(page, 'tristan');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /add a project to root/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    // Seeded favorites appear in the sidebar.
    await expect(
      page.getByRole('link', { name: 'Home improvement', exact: true }),
    ).toBeVisible();
  });

  test('captures into the Root Inbox, then releases to the start status', async ({ page }) => {
    await login(page, 'tristan');
    const title = `E2E capture ${Date.now()}`;
    await capture(page, title);

    await page.goto('/inbox');
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    const item = page.getByRole('article').filter({ hasText: title });
    await expect(item).toBeVisible();
    await expect(item.getByText(/under root/i)).toBeVisible();

    await item.getByRole('button', { name: /release to to do/i }).click();
    // The item stays visible marked Pulled until the user leaves Inbox.
    await expect(item.getByText('Pulled')).toBeVisible();
    await expect(item.getByText(/released — open it to keep working/i)).toBeVisible();

    // The status is kept after release.
    const projectId = await findProjectId(page, title);
    const projectResponse = await page.request.get(`/api/projects/${projectId}`);
    const payload = (await projectResponse.json()) as {
      project: { inbox: boolean; statusName: string | null };
    };
    expect(payload.project.inbox).toBe(false);
    expect(payload.project.statusName).toBe('To do');

    // Leaving and returning to Inbox clears the Pulled presentation.
    await page.goto('/');
    await page.goto('/inbox');
    await expect(page.getByRole('article').filter({ hasText: title })).toHaveCount(0);
  });

  test('changes a project status from the project page', async ({ page }) => {
    await login(page, 'tristan');
    const homeId = await findProjectId(page, 'Home improvement');
    await page.goto(`/p/${homeId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Home improvement' })).toBeVisible();

    const statusSelect = page.getByLabel('Project status');
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption({ label: 'Done' });
    await expect(page.getByText('Status changed to Done.')).toBeVisible();
    await expect(statusSelect).toHaveValue(/./);

    const response = await page.request.get(`/api/projects/${homeId}`);
    const payload = (await response.json()) as {
      project: { statusName: string | null };
    };
    expect(payload.project.statusName).toBe('Done');

    // Restore the seeded state for later tests.
    await statusSelect.selectOption({ label: 'To do' });
    await expect(page.getByText('Status changed to To do.')).toBeVisible();
  });

  test('keeps the last kanban card action menu inside the viewport', async ({ page }) => {
    await login(page, 'tristan');
    const homeId = await findProjectId(page, 'Home improvement');
    await page.goto(`/p/${homeId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Home improvement' })).toBeVisible();

    const kanban = page.getByRole('list', { name: 'Kanban columns' });
    await expect(kanban).toBeVisible();
    const column = kanban
      .locator('section')
      .filter({ has: page.locator('article') })
      .first();
    const lastCard = column.getByRole('article').last();
    const title = ((await lastCard.locator('a').first().textContent()) ?? '').trim();
    expect(title).not.toBe('');

    // Put the last card near the bottom edge so the panel would otherwise be
    // clipped by the Kanban scroll container (issue #20).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const actionsButton = lastCard.getByRole('button', { name: `Actions for ${title}` });
    await expect(actionsButton).toBeVisible();
    await actionsButton.click();

    const menu = page.getByRole('menu', { name: `Actions for ${title}` });
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!box || !viewport) throw new Error('menu or viewport has no bounding box');

    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8);

    // The panel is actually painted where it reports: no ancestor clips it.
    const unclipped = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const target = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return target !== null && (target === element || element.contains(target));
    });
    expect(unclipped).toBe(true);

    // Escape still closes and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(actionsButton).toBeFocused();
  });

  test('application Viewer sees a read-only project page and cannot mutate', async ({ page }) => {
    await login(page, 'alex');
    const homeId = await findProjectId(page, 'Home improvement');
    await page.goto(`/p/${homeId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Home improvement' })).toBeVisible();

    await expect(page.getByLabel('Project status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add project' })).toHaveCount(0);
    // The actions menu still offers the per-user Show archived toggle, but no
    // project-mutating entries.
    await page.getByRole('button', { name: 'Project actions' }).click();
    const actionsMenu = page.getByRole('menu', { name: 'Project actions' });
    await expect(actionsMenu.getByRole('menuitemradio', { name: 'Show archived' })).toBeVisible();
    await expect(actionsMenu.getByRole('menuitem')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Activity remains visible to a read-only Viewer.
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();

    // Server-side authorisation still rejects the mutation.
    const response = await page.request.post('/api/projects', {
      data: { parentId: homeId, title: 'Viewer capture attempt' },
    });
    expect(response.status()).toBe(403);

    // A Viewer may still edit their own preferences.
    const prefs = await page.request.patch('/api/me', {
      data: { appearance: 'light' },
    });
    expect(prefs.status()).toBe(200);
  });

  test('edits the dashboard and persists visibility and order', async ({ page }) => {
    await login(page, 'tristan');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit dashboard' }).click();
    await page.getByRole('checkbox', { name: 'Inbox' }).uncheck();
    await page.getByRole('button', { name: 'Move Recent changes up' }).click();
    await page.getByRole('button', { name: 'Save dashboard' }).click();
    await expect(page.getByText('Dashboard saved.')).toBeVisible();

    const me = await page.request.get('/api/me');
    const payload = (await me.json()) as {
      user: { dashboard: Array<{ id: string; visible: boolean }> };
    };
    expect(payload.user.dashboard).toEqual([
      { id: 'recent', visible: true },
      { id: 'inbox', visible: false },
    ]);

    // Reload keeps the saved preference, and the Inbox widget is hidden.
    await page.reload();
    expect(
      (await (await page.request.get('/api/me')).json()) as {
        user: { dashboard: Array<{ id: string }> };
      },
    ).toMatchObject({ user: { dashboard: payload.user.dashboard } });
    await expect(page.getByRole('heading', { name: 'Recent changes' })).toBeVisible();

    // Leave the seeded defaults in place for other suites.
    await page.getByRole('button', { name: 'Edit dashboard' }).click();
    await page.getByRole('button', { name: 'Restore defaults' }).click();
    await page.getByRole('button', { name: 'Save dashboard' }).click();
  });

  test('trashes a project and restores it from Trash', async ({ page }) => {
    await login(page, 'tristan');
    const title = `E2E trash ${Date.now()}`;
    await capture(page, title);
    const projectId = await findProjectId(page, title);

    await page.goto(`/p/${projectId}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('menuitem', { name: 'Move to Trash…' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Move to Trash' }).click();

    // The trashed project disappears from ordinary search.
    const ordinary = (await (
      await page.request.get(`/api/search?q=${encodeURIComponent(title)}`)
    ).json()) as { results: Array<{ id: string }> };
    expect(ordinary.results.map((result) => result.id)).not.toContain(projectId);

    await page.goto('/search?tab=trash');
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();
    const item = page.getByRole('article').filter({ hasText: title });
    await expect(item).toBeVisible();
    await expect(item.getByText(/purge deadline:/i)).toBeVisible();

    await item.getByRole('button', { name: 'Restore action' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restore project' }).click();
    await expect(page.getByText('Project restored.')).toBeVisible();

    await expect(page.getByRole('article').filter({ hasText: title })).toHaveCount(0);
    const restored = (await (
      await page.request.get(`/api/projects/${projectId}`)
    ).json()) as { project: { trashed: boolean } };
    expect(restored.project.trashed).toBe(false);
  });
});
