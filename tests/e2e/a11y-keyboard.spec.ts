import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Issue #32 — keyboard navigation and focus order.
 *
 * Covers the shared primitives (skip link, Menu roving/submenu/Tab/Escape,
 * dialog trap/initial focus/focus return), the acceptance smoke (capture,
 * Inbox release, project actions, project settings) and the two focus-ring
 * clipping defects found in the browser audit (sidebar Favorites and the Inbox
 * Tree scrollport).
 *
 * Runs against the seeded household installed by the `first-install` project.
 */

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1100 } });

const PASSWORD = 'kapo1234';

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

async function openProject(page: Page, title: string): Promise<void> {
  await page.goto(`/p/${await projectId(page, title)}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

/** Press Tab until the active element satisfies `match`, or fail. */
async function tabUntil(
  page: Page,
  match: (info: { tag: string; id: string; label: string; text: string }) => boolean,
  max = 80,
): Promise<void> {
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return {
        tag: element?.tagName ?? '',
        id: element?.id ?? '',
        label: element?.getAttribute('aria-label') ?? '',
        text: (element?.textContent ?? '').trim().replace(/\s+/g, ' '),
      };
    });
    if (match(info)) return;
  }
  throw new Error('Tab did not reach the expected element');
}

/** Focus a menu item by moving down the menu with the keyboard. */
async function focusMenuItem(page: Page, name: string, max = 30): Promise<void> {
  for (let index = 0; index < max; index += 1) {
    const label = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element.getAttribute('role') !== 'menuitem') return '';
      return element.getAttribute('aria-label') ?? (element.textContent ?? '').trim();
    });
    if (label.replace(/\s+/g, ' ').includes(name)) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`Menu item "${name}" was not reachable with the arrow keys`);
}

async function activeInsideDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog !== null && dialog.contains(document.activeElement);
  });
}

/** Assert that the element has a visible focus ring that no ancestor clips. */
async function expectRingVisibleAndUnclipped(locator: Locator): Promise<void> {
  const result = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth || '0');
    const offset = Number.parseFloat(style.outlineOffset || '0');
    const rect = element.getBoundingClientRect();
    const ring = {
      left: rect.left - offset - width,
      top: rect.top - offset - width,
      right: rect.right + offset + width,
      bottom: rect.bottom + offset + width,
    };
    const clippedBy: string[] = [];
    let node = element.parentElement;
    while (node && node !== document.documentElement) {
      const parentStyle = getComputedStyle(node);
      const clipX = parentStyle.overflowX !== 'visible';
      const clipY = parentStyle.overflowY !== 'visible';
      if (clipX || clipY) {
        const parentRect = node.getBoundingClientRect();
        const overflows =
          (clipX && (ring.left < parentRect.left - 1 || ring.right > parentRect.right + 1)) ||
          (clipY && (ring.top < parentRect.top - 1 || ring.bottom > parentRect.bottom + 1));
        if (overflows) clippedBy.push(node.tagName.toLowerCase());
      }
      node = node.parentElement;
    }
    return {
      hasOutline: style.outlineStyle !== 'none' && width > 0,
      clippedBy,
    };
  });
  expect(result.hasOutline).toBe(true);
  expect(result.clippedBy).toEqual([]);
}

test.describe('keyboard navigation and focus order', () => {
  test('the skip link is the first tab stop and moves focus to main', async ({ page }) => {
    await login(page);
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Skip to content' });
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toBeFocused();
    await expectRingVisibleAndUnclipped(skipLink);

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('the shared Menu follows the menu button keyboard pattern', async ({ page }) => {
    await login(page);
    await openProject(page, 'Home improvement');

    const trigger = page.getByRole('button', { name: 'Project actions' });
    const menu = page.getByRole('menu', { name: 'Project actions' });
    await trigger.focus();

    // ArrowDown opens at the first item.
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(
      menu.getByRole('menuitemradio', { name: 'Show archived' }),
    ).toBeFocused();

    // Roving arrows, Home and End.
    await page.keyboard.press('ArrowDown');
    await expect(
      menu.getByRole('menuitemradio', { name: 'Show Inbox items' }),
    ).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Project settings' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(
      menu.getByRole('menuitemradio', { name: 'Show archived' }),
    ).toBeFocused();

    // Escape closes and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Enter also opens, and Tab closes the non-modal menu while continuing the
    // document tab order (no focus trap, no focus left on a removed item).
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole('menuitemradio', { name: 'Show archived' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(page.getByLabel('Project status')).toBeFocused();
  });

  test('submenus open with ArrowRight and close with ArrowLeft/Escape', async ({ page }) => {
    await login(page);
    const accountTrigger = page.getByRole('button', { name: /admin/i }).first();
    await accountTrigger.focus();
    await page.keyboard.press('Enter');

    const menu = page.getByRole('menu', { name: 'Account menu' });
    await expect(menu).toBeVisible();
    await focusMenuItem(page, 'Appearance');

    await page.keyboard.press('ArrowRight');
    const submenu = menu.getByRole('menu', { name: 'Appearance' });
    await expect(submenu).toBeVisible();
    await expect(submenu.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(submenu.getByRole('menuitemradio', { name: 'System' })).toBeFocused();

    // ArrowLeft closes only the submenu and returns focus to its trigger.
    await page.keyboard.press('ArrowLeft');
    await expect(submenu).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Appearance' })).toBeFocused();

    // Re-open and Escape: same behaviour, the parent menu stays open.
    await page.keyboard.press('ArrowRight');
    await expect(submenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(submenu).toHaveCount(0);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Appearance' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(accountTrigger).toBeFocused();
  });

  test('dialogs trap Tab, start inside and return focus to the opener', async ({ page }) => {
    await login(page);
    await openProject(page, 'Home improvement');

    const trigger = page.getByRole('button', { name: 'Project actions' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await focusMenuItem(page, 'Move…');
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Move project' })).toBeVisible();
    expect(await activeInsideDialog(page)).toBe(true);

    // Tab never escapes the modal.
    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press('Tab');
      expect(await activeInsideDialog(page)).toBe(true);
    }
    // Shift+Tab wraps backwards inside as well.
    await page.keyboard.press('Shift+Tab');
    expect(await activeInsideDialog(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('trash confirmation is keyboard operable and returns focus', async ({ page }) => {
    await login(page);
    await openProject(page, 'Home improvement');

    const trigger = page.getByRole('button', { name: 'Project actions' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await focusMenuItem(page, 'Move to Trash…');
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Move to Trash?' })).toBeVisible();
    expect(await activeInsideDialog(page)).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('capture and Inbox release work with the keyboard only', async ({ page }) => {
    await login(page);

    const title = `E2E a11y capture ${Date.now()}`;
    const capture = page.getByRole('textbox', { name: /add a project to root/i });
    await capture.focus();
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: `Added "${title}" to Inbox.` }),
    ).toBeVisible();

    await page.goto('/inbox');
    const item = page.getByRole('article').filter({ hasText: title });
    await expect(item).toBeVisible();
    const release = item.getByRole('button', { name: /release to to do/i });
    await release.focus();
    await page.keyboard.press('Enter');
    await expect(item.getByText('Pulled')).toBeVisible();
    await expect(item.getByText(/released — open it to keep working/i)).toBeVisible();
  });

  test('project settings controls are keyboard reachable and focus rings show', async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/p/${await projectId(page, 'Home improvement')}/settings?tab=general`);
    await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();

    const titleInput = page.locator('#settings-title');
    await titleInput.focus();
    await expect(titleInput).toBeFocused();
    await expectRingVisibleAndUnclipped(titleInput);

    const above = page.getByLabel('Above details and properties');
    await above.focus();
    await page.keyboard.press('Space');
    await expect(above).toBeChecked();

    const cancel = page.getByRole('button', { name: 'Cancel' });
    await cancel.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Below details and properties')).toBeChecked();
  });

  test('focus rings are not clipped in Favorites or the Inbox Tree', async ({ page }) => {
    await login(page);

    await tabUntil(page, (info) => info.label === 'Home improvement');
    const favorite = page.getByRole('link', { name: 'Home improvement', exact: true });
    await expect(favorite).toBeFocused();
    await expectRingVisibleAndUnclipped(favorite);

    await page.goto('/inbox');
    const treeSwitch = page.getByRole('button', { name: 'Tree' });
    await treeSwitch.focus();
    await page.keyboard.press('Enter');
    const tree = page.getByRole('region', { name: 'Application tree' });
    await expect(tree).toBeVisible();

    await tabUntil(page, (info) => info.id === 'inbox-tree-select-all');
    const selectAll = page.getByLabel('Select all Inbox captures');
    await expect(selectAll).toBeFocused();
    await expectRingVisibleAndUnclipped(selectAll);
  });

  test('mobile Add dialog and Favorites menu are keyboard operable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const add = page.getByRole('button', { name: 'Add a project to Root' });
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await activeInsideDialog(page)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await activeInsideDialog(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();

    const favorites = page.getByRole('button', { name: 'Favorites' });
    await favorites.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Favorites' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(favorites).toBeFocused();
  });
});
