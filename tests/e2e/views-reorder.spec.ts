import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Issue #28 — re-prioritising in every collection view.
 *
 * Card, Tree and List must reorder siblings by dragging between rows/cards;
 * dropping on a Card/Tree row keeps opening the Move dialog, and a Tree
 * drop-between across parents falls back to the dialog instead of inventing a
 * cross-parent order. Kanban behaviour is covered by its own journey.
 *
 * Runs against the seeded household; each test restores the seeded order so the
 * remaining suites see the documented tree.
 */

test.describe.configure({ mode: 'serial' });

// The seeded Home improvement page is taller than the default 720px viewport;
// keep both drag endpoints visible without auto-scroll.
test.use({ viewport: { width: 1440, height: 1100 } });

const PASSWORD = 'kapo1234';

async function login(page: Page, username: string): Promise<void> {
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

async function openProject(page: Page, title: string): Promise<void> {
  const id = await projectId(page, title);
  await page.goto(`/p/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

/**
 * After #16, Inbox children are hidden from project collections by default.
 * This spec uses the seeded Renovate basement (an Inbox child) to prove real
 * ordering. On a build without the #16 toggle the item does not exist and the
 * helper is a no-op; on a build with it, turn the preference on.
 */
async function ensureInboxVisible(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Project actions' }).click();
  const item = page
    .getByRole('menu', { name: 'Project actions' })
    .getByRole('menuitemradio', { name: 'Show Inbox items' });
  if ((await item.count()) > 0) {
    if ((await item.getAttribute('aria-checked')) !== 'true') {
      await item.click();
      // The toggle triggers a router refresh; wait for it to settle before
      // measuring/dragging collection cards.
      await expect(page.getByRole('status')).toContainText('Inbox items are now shown.');
      await page.waitForTimeout(250);
    } else {
      await page.keyboard.press('Escape');
    }
  } else {
    await page.keyboard.press('Escape');
  }
}

async function chooseView(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: /^Collection view:/ }).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

/**
 * Drop `source` before/after `target`, using the same vertical edge zones the
 * views compute. `targetPosition` is relative to the target's top-left corner.
 */
async function dragBetween(
  source: Locator,
  target: Locator,
  edge: 'before' | 'after',
  sourcePosition: { x: number; y: number } = { x: 4, y: 4 },
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Drag target is not visible');
  const y = edge === 'before' ? 2 : box.height - 2;
  // Start on non-control padding: a status select or link does not initiate an
  // HTML5 drag, so the source point must avoid the interactive row content.
  await source.dragTo(target, {
    sourcePosition,
    targetPosition: { x: Math.min(20, Math.max(1, box.width / 2)), y },
  });
}

test('Card view reorders siblings between cards and opens Move on a card body', async ({
  page,
}) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await ensureInboxVisible(page);
  await chooseView(page, 'Card');

  const list = page.getByRole('list', { name: 'Projects as cards' });
  await expect(list).toBeVisible();
  const cards = list.locator('article');
  const card = (title: string) => cards.filter({ hasText: title });

  // Seeded order starts with Renovate basement and ends with Fix kitchen tap.
  await expect(cards.first()).toContainText('Renovate basement');
  await expect(cards.last()).toContainText('Fix kitchen tap');

  // Drop before the first card: Garden beds moves to the top.
  await dragBetween(card('Garden beds'), card('Renovate basement'), 'before', { x: 4, y: 4 });
  await expect(page.getByRole('status')).toContainText('Reordered “Garden beds”.');
  await expect(cards.first()).toContainText('Garden beds');
  await page.waitForTimeout(200); // FLIP settle

  // Restore the seeded order by dropping after Install hall shelf.
  await dragBetween(card('Garden beds'), card('Install hall shelf'), 'after', { x: 4, y: 4 });
  await expect(cards.first()).toContainText('Renovate basement');
  await expect(cards.nth(3)).toContainText('Garden beds');
  await page.waitForTimeout(200); // FLIP settle

  // Dropping on a card body (its centre) still opens the Move dialog.
  await card('Paint hallway').dragTo(card('Garden beds'), {
    sourcePosition: { x: 4, y: 4 },
    targetPosition: { x: 40, y: 60 },
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Move project' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Tree view reorders same-parent rows and falls back to Move across parents', async ({
  page,
}) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await ensureInboxVisible(page);
  await chooseView(page, 'Tree');

  const rows = page.locator('tbody tr');
  const row = (title: string) => rows.filter({ hasText: title });
  await expect(rows.first()).toContainText('Renovate basement');

  // Same parent: reorder Garden beds before Renovate basement.
  await dragBetween(row('Garden beds'), row('Renovate basement'), 'before', { x: 300, y: 6 });
  await expect(page.getByRole('status')).toContainText('Reordered “Garden beds”.');
  await expect(rows.first()).toContainText('Garden beds');
  await page.waitForTimeout(200); // FLIP settle

  // Restore: after Install hall shelf (still a direct child of Home improvement).
  await dragBetween(row('Garden beds'), row('Install hall shelf'), 'after', { x: 300, y: 6 });
  await expect(rows.first()).toContainText('Renovate basement');
  await expect(rows.nth(4)).toContainText('Garden beds');
  await page.waitForTimeout(200); // FLIP settle

  // Different parent: Garden beds -> between Renovate basement's children.
  // The sibling reorder API cannot express this, so the Move dialog opens.
  await dragBetween(row('Garden beds'), row('Find contractor'), 'before', { x: 300, y: 6 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Move project' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  // No cross-parent order was invented.
  await expect(rows.first()).toContainText('Renovate basement');
});

test('List view reorders rows', async ({ page }) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await ensureInboxVisible(page);
  await chooseView(page, 'List');

  const list = page.getByRole('list', { name: 'Projects checklist' });
  const rows = list.getByRole('listitem');
  const row = (title: string) => rows.filter({ hasText: title });
  await expect(rows.first()).toContainText('Renovate basement');

  await dragBetween(row('Garden beds'), row('Renovate basement'), 'before', { x: 300, y: 6 });
  await expect(page.getByRole('status')).toContainText('Reordered “Garden beds”.');
  await expect(rows.first()).toContainText('Garden beds');
  await page.waitForTimeout(200); // FLIP settle

  // Restore the seeded order.
  await dragBetween(row('Garden beds'), row('Install hall shelf'), 'after', { x: 300, y: 6 });
  await expect(rows.first()).toContainText('Renovate basement');
  await expect(rows.nth(3)).toContainText('Garden beds');
});
