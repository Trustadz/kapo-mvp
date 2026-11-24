import { expect, test, type Page } from '@playwright/test';

/**
 * Trash a child directly from every collection view.
 *
 * The per-card/row overflow menu exposes Move to Trash… whenever the viewer is
 * a project Admin on that child, and the shared confirmation dialog refreshes
 * the collection after the trash action.
 */

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1100 } });

const PASSWORD = 'kapo1234';
const HOME = 'Home improvement';
const VIEWS = ['Kanban', 'Card', 'Tree', 'List'] as const;
type ViewName = (typeof VIEWS)[number];

interface ProjectCardShape {
  id: string;
  title: string;
}

async function login(page: Page, username = 'admin'): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function projectId(page: Page, title: string): Promise<string> {
  const response = await page.request.get(`/api/search?q=${encodeURIComponent(title)}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    results: Array<{ id: string; title: string }>;
  };
  const hit = payload.results.find((result) => result.title === title);
  if (!hit) throw new Error(`Project "${title}" not found in search results`);
  return hit.id;
}

async function openHome(page: Page): Promise<void> {
  await page.goto(`/p/${await projectId(page, HOME)}`);
  await expect(page.getByRole('heading', { level: 1, name: HOME })).toBeVisible();
}

/** Create an Inbox child; the collection only shows it with Show Inbox on. */
async function createTempProject(page: Page, title: string): Promise<ProjectCardShape> {
  const response = await page.request.post('/api/projects', {
    data: { parentId: await projectId(page, HOME), title },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { project: ProjectCardShape };
  return payload.project;
}

async function ensureInboxVisible(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Project actions' }).click();
  const item = page
    .getByRole('menu', { name: 'Project actions' })
    .getByRole('menuitemradio', { name: 'Show Inbox items' });
  if ((await item.count()) > 0) {
    if ((await item.getAttribute('aria-checked')) !== 'true') {
      await item.click();
      await expect(page.getByRole('status')).toContainText('Inbox items are now shown.');
      await page.waitForTimeout(250);
    } else {
      await page.keyboard.press('Escape');
    }
  } else {
    await page.keyboard.press('Escape');
  }
}

async function chooseView(page: Page, view: ViewName): Promise<void> {
  await page.getByRole('button', { name: /^Collection view:/ }).click();
  await page.getByRole('menuitemradio', { name: view, exact: true }).click();
  await expect(page.getByRole('button', { name: `Collection view: ${view}` })).toBeVisible();
}

/** The rendered card/row for the temporary child in the active view. */
function collectionItem(page: Page, view: ViewName, title: string) {
  if (view === 'Tree') return page.locator('tbody tr').filter({ hasText: title });
  if (view === 'List') {
    return page
      .getByRole('list', { name: 'Projects checklist' })
      .locator('li')
      .filter({ hasText: title });
  }
  return page.getByRole('article').filter({ hasText: title });
}

for (const view of VIEWS) {
  test(`trashes a child from ${view} view`, async ({ page }) => {
    await login(page);
    const title = `E2E ${view} trash ${Date.now()}`;
    const temp = await createTempProject(page, title);
    await openHome(page);
    await ensureInboxVisible(page);
    await chooseView(page, view);

    const item = collectionItem(page, view, title);
    await expect(item).toBeVisible();

    // The per-card/row overflow menu carries the same confirmation flow as the
    // project page; only project Admins see it.
    await item.getByRole('button', { name: `Actions for ${title}` }).click();
    const menu = page.getByRole('menu', { name: `Actions for ${title}` });
    const trashItem = menu.getByRole('menuitem', { name: 'Move to Trash…' });
    await expect(trashItem).toBeVisible();
    await trashItem.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Move to Trash?' })).toBeVisible();
    await expect(dialog).toContainText(title);
    await dialog.getByRole('button', { name: 'Move to Trash' }).click();

    await expect(
      page.getByRole('status').filter({ hasText: `Moved “${title}” to Trash.` }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(item).toHaveCount(0);

    const project = await page.request.get(`/api/projects/${temp.id}`);
    expect(project.status()).toBe(200);
    const payload = (await project.json()) as { project: { trashed: boolean } };
    expect(payload.project.trashed).toBe(true);
  });
}

test('hides the trash action from non-admins', async ({ page }) => {
  await login(page, 'maya');
  await openHome(page);
  await chooseView(page, 'Kanban');

  const item = collectionItem(page, 'Kanban', 'Garden beds');
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Actions for Garden beds' }).click();
  const menu = page.getByRole('menu', { name: 'Actions for Garden beds' });
  await expect(menu.getByRole('menuitem', { name: 'Open project' })).toBeVisible();
  // A project User can edit the card but cannot trash it (AR-045).
  await expect(menu.getByRole('menuitem', { name: 'Move to Trash…' })).toHaveCount(0);
});
