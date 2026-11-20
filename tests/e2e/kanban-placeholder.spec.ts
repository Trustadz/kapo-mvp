import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Issue #25 — the Kanban insertion gap.
 *
 * While a card is dragged the destination column is highlighted and a gap is
 * inserted at the landing slot, so the other cards make space before release.
 * Within-column drops reorder at the gap; cross-column drops keep the existing
 * status-only semantics and place the gap at the priority-derived landing slot.
 *
 * Runs against the seeded household and restores the seeded order/status.
 */

test.describe.configure({ mode: 'serial' });

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
  await page.goto(`/p/${await projectId(page, title)}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

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

function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label^="${name},"]`);
}

function cardIn(columnLocator: Locator, title: string): Locator {
  return columnLocator.getByRole('article').filter({ hasText: title });
}

/**
 * Start an HTML5 drag with the mouse so the test can inspect the preview
 * between `mousedown` and `mouseup`. A small move triggers `dragstart`.
 */
async function beginDrag(source: Locator, to: { x: number; y: number }): Promise<void> {
  const box = await source.boundingBox();
  if (!box) throw new Error('Drag source is not visible');
  await source.page().mouse.move(box.x + 12, box.y + 12);
  await source.page().mouse.down();
  await source.page().mouse.move(box.x + 20, box.y + 20, { steps: 3 });
  await source.page().mouse.move(to.x, to.y, { steps: 12 });
}

test('reserves the gap at the within-column landing slot', async ({ page }) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await ensureInboxVisible(page);
  await chooseView(page, 'Kanban');

  const doing = column(page, 'In progress');
  await expect(doing).toBeVisible();
  const cards = doing.getByRole('article');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Garden beds');
  await expect(cards.last()).toContainText('Fix kitchen tap');

  const target = cardIn(doing, 'Fix kitchen tap');
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error('Target card is not visible');
  await beginDrag(cardIn(doing, 'Garden beds'), {
    x: targetBox.x + 24,
    y: targetBox.y + targetBox.height - 4,
  });

  // The column shows its drop state and the gap appears after the target.
  await expect(doing).toHaveAttribute('data-over', '');
  const gap = doing.locator('[data-kanban-placeholder]');
  await expect(gap).toBeVisible();
  const gapBox = await gap.boundingBox();
  expect(gapBox).not.toBeNull();
  if (!gapBox) throw new Error('Insertion gap has no bounding box');
  expect(gapBox.y).toBeGreaterThan(targetBox.y + targetBox.height / 2);

  await page.mouse.up();
  await expect(page.getByRole('status')).toContainText('Reordered “Garden beds”.');
  await expect(cards.last()).toContainText('Garden beds');
  await page.waitForTimeout(200); // let the 160ms FLIP settle before measuring again

  // Restore the seeded order: Garden beds before Fix kitchen tap.
  const fixBox = await cardIn(doing, 'Fix kitchen tap').boundingBox();
  if (!fixBox) throw new Error('Target card is not visible');
  await beginDrag(cardIn(doing, 'Garden beds'), {
    x: fixBox.x + 24,
    y: fixBox.y + 4,
  });
  await page.mouse.up();
  await expect(cards.first()).toContainText('Garden beds');
});

test('previews a cross-column drop at the priority landing slot', async ({ page }) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await ensureInboxVisible(page);
  await chooseView(page, 'Kanban');

  const todo = column(page, 'To do');
  const doing = column(page, 'In progress');
  const paint = cardIn(todo, 'Paint hallway');
  await expect(paint).toBeVisible();

  const doingBox = await doing.boundingBox();
  if (!doingBox) throw new Error('Target column is not visible');
  await beginDrag(paint, {
    x: doingBox.x + doingBox.width / 2,
    y: doingBox.y + doingBox.height - 8,
  });

  await expect(doing).toHaveAttribute('data-over', '');
  await expect(doing.locator('[data-kanban-placeholder]')).toBeVisible();

  await page.mouse.up();
  await expect(page.getByRole('status')).toContainText('Moved “Paint hallway” to In progress.');
  await expect(cardIn(doing, 'Paint hallway')).toBeVisible();

  // Restore the seeded status through the keyboard-accessible card menu.
  const moved = cardIn(doing, 'Paint hallway');
  await moved.getByRole('button', { name: 'Actions for Paint hallway' }).click();
  await page
    .getByRole('menu', { name: 'Actions for Paint hallway' })
    .getByRole('menuitem', { name: 'Move to “To do”' })
    .click();
  await expect(page.getByRole('status')).toContainText('Moved “Paint hallway” to To do.');
});
