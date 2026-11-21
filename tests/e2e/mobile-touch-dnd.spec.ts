import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Issue #79 — touch drag and drop outside Kanban.
 *
 * The Kanban pointer path from issue #29 is preserved; Inbox Card/Tree and the
 * project Card/Tree/List views now share the same long-press gesture. This
 * spec drives synthetic touch pointer events at 390×844 so the exact gesture
 * runs without a real finger:
 *
 * - press and hold ~300ms, then move;
 * - a move before activation (>10px) still means "scroll", not drag;
 * - Card: top/bottom half reorders globally, the release rail releases;
 * - Tree: edge = reorder, middle = reparent (Inbox) / Move dialog (project);
 * - project Card: edge = sibling reorder, body = Move dialog;
 * - project List: top/bottom half reorder;
 * - Escape and pointercancel clear every preview without a drop.
 *
 * Serial because the Inbox tree and Home improvement order are shared state.
 */

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'kapo1234';
const TOUCH_POINTER_ID = 79;

interface Point {
  x: number;
  y: number;
}

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

async function openProject(page: Page, title: string): Promise<void> {
  await page.goto(`/p/${await findProjectId(page, title)}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function capture(page: Page, title: string): Promise<void> {
  // The mobile shell exposes capture through the bottom navigation dialog;
  // the desktop top-bar textbox is not rendered at 390px.
  await page.getByRole('button', { name: 'Add a project to Root' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Project title').fill(title);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(`Added "${title}" to Inbox.`);
}

async function chooseView(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: /^Collection view:/ }).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

/** After #16 Inbox children are hidden by default; the seeded drag targets need them. */
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

/** Dispatch a synthetic touch pointer event on a row/card or on the window. */
async function pointerEvent(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  point: Point,
  options: { target?: Locator; pointerId?: number } = {},
): Promise<void> {
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: options.pointerId ?? TOUCH_POINTER_ID,
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

/**
 * Press and hold a card/row until the shared ghost appears. `center: false`
 * keeps the page at its current scroll offset, which the release-rail test
 * needs so the rail stays on screen next to the cards.
 */
async function longPress(
  page: Page,
  source: Locator,
  options: { center?: boolean; pointerId?: number } = {},
): Promise<Point> {
  if (options.center !== false) {
    await source.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  } else {
    await source.scrollIntoViewIfNeeded();
  }
  const box = await source.boundingBox();
  if (!box) throw new Error('Touch drag source is not visible');
  const point = { x: box.x + Math.min(box.width / 2, 120), y: box.y + 10 };
  await pointerEvent(page, 'pointerdown', point, {
    target: source,
    pointerId: options.pointerId,
  });
  await expect(source).toHaveAttribute('data-pressing', 'true');
  await page.waitForTimeout(350);
  await expect(page.locator('[data-touch-ghost]')).toBeVisible();
  // Let the drag's window listeners attach before moving the synthetic pointer.
  await page.waitForTimeout(120);
  return point;
}

function targetPoint(box: { x: number; y: number; width: number; height: number }, where: 'top' | 'middle' | 'bottom'): Point {
  const y =
    where === 'top'
      ? box.y + 2
      : where === 'bottom'
        ? box.y + box.height - 2
        : box.y + box.height / 2;
  return { x: box.x + Math.min(box.width / 2, 140), y };
}

async function moveTo(
  page: Page,
  target: Locator,
  where: 'top' | 'middle' | 'bottom',
  options: { pointerId?: number } = {},
): Promise<Point> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Touch drag target is not visible');
  const point = targetPoint(box, where);
  await pointerEvent(page, 'pointermove', point, options);
  return point;
}

async function lift(page: Page, point: Point, pointerId?: number): Promise<void> {
  await pointerEvent(page, 'pointerup', point, { pointerId });
}

/**
 * Programmatic scrolling still works during an active drag (only touch
 * scrolling is locked). Centering the drop target keeps every synthetic
 * pointer inside the viewport, away from the autoscroll edge bands.
 */
async function scrollTargetIntoView(target: Locator): Promise<void> {
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
}

function inboxCards(page: Page): Locator {
  return page.getByRole('list', { name: 'Projects in the Inbox' }).locator('article');
}

async function inboxCardTitles(page: Page): Promise<string[]> {
  return inboxCards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector('h2')?.textContent?.trim() ?? ''),
  );
}

/** Flat global Tree order, which is what the reorder API writes. */
async function treeOrder(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/inbox');
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    tree: Array<{ id: string; title: string }>;
  };
  return payload.tree.map((node) => node.id);
}

test('Inbox Card: early movement scrolls, long-press reorders and Escape cancels', async ({
  page,
}) => {
  await login(page, 'admin');
  const first = `E2E touch card A ${Date.now()}`;
  const second = `E2E touch card B ${Date.now()}`;
  await capture(page, first);
  await capture(page, second);

  await page.goto('/inbox');
  const card = (title: string) => inboxCards(page).filter({ hasText: title });
  await expect(card(first)).toBeVisible();
  await expect(card(second)).toBeVisible();
  expect((await inboxCardTitles(page)).indexOf(first)).toBeLessThan(
    (await inboxCardTitles(page)).indexOf(second),
  );

  // Before activation a >10px move means the user is scrolling: no ghost ever
  // appears and no drag state is left behind.
  const idleBox = await card(first).boundingBox();
  if (!idleBox) throw new Error('Inbox card is not visible');
  await pointerEvent(
    page,
    'pointerdown',
    { x: idleBox.x + 20, y: idleBox.y + 10 },
    { target: card(first) },
  );
  await expect(card(first)).toHaveAttribute('data-pressing', 'true');
  await pointerEvent(page, 'pointermove', {
    x: idleBox.x + 20,
    y: idleBox.y + 70,
  });
  await expect(card(first)).not.toHaveAttribute('data-pressing', 'true');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-touch-ghost]')).toHaveCount(0);
  await pointerEvent(page, 'pointerup', {
    x: idleBox.x + 20,
    y: idleBox.y + 70,
  });
  expect((await inboxCardTitles(page)).indexOf(first)).toBeLessThan(
    (await inboxCardTitles(page)).indexOf(second),
  );

  // Drop on the bottom half of the second card = reorder after it.
  await longPress(page, card(first));
  await scrollTargetIntoView(card(second));
  const dropPoint = await moveTo(page, card(second), 'bottom');
  await expect(card(second)).toHaveAttribute('data-drop', 'after');
  await lift(page, dropPoint);
  await expect(page.getByRole('status')).toContainText(`Reordered “${first}”.`);
  await expect
    .poll(async () => (await inboxCardTitles(page)).indexOf(second))
    .toBeLessThan((await inboxCardTitles(page)).indexOf(first));
  await expect(page.locator('[data-touch-ghost]')).toHaveCount(0);

  // Escape during an active drag clears the preview without reordering.
  await page.waitForTimeout(250);
  await longPress(page, card(first));
  await scrollTargetIntoView(card(second));
  const cancelledPoint = await moveTo(page, card(second), 'top');
  await expect(card(second)).toHaveAttribute('data-drop', 'before');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-touch-ghost]')).toHaveCount(0);
  await expect(card(second)).not.toHaveAttribute('data-drop', 'before');
  await lift(page, cancelledPoint);
  await expect
    .poll(async () => (await inboxCardTitles(page)).indexOf(second))
    .toBeLessThan((await inboxCardTitles(page)).indexOf(first));

  // pointercancel (browser interrupted the gesture) also resets cleanly.
  const orderBeforeCancel = await inboxCardTitles(page);
  await longPress(page, card(first));
  await scrollTargetIntoView(card(second));
  const cancelPoint = await moveTo(page, card(second), 'top');
  await expect(card(second)).toHaveAttribute('data-drop', 'before');
  await pointerEvent(page, 'pointercancel', cancelPoint);
  await expect(page.locator('[data-touch-ghost]')).toHaveCount(0);
  await expect(card(second)).not.toHaveAttribute('data-drop', 'before');
  expect(await inboxCardTitles(page)).toEqual(orderBeforeCancel);
});

test('Inbox Card: the release rail releases instead of reordering', async ({ page }) => {
  await login(page, 'admin');
  const title = `E2E touch release ${Date.now()}`;
  await capture(page, title);
  await page.goto('/inbox');
  await page.evaluate(() => window.scrollTo(0, 0));

  const card = inboxCards(page).filter({ hasText: title });
  await expect(card).toBeVisible();
  const rail = page.getByRole('region', { name: 'Release drop area' });
  await expect(rail).toBeVisible();

  await longPress(page, card, { center: false });
  // Programmatic scrolling is not blocked by the active drag (only touch
  // scrolling is); bring the release rail back into view before dropping.
  await page.evaluate(() => window.scrollTo(0, 0));
  const railPoint = await moveTo(page, rail, 'middle');
  await expect(rail).toHaveAttribute('data-active', 'true');
  await expect(card).not.toHaveAttribute('data-drop', /before|after/);
  await lift(page, railPoint);

  await expect(page.getByRole('status')).toContainText(
    `Released “${title}” to To do.`,
  );
  await expect(card.getByText('Pulled')).toBeVisible();
  await expect(page.locator('[data-touch-ghost]')).toHaveCount(0);
});

test('Inbox Tree: long-press reparents on a row middle and reorders on an edge', async ({
  page,
}) => {
  await login(page, 'admin');
  const first = `E2E touch tree A ${Date.now()}`;
  const second = `E2E touch tree B ${Date.now()}`;
  const third = `E2E touch tree C ${Date.now()}`;
  const fourth = `E2E touch tree D ${Date.now()}`;
  await capture(page, first);
  await capture(page, second);
  await capture(page, third);
  await capture(page, fourth);
  const firstId = await findProjectId(page, first);
  const targetId = await findProjectId(page, 'Personal');

  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Tree' }).click();
  const tree = page.getByRole('region', { name: 'Application tree' });
  const row = (title: string) => tree.getByRole('row', { name: new RegExp(title) });

  // A non-Inbox row is a drop target, never a drag source.
  const nonInbox = row('Personal');
  const nonInboxBox = await nonInbox.boundingBox();
  if (!nonInboxBox) throw new Error('Non-Inbox row is not visible');
  await pointerEvent(
    page,
    'pointerdown',
    { x: nonInboxBox.x + 200, y: nonInboxBox.y + 10 },
    { target: nonInbox },
  );
  await page.waitForTimeout(400);
  await expect(page.locator('[data-touch-ghost]')).toHaveCount(0);
  await expect(nonInbox).not.toHaveAttribute('data-pressing', 'true');
  await pointerEvent(page, 'pointerup', {
    x: nonInboxBox.x + 200,
    y: nonInboxBox.y + 10,
  });

  // Middle of a non-Inbox row = reparent the Inbox capture under it.
  await longPress(page, row(first));
  await scrollTargetIntoView(nonInbox);
  const reparentPoint = await moveTo(page, nonInbox, 'middle');
  await expect(nonInbox).toHaveAttribute('data-drop', 'inside');
  await lift(page, reparentPoint);
  await expect(page.getByRole('status')).toContainText(
    `Moved “${first}” under Personal; it stays in the Inbox.`,
  );
  const parentResponse = await page.request.get(`/api/projects/${firstId}`);
  const parentPayload = (await parentResponse.json()) as {
    project: { inbox: boolean; parent: { id: string } | null };
  };
  expect(parentPayload.project.inbox).toBe(true);
  expect(parentPayload.project.parent?.id).toBe(targetId);
  await page.waitForTimeout(250);

  // Edge of a sibling row = global reorder (second after third).
  await longPress(page, row(second));
  await scrollTargetIntoView(row(third));
  const reorderPoint = await moveTo(page, row(third), 'bottom');
  await expect(row(third)).toHaveAttribute('data-drop', 'after');
  await lift(page, reorderPoint);
  await expect(page.getByRole('status')).toContainText(`Reordered “${second}”.`);
  await expect
    .poll(async () => {
      const order = await treeOrder(page);
      const secondId = await findProjectId(page, second);
      const thirdId = await findProjectId(page, third);
      return order.indexOf(secondId) > order.indexOf(thirdId);
    })
    .toBe(true);
  await page.waitForTimeout(250);

  // Escape cancels the pending edge drop; the order cannot change on release.
  const before = await treeOrder(page);
  await longPress(page, row(fourth));
  await scrollTargetIntoView(row(second));
  const treeCancelled = await moveTo(page, row(second), 'top');
  await expect(row(second)).toHaveAttribute('data-drop', 'before');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-touch-ghost]')).toHaveCount(0);
  await expect(row(second)).not.toHaveAttribute('data-drop', 'before');
  await lift(page, treeCancelled);
  expect(await treeOrder(page)).toEqual(before);
});

test('project Card: edge reorders and the card body still opens Move', async ({ page }) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await ensureInboxVisible(page);
  await chooseView(page, 'Card');

  const cards = page.getByRole('list', { name: 'Projects as cards' }).locator('article');
  const card = (title: string) => cards.filter({ hasText: title });
  await expect(cards.last()).toContainText('Fix kitchen tap');

  // Garden beds is immediately before Fix kitchen tap: drop after it, then
  // restore by dropping before it.
  await longPress(page, card('Garden beds'));
  await scrollTargetIntoView(card('Fix kitchen tap'));
  const afterPoint = await moveTo(page, card('Fix kitchen tap'), 'bottom');
  await expect(card('Fix kitchen tap')).toHaveAttribute('data-drop', 'after');
  await lift(page, afterPoint);
  await expect(page.getByRole('status')).toContainText('Reordered “Garden beds”.');
  await expect(cards.last()).toContainText('Garden beds');
  await page.waitForTimeout(250);

  await longPress(page, card('Garden beds'));
  await scrollTargetIntoView(card('Fix kitchen tap'));
  const beforePoint = await moveTo(page, card('Fix kitchen tap'), 'top');
  await expect(card('Fix kitchen tap')).toHaveAttribute('data-drop', 'before');
  await lift(page, beforePoint);
  await expect(cards.last()).toContainText('Fix kitchen tap');
  await page.waitForTimeout(250);

  // Card body (middle) keeps the desktop move-dialog semantics.
  await longPress(page, card('Paint hallway'));
  await scrollTargetIntoView(card('Install hall shelf'));
  const movePoint = await moveTo(page, card('Install hall shelf'), 'middle');
  await expect(card('Install hall shelf')).toHaveAttribute('data-drop', 'inside');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-touch-ghost]')).toHaveCount(0);
  await expect(card('Install hall shelf')).not.toHaveAttribute('data-drop', 'inside');
  await lift(page, movePoint);
  await expect(page.getByRole('status')).not.toContainText('Reordered “Paint hallway”.');
});

test('project Tree and List: edge reorder works by long-press', async ({ page }) => {
  await login(page, 'admin');
  await openProject(page, 'Home improvement');
  await ensureInboxVisible(page);
  await chooseView(page, 'Tree');

  const treeRows = page.locator('tbody tr');
  const treeRow = (title: string) => treeRows.filter({ hasText: title });
  await expect(treeRows.last()).toContainText('Fix kitchen tap');
  await longPress(page, treeRow('Garden beds'));
  await scrollTargetIntoView(treeRow('Fix kitchen tap'));
  const treeAfter = await moveTo(page, treeRow('Fix kitchen tap'), 'bottom');
  await expect(treeRow('Fix kitchen tap')).toHaveAttribute('data-drop', 'after');
  await lift(page, treeAfter);
  await expect(page.getByRole('status')).toContainText('Reordered “Garden beds”.');
  await expect(treeRows.last()).toContainText('Garden beds');
  await page.waitForTimeout(250);

  // Restore before switching views.
  await longPress(page, treeRow('Garden beds'));
  await scrollTargetIntoView(treeRow('Fix kitchen tap'));
  const treeBefore = await moveTo(page, treeRow('Fix kitchen tap'), 'top');
  await lift(page, treeBefore);
  await expect(treeRows.last()).toContainText('Fix kitchen tap');
  await page.waitForTimeout(250);

  await chooseView(page, 'List');
  const list = page.getByRole('list', { name: 'Projects checklist' });
  const rows = list.getByRole('listitem');
  const row = (title: string) => rows.filter({ hasText: title });
  await expect(rows.last()).toContainText('Fix kitchen tap');
  await longPress(page, row('Garden beds'));
  await scrollTargetIntoView(row('Fix kitchen tap'));
  const listAfter = await moveTo(page, row('Fix kitchen tap'), 'bottom');
  await expect(row('Fix kitchen tap')).toHaveAttribute('data-drop', 'after');
  await lift(page, listAfter);
  await expect(page.getByRole('status')).toContainText('Reordered “Garden beds”.');
  await expect(rows.last()).toContainText('Garden beds');
  await page.waitForTimeout(250);

  await longPress(page, row('Garden beds'));
  await scrollTargetIntoView(row('Fix kitchen tap'));
  const listBefore = await moveTo(page, row('Fix kitchen tap'), 'top');
  await lift(page, listBefore);
  await expect(rows.last()).toContainText('Fix kitchen tap');
});
