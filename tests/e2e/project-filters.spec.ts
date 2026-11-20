import { expect, test, type Page } from '@playwright/test';

/**
 * Issue #55 — title and reporter filters for a project page's child
 * collections. Runs against the seeded household; the first-install project
 * seeds the Home improvement tree used here.
 */

const PASSWORD = 'kapo1234';

async function login(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function findProjectId(page: Page, title: string): Promise<string> {
  const response = await page.request.get(`/api/search?q=${encodeURIComponent(title)}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    results: Array<{ id: string; title: string }>;
  };
  const hit = payload.results.find((result) => result.title === title);
  if (!hit) throw new Error(`Project "${title}" not found in search results`);
  return hit.id;
}

async function openHomeImprovement(page: Page): Promise<void> {
  const id = await findProjectId(page, 'Home improvement');
  await page.goto(`/p/${id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Home improvement' }),
  ).toBeVisible();
}

async function chooseView(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: /^Collection view:/ }).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

/** The Inbox child (and its subtree) is hidden until the viewer opts in. */
async function ensureInboxVisible(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Project actions' }).click();
  const item = page
    .getByRole('menu', { name: 'Project actions' })
    .getByRole('menuitemradio', { name: 'Show Inbox items' });
  if ((await item.count()) > 0) {
    if ((await item.getAttribute('aria-checked')) !== 'true') await item.click();
    else await page.keyboard.press('Escape');
  } else {
    await page.keyboard.press('Escape');
  }
}

function filterBar(page: Page) {
  return page.getByRole('group', { name: 'Filter child projects' });
}

test('Card children filter live by title and reporter', async ({ page }) => {
  await login(page, 'tristan');
  await openHomeImprovement(page);
  await chooseView(page, 'Card');

  // The heading is gone, but the section keeps an accessible name.
  await expect(page.getByRole('heading', { name: 'Child projects' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Child projects' })).toBeVisible();

  const list = page.getByRole('list', { name: 'Projects as cards' });
  const cards = list.getByRole('listitem');
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Add child project' })).toBeVisible();

  const bar = filterBar(page);
  await bar.getByRole('searchbox', { name: 'Filter projects by title' }).fill('GARDEN');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Garden beds');
  await expect(bar.getByRole('status')).toContainText('1 of 4 projects');

  // No match: compact empty state with a Clear filters action; Add stays.
  await bar.getByRole('searchbox', { name: 'Filter projects by title' }).fill('zzzz');
  await expect(page.getByText('No projects match these filters')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add child project' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards).toHaveCount(4);

  // Reporter filter is combined with the title filter.
  await bar.getByRole('combobox', { name: 'Filter projects by reporter' }).selectOption({
    label: 'Maya',
  });
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: 'Install hall shelf' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Fix kitchen tap' })).toHaveCount(1);
  await expect(bar.getByRole('status')).toContainText('2 of 4 projects');

  await bar.getByRole('combobox', { name: 'Filter projects by reporter' }).selectOption({
    label: 'All reporters',
  });
  await expect(cards).toHaveCount(4);
});

test('Tree filters keep matching ancestors as read-only context', async ({ page }) => {
  await login(page, 'tristan');
  await openHomeImprovement(page);
  await ensureInboxVisible(page);
  await chooseView(page, 'Tree');

  const rows = page.locator('tbody tr');
  const contextRow = rows.filter({ hasText: 'Renovate basement' });
  const matchRow = rows.filter({ hasText: 'Find contractor' });

  await filterBar(page)
    .getByRole('searchbox', { name: 'Filter projects by title' })
    .fill('contractor');

  // Renovate basement is the (non-matching) parent kept for structure;
  // Find contractor is the match. The rest of the tree is filtered out.
  await expect(rows).toHaveCount(2);
  await expect(contextRow).toContainText('Context');
  await expect(matchRow).toContainText('Find contractor');
  await expect(page.getByText('Garden beds')).toHaveCount(0);

  // Context rows are muted/read-only: no row selection and no status editor.
  await expect(contextRow.locator('input[type="checkbox"]')).toBeDisabled();
  await expect(contextRow.getByRole('combobox')).toHaveCount(0);
  await expect(contextRow).toHaveAttribute('data-context', 'true');

  // The match itself stays actionable.
  await expect(matchRow.locator('input[type="checkbox"]')).toBeEnabled();
  await expect(matchRow.getByRole('combobox')).toHaveCount(1);
});

test('filter bar stacks cleanly on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'tristan');
  await openHomeImprovement(page);
  await chooseView(page, 'Card');

  const bar = filterBar(page);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('searchbox', { name: 'Filter projects by title' })).toBeVisible();
  await expect(bar.getByRole('combobox', { name: 'Filter projects by reporter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add child project' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Collection view:/ })).toBeVisible();

  const search = await bar
    .getByRole('searchbox', { name: 'Filter projects by title' })
    .boundingBox();
  const reporter = await bar
    .getByRole('combobox', { name: 'Filter projects by reporter' })
    .boundingBox();
  expect(search).not.toBeNull();
  expect(reporter).not.toBeNull();
  if (!search || !reporter) throw new Error('filter controls have no bounding box');

  // Stacked, not side by side, and inside the viewport.
  expect(reporter.y).toBeGreaterThan(search.y);
  expect(search.x + search.width).toBeLessThanOrEqual(390);
  expect(reporter.x + reporter.width).toBeLessThanOrEqual(390);
});
