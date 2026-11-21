import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Issue #33 — screen-reader labels, landmarks and live announcements.
 *
 * Audits the shared shell, capture, Inbox Card/Tree, project views and
 * settings, dialogs, tables and async status regions with role/name/description
 * assertions. Runs against the seeded household installed by `first-install`.
 *
 * Deliberately read-only except for projects created by this spec, so the other
 * e2e suites keep the seeded household intact.
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

async function capture(page: Page, title: string): Promise<void> {
  const input = page.getByRole('textbox', { name: /add a project to root/i });
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('status')).toContainText(`Added "${title}" to Inbox.`);
}

/** Exactly one main landmark on every screen. */
async function expectOneMain(page: Page): Promise<void> {
  await expect(page.locator('main')).toHaveCount(1);
}

/** Every nav/aside has an accessible name (issue #33 landmark audit). */
async function expectNamedLandmarks(page: Page): Promise<void> {
  const unnamed = await page.evaluate(() => {
    const nameFor = (element: Element): string => {
      const label = element.getAttribute('aria-label')?.trim();
      if (label) return label;
      const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? [];
      return ids
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();
    };
    return Array.from(document.querySelectorAll('nav, aside'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return nameFor(element).length === 0;
      })
      .map((element) => element.tagName.toLowerCase());
  });
  expect(unnamed).toEqual([]);
}

/** One h1, no skipped heading levels in DOM order. */
async function expectHeadingOrder(page: Page): Promise<void> {
  const levels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) =>
      Number(heading.tagName.slice(1)),
    ),
  );
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1] ?? 1;
    const current = levels[index] ?? 1;
    expect(
      current - previous,
      `heading level jumped from h${previous} to h${current}`,
    ).toBeLessThanOrEqual(1);
  }
}

/**
 * Every visible form control has a programmatic name: aria-label,
 * aria-labelledby, a <label for>, a wrapping <label>, or title.
 */
async function expectLabelledControls(page: Page): Promise<void> {
  const unlabelled = await page.evaluate(() => {
    const nameFor = (element: HTMLElement): string => {
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? [];
      const fromIds = ids
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      if (fromIds) return fromIds;
      const labels = Array.from(document.querySelectorAll('label'));
      const forLabel = labels.find(
        (label) => label.htmlFor.length > 0 && label.htmlFor === element.id,
      );
      if (forLabel?.textContent?.trim()) return forLabel.textContent.trim();
      const wrapping = element.closest('label');
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
      return element.getAttribute('title')?.trim() ?? '';
    };
    return Array.from(
      document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea'),
    )
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (element.getAttribute('aria-hidden') === 'true') return false;
        return nameFor(element).length === 0;
      })
      .map((element) => {
        const type = element.getAttribute('type');
        return `${element.tagName.toLowerCase()}${type ? `[type=${type}]` : ''}${
          element.id ? `#${element.id}` : ''
        }`;
      });
  });
  expect(unlabelled).toEqual([]);
}

/** Icon-only buttons and links keep an accessible name (issue #33). */
async function expectNamedIconButtons(page: Page): Promise<void> {
  const unnamed = await page.evaluate(() => {
    const nameFor = (element: Element): string => {
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? [];
      const fromIds = ids
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      if (fromIds) return fromIds;
      let text = '';
      for (const node of Array.from(element.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
        else if (node instanceof HTMLElement && !node.classList.contains('material-symbols-outlined')) {
          text += node.textContent ?? '';
        }
      }
      return text.trim() || (element.getAttribute('title')?.trim() ?? '');
    };
    return Array.from(document.querySelectorAll<HTMLElement>('button, a'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return nameFor(element).length === 0;
      })
      .map((element) => `${element.tagName.toLowerCase()}:${element.className}`);
  });
  expect(unnamed).toEqual([]);
}

/** Decorative glyphs are hidden; named glyphs expose role="img". */
async function expectIconsAccessible(page: Page): Promise<void> {
  const broken = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.material-symbols-outlined'))
      .filter((icon) => {
        if (icon.getAttribute('aria-hidden') === 'true') return false;
        return !(
          icon.getAttribute('role') === 'img' && icon.getAttribute('aria-label')?.trim()
        );
      })
      .map((icon) => (icon.textContent ?? '').trim()),
  );
  expect(broken).toEqual([]);
}

async function expectPageAudit(page: Page): Promise<void> {
  await expectOneMain(page);
  await expectNamedLandmarks(page);
  await expectHeadingOrder(page);
  await expectLabelledControls(page);
  await expectNamedIconButtons(page);
  await expectIconsAccessible(page);
}

test.describe('labels, landmarks and announcements', () => {
  test('auth screens name the main landmark, form and required fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Username')).toHaveAttribute('required', '');
    await expect(page.getByLabel('Password')).toHaveAttribute('required', '');
    await expectPageAudit(page);

    // The first-install setup screen routes to /login once an account exists;
    // its form is covered by the first-install spec and shares the same Field
    // association logic exercised here.
  });

  test('shell exposes main, banner, named nav/aside and a labelled capture form', async ({
    page,
  }) => {
    await login(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Add a project to Root' })).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: /add a project to root/i }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
    await expect(page.getByRole('button', { name: /admin/i })).toBeVisible();

    // Menus keep a name and their selected options are radio items.
    await page.getByRole('button', { name: /admin/i }).click();
    const menu = page.getByRole('menu', { name: 'Account menu' });
    await expect(menu).toBeVisible();
    const appearanceItem = menu.getByRole('menuitem', { name: 'Appearance' });
    await appearanceItem.focus();
    await page.keyboard.press('ArrowRight');
    const appearance = menu.getByRole('menu', { name: 'Appearance' });
    await expect(appearance.getByRole('menuitemradio', { name: 'Light' })).toBeVisible();
    await expect(appearance.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expectPageAudit(page);
  });

  test('capture announcement is a status region and repeated captures re-announce', async ({
    page,
  }) => {
    await login(page);
    const stamp = Date.now();
    const title = `E2E a11y repeat ${stamp}`;
    const form = page.getByRole('form', { name: 'Add a project to Root' });

    await form.getByRole('textbox').fill(title);
    await form.getByRole('textbox').press('Enter');
    const live = form.locator('[data-live-region]');
    await expect(live).toHaveText(`Added "${title}" to Inbox.`);
    await expect(live).toHaveAttribute('data-live-sequence', '1');

    // Same title again inside the toast window: the keyed live region remounts
    // with a new sequence instead of silently keeping an unchanged text node.
    await form.getByRole('textbox').fill(title);
    await form.getByRole('textbox').press('Enter');
    await expect(live).toHaveAttribute('data-live-sequence', '2');
    await expect(live).toHaveText(`Added "${title}" to Inbox.`);
  });

  test('mobile Add announces success after its dialog closes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    const title = `E2E a11y mobile ${Date.now()}`;

    await page.getByRole('button', { name: 'Add a project to Root' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a project' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Project title').fill(title);
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(dialog).toHaveCount(0);

    // The form unmounted with the dialog; the shell's persistent live region
    // still announces the created project.
    await expect(page.getByRole('status')).toContainText(`Added "${title}" to Inbox.`);
  });

  test('Inbox Card view labels the list, cards, controls and release result', async ({
    page,
  }) => {
    await login(page);
    const title = `E2E a11y inbox ${Date.now()}`;
    await capture(page, title);
    await page.goto('/inbox');

    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    const list = page.getByRole('list', { name: 'Projects in the Inbox' });
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute('aria-describedby', 'inbox-card-drag-hint');

    const card = page.getByRole('article').filter({ hasText: title });
    await expect(card.getByRole('heading', { level: 2, name: title })).toBeVisible();
    await expect(card.getByRole('button', { name: /release to/i })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Change parent' })).toBeVisible();
    await expect(card.getByRole('link', { name: `Open ${title}` })).toBeVisible();
    await expectPageAudit(page);

    // Releasing announces the result through a single status region and the
    // card keeps a textual (not colour-only) Pulled state.
    await card.getByRole('button', { name: /release to/i }).click();
    await expect(page.locator('[data-live-region]')).toHaveText(
      new RegExp(`Released “${title}” to .+\\.`),
    );
    await expect(card.getByText('Pulled')).toBeVisible();
    await expect(card.getByText(/released — open it to keep working/i)).toBeVisible();
  });

  test('Inbox Tree is a captioned table with row headers and drag descriptions', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/inbox');
    await page.getByRole('button', { name: 'Tree' }).click();

    const tree = page.getByRole('region', { name: 'Application tree' });
    const table = tree.getByRole('table', { name: 'Application projects' });
    await expect(table).toBeVisible();
    await expect(table.locator('caption')).toHaveText(
      /Application projects and Inbox captures/,
    );
    await expect(tree.getByRole('heading', { level: 2, name: 'Application tree' })).toBeVisible();

    const row = table.getByRole('row', { name: /Renovate basement/ });
    await expect(row).toBeVisible();
    await expect(row.getByRole('rowheader', { name: /Renovate basement/ })).toBeVisible();
    await expect(row.getByRole('checkbox', { name: 'Select Renovate basement' })).toBeVisible();
    await expect(table.getByRole('checkbox', { name: 'Select all Inbox captures' })).toBeVisible();
    await expect(row).toHaveAttribute('aria-describedby', 'inbox-tree-drag-hint');
    await expect(page.getByText(/Drop one on another row’s middle/i)).toBeVisible();
    await expectPageAudit(page);
  });

  test('project page and Tree view expose structure, headings and dialog names', async ({
    page,
  }) => {
    await login(page);
    await openProject(page, 'Home improvement');

    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Child projects' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Activity' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Project actions' })).toBeVisible();
    await expectPageAudit(page);

    // Move dialog: named, described and every control labelled.
    await page.getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('menuitem', { name: 'Move…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Move project' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeVisible();
    await expect(dialog.getByLabel('Destination', { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('combobox', {
        name: 'Destination status for the current status',
      }),
    ).toBeVisible();
    await expect(dialog.locator('[aria-label="Close dialog"]')).toBeVisible();
    const unlabelledInDialog = await dialog.evaluate((element) => {
      const fields = Array.from(
        element.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea'),
      );
      return fields.filter(
        (field) =>
          !field.getAttribute('aria-label') &&
          !field.getAttribute('aria-labelledby') &&
          !Array.from(document.querySelectorAll('label')).some(
            (label) => label.htmlFor && label.htmlFor === field.id,
          ),
      ).length;
    });
    expect(unlabelledInDialog).toBe(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Tree view is a captioned table with row headers.
    await page.getByRole('button', { name: /Collection view:/ }).click();
    await page.getByRole('menuitemradio', { name: 'Tree' }).click();
    const table = page.getByRole('table', { name: 'Child projects' });
    await expect(table).toBeVisible();
    await expect(table.locator('caption')).toHaveText(/Child projects with status/);
    const paintRow = table.getByRole('row', { name: /Paint hallway/ });
    await expect(paintRow.getByRole('rowheader', { name: /Paint hallway/ })).toBeVisible();
    await expect(paintRow).toHaveAttribute('aria-describedby', 'tree-drag-hint');
    await expectPageAudit(page);

    // Restore the seeded default so the other suites see Kanban.
    await page.getByRole('button', { name: /Collection view:/ }).click();
    await page.getByRole('menuitemradio', { name: 'Kanban' }).click();
    await expect(
      page.getByRole('list', { name: 'Kanban columns' }),
    ).toBeVisible();
  });

  test('project settings label fields, required state and radio/check groups', async ({
    page,
  }) => {
    await login(page);
    const id = await projectId(page, 'Home improvement');
    await page.goto(`/p/${id}/settings?tab=general`);
    await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project settings sections' })).toBeVisible();
    await expect(page.locator('#settings-title')).toHaveAttribute('required', '');

    await page.goto(`/p/${id}/settings?tab=layout`);
    await expect(page.getByRole('heading', { level: 1, name: 'Layout' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Project view appears' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Below details and properties' })).toBeChecked();
    const viewRadios = page.getByRole('radio', { name: /details and properties/ });
    await expect(viewRadios.nth(0)).toHaveAccessibleName('Above details and properties');
    await expect(viewRadios.nth(1)).toHaveAccessibleName('Below details and properties');
    await expectPageAudit(page);

    // Field errors are associated and announced (invalid username is a local
    // server rejection; the Users dialog validates client-side first).
    await page.goto('/users');
    await expect(page.getByRole('heading', { level: 1, name: 'User management' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Accounts' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Application role for/i }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Add user' }).click();
    const userDialog = page.getByRole('dialog', { name: 'Add user' });
    await expect(userDialog).toBeVisible();
    await expect(userDialog.getByRole('form', { name: 'Add user' })).toBeVisible();
    await userDialog.getByRole('button', { name: 'Create user' }).click();
    await expect(userDialog.getByText('Enter a username.')).toBeVisible();
    const username = userDialog.getByLabel('Username');
    await expect(username).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await username.getAttribute('aria-describedby');
    const errorId = await userDialog.getByText('Enter a username.').getAttribute('id');
    expect(describedBy).toBeTruthy();
    expect(errorId).toBeTruthy();
    expect(describedBy?.split(/\s+/)).toContain(errorId);
    await page.keyboard.press('Escape');
    await expectPageAudit(page);
  });

  test('application settings, profile and search forms are grouped and labelled', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Application settings' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Application settings' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Views available to projects' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Backups' })).toBeVisible();
    await expect(page.getByLabel('Default account role')).toBeVisible();
    await expectPageAudit(page);

    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Account profile' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByLabel('Username')).toHaveAttribute('required', '');
    await expect(page.getByRole('button', { name: 'Change picture' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
    await expectPageAudit(page);

    await page.goto('/search');
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Search sections' })).toBeVisible();
    await expect(page.getByRole('search', { name: 'Search projects' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search projects' })).toBeVisible();
    await expectPageAudit(page);

    await page.goto('/search?tab=trash');
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();
    await expect(page.getByRole('search', { name: 'Filter trashed projects' })).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Filter trashed projects' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trash is empty' })).toBeVisible();
    await expectPageAudit(page);
  });

  test('dashboard toasts re-announce the same message after a second save', async ({ page }) => {
    await login(page);
    const toast = page.locator('[data-toast]');

    await page.getByRole('button', { name: 'Edit dashboard' }).click();
    await page.getByRole('button', { name: 'Save dashboard' }).click();
    await expect(toast).toHaveAttribute('data-toast', 'success');
    await expect(toast).toHaveAttribute('data-live-sequence', '1');
    await expect(toast.locator('[data-toast-message]')).toHaveText('Dashboard saved.');

    await page.getByRole('button', { name: 'Edit dashboard' }).click();
    await page.getByRole('button', { name: 'Save dashboard' }).click();
    await expect(toast).toHaveAttribute('data-live-sequence', '2');
    await expect(toast.locator('[data-toast-message]')).toHaveText('Dashboard saved.');
  });
});
