import { expect, test, type Page } from '@playwright/test';

/**
 * Issue #35 — drag-free alternatives for Kanban, Tree, Card and List.
 *
 * Every drag action has a keyboard equivalent through the per-card/row Actions
 * menu: Move earlier, Move later, Move to a status and Move to another project.
 * The specs drive the menu only with the keyboard (Enter/ArrowDown/Escape) and
 * create temporary children so the documented seed order is never changed.
 */

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1100 } });

const PASSWORD = 'kapo1234';
const HOME = 'Home improvement';
const createdIds: string[] = [];

interface ProjectCardShape {
  id: string;
  title: string;
  parentId: string | null;
  statusId: string | null;
  statusName: string | null;
  inbox: boolean;
}

interface ProjectPageShape {
  id: string;
  title: string;
  statusName: string | null;
  inbox: boolean;
  parent: { id: string; title: string } | null;
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

/** Create a temporary Inbox child so assertions never depend on seed order. */
async function createTempProject(page: Page, title: string): Promise<ProjectCardShape> {
  const parentId = await projectId(page, HOME);
  const response = await page.request.post('/api/projects', {
    data: { parentId, title },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { project: ProjectCardShape };
  createdIds.push(payload.project.id);
  return payload.project;
}

async function fetchProject(page: Page, id: string): Promise<ProjectPageShape> {
  const response = await page.request.get(`/api/projects/${id}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as { project: ProjectPageShape };
  return payload.project;
}

/**
 * Turn on Show Inbox items so the temporary capture appears in the project
 * collection. Mirrors tests/e2e/views-reorder.spec.ts.
 */
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

/** Move the menu focus until the current item's accessible name matches. */
async function focusMenuItemByText(page: Page, matcher: RegExp, max = 40): Promise<void> {
  for (let index = 0; index < max; index += 1) {
    const label = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return '';
      const role = element.getAttribute('role') ?? '';
      if (!role.startsWith('menuitem')) return '';
      // Icons are decorative and aria-hidden; read the visible label so the
      // ligature text does not become part of the matcher.
      const label = element.querySelector('[class*="itemLabel"]');
      return (label?.textContent ?? element.getAttribute('aria-label') ?? element.textContent ?? '')
        .trim();
    });
    if (matcher.test(label.replace(/\s+/g, ' '))) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`Menu item ${matcher} was not reachable with the arrow keys`);
}

async function chooseView(page: Page, label: 'Kanban' | 'Card' | 'Tree' | 'List'): Promise<void> {
  const trigger = page.getByRole('button', { name: /^Collection view:/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Collection view' });
  await expect(menu).toBeVisible();
  await focusMenuItemByText(page, new RegExp(`^${label}$`));
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAccessibleName(`Collection view: ${label}`);
}

async function openCardMenu(page: Page, title: string): Promise<void> {
  const trigger = page.getByRole('button', { name: `Actions for ${title}` });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: `Actions for ${title}` })).toBeVisible();
}

async function activateMenuItem(page: Page, name: RegExp | string): Promise<void> {
  const pattern = typeof name === 'string' ? new RegExp(`^${name}$`) : name;
  await focusMenuItemByText(page, pattern);
  await page.keyboard.press('Enter');
}

async function selectByKeyboard(
  page: Page,
  select: import('@playwright/test').Locator,
  expectedValue: string,
  max = 30,
): Promise<void> {
  await select.focus();
  for (let index = 0; index < max; index += 1) {
    if ((await select.inputValue()) === expectedValue) return;
    await page.keyboard.press('ArrowDown');
  }
  expect(await select.inputValue()).toBe(expectedValue);
}

function toDoColumn(page: Page) {
  return page.getByRole('region', { name: /^To do/ });
}

function kanbanCard(page: Page, title: string) {
  return page.getByRole('article').filter({ hasText: title });
}

test.afterEach(async ({ page }) => {
  for (const id of createdIds.splice(0)) {
    await page.request.post(`/api/projects/${id}/trash`, { data: {} }).catch(() => undefined);
  }
});

test.describe('drag-free Kanban and Tree actions', () => {
  test('Kanban reorders earlier/later at both ends and changes status by keyboard', async ({
    page,
  }) => {
    await login(page);
    const temp = await createTempProject(page, `E2E drag-free kanban ${Date.now()}`);
    await openHome(page);
    await ensureInboxVisible(page);
    await chooseView(page, 'Kanban');

    const column = toDoColumn(page);
    await expect(column).toBeVisible();
    const cards = column.getByRole('article');
    await expect(cards.last()).toContainText(temp.title);

    // First card: Move earlier is correctly disabled, Move later works.
    const firstTitle = ((await cards.first().locator('a').first().textContent()) ?? '').trim();
    await openCardMenu(page, firstTitle);
    const firstMenu = page.getByRole('menu', { name: `Actions for ${firstTitle}` });
    await expect(firstMenu.getByRole('menuitem', { name: 'Move earlier' })).toBeDisabled();
    await activateMenuItem(page, /^Move later$/);
    await expect(page.getByRole('status').filter({ hasText: `Reordered “${firstTitle}”.` })).toBeVisible();
    await expect(cards.nth(1)).toContainText(firstTitle);

    // Restore the first card.
    await openCardMenu(page, firstTitle);
    await activateMenuItem(page, /^Move earlier$/);
    await expect(cards.first()).toContainText(firstTitle);

    // Last card (the temporary capture): Move later is disabled, Move earlier works.
    await openCardMenu(page, temp.title);
    const tempMenu = page.getByRole('menu', { name: `Actions for ${temp.title}` });
    await expect(tempMenu.getByRole('menuitem', { name: 'Move later' })).toBeDisabled();
    const beforeOrder = await cards.allTextContents();
    await activateMenuItem(page, /^Move earlier$/);
    await expect(page.getByRole('status').filter({ hasText: `Reordered “${temp.title}”.` })).toBeVisible();
    await expect(cards.last()).not.toContainText(temp.title);
    expect(await cards.allTextContents()).not.toEqual(beforeOrder);

    // Move later returns it to the end and is announced too.
    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move later$/);
    await expect(page.getByRole('status').filter({ hasText: `Reordered “${temp.title}”.` })).toBeVisible();
    await expect(cards.last()).toContainText(temp.title);

    // Move to status through the same menu, then back to To do.
    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move to “Done”$/);
    await expect(page.getByRole('status').filter({ hasText: `Moved “${temp.title}” to Done.` })).toBeVisible();
    await expect(kanbanCard(page, temp.title)).toBeVisible();
    const done = await fetchProject(page, temp.id);
    expect(done.statusName).toBe('Done');

    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move to “To do”$/);
    await expect(page.getByRole('status').filter({ hasText: `Moved “${temp.title}” to To do.` })).toBeVisible();
    const restored = await fetchProject(page, temp.id);
    expect(restored.statusName).toBe('To do');
  });

  test('Tree reorders siblings and reparents through the row actions menu', async ({ page }) => {
    await login(page);
    const temp = await createTempProject(page, `E2E drag-free tree ${Date.now()}`);
    await openHome(page);
    await ensureInboxVisible(page);
    await chooseView(page, 'Tree');

    const rows = page.locator('tbody tr');
    const tempRow = rows.filter({ hasText: temp.title });
    await expect(tempRow).toBeVisible();

    // Reorder earlier, then later to restore.
    await openCardMenu(page, temp.title);
    const treeMenu = page.getByRole('menu', { name: `Actions for ${temp.title}` });
    await expect(treeMenu.getByRole('menuitem', { name: 'Move earlier' })).toBeEnabled();
    await expect(treeMenu.getByRole('menuitem', { name: 'Move later' })).toBeDisabled();
    await activateMenuItem(page, /^Move earlier$/);
    await expect(page.getByRole('status').filter({ hasText: `Reordered “${temp.title}”.` })).toBeVisible();
    await expect(rows.last()).not.toContainText(temp.title);

    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move later$/);
    await expect(rows.last()).toContainText(temp.title);

    // Reparent through Move to another project… with the keyboard only.
    const moveInfoResponse = await page.request.get(`/api/projects/${temp.id}/move`);
    expect(moveInfoResponse.status()).toBe(200);
    const moveInfo = (await moveInfoResponse.json()) as {
      destinations: Array<{
        id: string;
        title: string;
        statuses: Array<{ id: string; name: string; isStart: boolean }>;
      }>;
    };
    const household = moveInfo.destinations.find((destination) => destination.title === 'Household');
    if (!household) throw new Error('Household is not a Move destination');
    const householdToDo = household.statuses.find((status) => status.name === 'To do');
    if (!householdToDo) throw new Error('Household has no To do status');

    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move to another project…$/);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Move project' })).toBeVisible();

    const destination = dialog.getByLabel('Destination', { exact: true });
    await expect(destination).toBeVisible();
    const destinationOptions = await destination.locator('option').evaluateAll((options) =>
      options.map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent ?? '' })),
    );
    const householdOption = destinationOptions.find((option) => option.text.endsWith('Household'));
    if (!householdOption) throw new Error('Household option missing from the Move dialog');
    await selectByKeyboard(page, destination, householdOption.value);

    const mapping = dialog.getByLabel('Destination status for the current status', { exact: true });
    await expect(mapping).toBeVisible();
    await selectByKeyboard(page, mapping, householdToDo.id);

    const confirm = dialog.getByRole('button', { name: 'Confirm move' });
    await expect(confirm).toBeEnabled();
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Project moved.' })).toBeVisible();

    const moved = await fetchProject(page, temp.id);
    expect(moved.parent?.id).toBe(household.id);
  });

  test('Card and List reorder with the row actions menu', async ({ page }) => {
    await login(page);
    const temp = await createTempProject(page, `E2E drag-free card-list ${Date.now()}`);
    await openHome(page);
    await ensureInboxVisible(page);

    await chooseView(page, 'Card');
    const cardList = page.getByRole('list', { name: 'Projects as cards' });
    const cards = cardList.locator('article');
    await expect(cards.last()).toContainText(temp.title);

    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move earlier$/);
    await expect(page.getByRole('status').filter({ hasText: `Reordered “${temp.title}”.` })).toBeVisible();
    await expect(cards.last()).not.toContainText(temp.title);

    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move later$/);
    await expect(cards.last()).toContainText(temp.title);

    await chooseView(page, 'List');
    const list = page.getByRole('list', { name: 'Projects checklist' });
    const listRows = list.getByRole('listitem');
    await expect(listRows.last()).toContainText(temp.title);

    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move earlier$/);
    await expect(page.getByRole('status').filter({ hasText: `Reordered “${temp.title}”.` })).toBeVisible();
    await expect(listRows.last()).not.toContainText(temp.title);

    await openCardMenu(page, temp.title);
    await activateMenuItem(page, /^Move later$/);
    await expect(listRows.last()).toContainText(temp.title);
  });

});
