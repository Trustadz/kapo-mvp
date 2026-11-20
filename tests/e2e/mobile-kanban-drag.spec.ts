import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Issue #29 — Kanban drag on touch devices.
 *
 * HTML5 drag does not fire for touch, so the Kanban gets a Pointer Events path:
 * press and hold a card for ~300ms, then drag. The insertion gap from #25 is
 * reused as the drop preview and the target column is highlighted. This spec
 * drives synthetic touch pointer events so Playwright mobile (Desktop Chrome +
 * mobile viewport) can exercise the exact gesture without a real finger.
 *
 * Runs against the seeded household and restores the seeded order.
 */

test.describe.configure({ mode: 'serial' });

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

/** Dispatch a touch pointer event on the card or on the window. */
async function pointerEvent(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  point: { x: number; y: number },
  options: { target?: Locator; pointerId?: number } = {},
): Promise<void> {
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: options.pointerId ?? 29,
    pointerType: 'touch',
    isPrimary: true,
    button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: point.x,
    clientY: point.y,
  };
  if (options.target) {
    const handle = await options.target.elementHandle();
    if (!handle) throw new Error('Touch drag target is not attached');
    await handle.evaluate(
      (element, { eventType, eventInit }) => {
        element.dispatchEvent(new PointerEvent(eventType, eventInit));
      },
      { eventType: type, eventInit: init },
    );
    return;
  }
  await page.evaluate(
    ({ eventType, eventInit }) => {
      window.dispatchEvent(new PointerEvent(eventType, eventInit));
    },
    { eventType: type, eventInit: init },
  );
}

/** Press and hold long enough to arm the pointer drag. */
async function longPress(page: Page, source: Locator): Promise<{ x: number; y: number }> {
  await source.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const box = await source.boundingBox();
  if (!box) throw new Error('Touch drag source is not visible');
  const point = { x: box.x + box.width / 2, y: box.y + 12 };
  await pointerEvent(page, 'pointerdown', point, { target: source });
  await expect(source).toHaveAttribute('data-pressing', 'true');
  await page.waitForTimeout(350);
  await expect(page.locator('[data-kanban-ghost]')).toBeVisible();
  // Let the drag's window listeners attach before moving the synthetic pointer.
  await page.waitForTimeout(100);
  return point;
}

test('long-presses a card, previews the gap and reorders on release', async ({ page }) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await chooseView(page, 'Kanban');

  const doing = column(page, 'In progress');
  await doing.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(doing).toBeVisible();
  const cards = doing.getByRole('article');
  await expect(cards).toHaveCount(2);
  const source = cardIn(doing, 'Garden beds');
  const target = cardIn(doing, 'Fix kitchen tap');

  await longPress(page, source);

  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error('Touch drag target is not visible');
  await pointerEvent(page, 'pointermove', {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height - 4,
  });

  await expect(doing).toHaveAttribute('data-over', '');
  await expect(doing.locator('[data-kanban-placeholder]')).toBeVisible();

  await pointerEvent(page, 'pointerup', {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height - 4,
  });
  await expect(page.getByRole('status')).toContainText('Reordered “Garden beds”.');
  await expect(cards.last()).toContainText('Garden beds');
  await expect(page.locator('[data-kanban-ghost]')).toHaveCount(0);

  // The overflow menu remains the accessible fallback; use it to restore.
  const moved = cardIn(doing, 'Garden beds');
  await moved.getByRole('button', { name: 'Actions for Garden beds' }).click();
  await page
    .getByRole('menu', { name: 'Actions for Garden beds' })
    .getByRole('menuitem', { name: 'Move earlier' })
    .click();
  await expect(cards.first()).toContainText('Garden beds');
  await expect(cards.last()).toContainText('Fix kitchen tap');
});

test('Escape cancels a touch drag without changing the order', async ({ page }) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await chooseView(page, 'Kanban');

  const doing = column(page, 'In progress');
  await doing.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const cards = doing.getByRole('article');
  await expect(cards.first()).toContainText('Garden beds');
  await expect(cards.last()).toContainText('Fix kitchen tap');

  const target = cardIn(doing, 'Fix kitchen tap');
  await longPress(page, cardIn(doing, 'Garden beds'));
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error('Touch drag target is not visible');
  await pointerEvent(page, 'pointermove', {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height - 4,
  });
  await expect(doing.locator('[data-kanban-placeholder]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(doing.locator('[data-kanban-placeholder]')).toHaveCount(0);
  await expect(page.locator('[data-kanban-ghost]')).toHaveCount(0);
  await pointerEvent(page, 'pointerup', {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height - 4,
  });

  await expect(cards.first()).toContainText('Garden beds');
  await expect(cards.last()).toContainText('Fix kitchen tap');
});
