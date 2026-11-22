import { expect, test, type Page } from '@playwright/test';

/**
 * Application settings tabs, draft preservation and the add-on mode dropdown.
 *
 * - tablist/tab/tabpanel semantics with Arrow/Home/End navigation;
 * - switching tabs never discards an edit;
 * - General and Backups each submit only their own fields and clear only their
 *   own dirty state;
 * - the add-on card uses a Select (not radios) and a quiet empty-settings note.
 */

const PASSWORD = 'kapo1234';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

test.describe.configure({ mode: 'serial' });

test('tabs expose tab semantics and Arrow/Home/End navigation', async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  const tablist = page.getByRole('tablist', { name: 'Application settings sections' });
  await expect(tablist).toBeVisible();

  const generalTab = page.getByRole('tab', { name: 'General' });
  const backupsTab = page.getByRole('tab', { name: 'Backups' });
  const addonsTab = page.getByRole('tab', { name: 'Add-ons' });
  const usersTab = page.getByRole('tab', { name: 'Users' });

  await expect(generalTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'General' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Backups' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Add-ons' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Users' })).toHaveCount(0);

  await generalTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(backupsTab).toBeFocused();
  await expect(backupsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Backups' })).toBeVisible();

  await page.keyboard.press('End');
  await expect(usersTab).toBeFocused();
  await expect(usersTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Users' })).toBeVisible();

  await page.keyboard.press('Home');
  await expect(generalTab).toBeFocused();
  await expect(generalTab).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowLeft');
  await expect(usersTab).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(addonsTab).toBeFocused();

  // Automatic activation moves focus and selection together, and the focus
  // ring is visible (not clipped by the tab strip).
  const ring = await addonsTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth || '0'),
    };
  });
  expect(ring.outlineStyle).not.toBe('none');
  expect(ring.outlineWidth).toBeGreaterThan(0);

  // Roving tabindex: only the active tab is in the document tab order.
  await expect(generalTab).toHaveAttribute('tabindex', '-1');
  await expect(backupsTab).toHaveAttribute('tabindex', '-1');
  await expect(usersTab).toHaveAttribute('tabindex', '-1');
  await expect(addonsTab).toHaveAttribute('tabindex', '0');

  // Each tab carries a decorative icon.
  await expect(tablist.locator('.material-symbols-outlined')).toHaveCount(4);
});

test('switching tabs keeps drafts and each tab saves only its own fields', async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  const generalForm = page.getByRole('form', { name: 'General application settings' });
  const backupsForm = page.getByRole('form', { name: 'Backup settings' });

  const retentionInput = generalForm.locator('#settings-trash-retention');
  const originalRetention = await retentionInput.inputValue();
  const draftRetention = originalRetention === '30' ? '29' : '30';
  await retentionInput.fill(draftRetention);

  await page.getByRole('tab', { name: 'Backups' }).click();
  const startInput = backupsForm.locator('#settings-backup-start');
  const originalStartTime = await startInput.inputValue();
  const draftStartTime = originalStartTime === '04:45' ? '04:46' : '04:45';
  await startInput.fill(draftStartTime);

  // Switching back must not discard either draft.
  await page.getByRole('tab', { name: 'General' }).click();
  await expect(retentionInput).toHaveValue(draftRetention);

  const generalRequest = page.waitForRequest(
    (request) => request.url().includes('/api/settings') && request.method() === 'PUT',
  );
  await generalForm.getByRole('button', { name: 'Save changes' }).click();
  const request = await generalRequest;
  const body = request.postDataJSON() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual([
    'defaultAccountRole',
    'enabledViews',
    'mcpEnabled',
    'trashPurgeEnabled',
    'trashRetentionDays',
  ]);
  expect(body.trashRetentionDays).toBe(Number(draftRetention));
  await expect(page.getByRole('status')).toContainText('Application settings saved.');
  // The saved General tab is no longer dirty.
  await expect(generalForm.getByText('Unsaved changes')).toHaveCount(0);

  // The Backups draft survived the General save and is still dirty.
  await page.getByRole('tab', { name: 'Backups' }).click();
  await expect(startInput).toHaveValue(draftStartTime);
  await expect(backupsForm.getByText('Unsaved changes')).toBeVisible();
  await backupsForm.getByRole('button', { name: 'Cancel' }).click();
  await expect(startInput).toHaveValue(originalStartTime);
  await expect(backupsForm.getByText('Unsaved changes')).toHaveCount(0);

  // Restore the General value so the spec leaves the seeded household intact.
  await page.getByRole('tab', { name: 'General' }).click();
  await retentionInput.fill(originalRetention);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/api/settings') && response.request().method() === 'PUT',
    ),
    generalForm.getByRole('button', { name: 'Save changes' }).click(),
  ]);
  await expect(page.getByRole('status')).toContainText('Application settings saved.');
});

test('add-on cards use a mode dropdown and a quiet empty-settings area', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  const addonsTab = page.getByRole('tab', { name: 'Add-ons' });
  await addonsTab.click();

  const card = page.getByRole('region', { name: /Assignee/i });
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { level: 3, name: /Assignee/ })).toContainText('v1.0.0');
  await expect(card.getByText('Assign a project to one household member.')).toBeVisible();
  await expect(card.getByText('No additional settings for this add-on.')).toBeVisible();
  await expect(card.getByRole('radio')).toHaveCount(0);
  await expect(card.getByRole('radiogroup')).toHaveCount(0);

  const mode = card.getByRole('combobox', { name: 'Availability' });
  await expect(mode).toHaveValue('always');
  await expect(mode.locator('option')).toHaveText([
    'Required',
    'Always on',
    'Available',
    'Unavailable',
  ]);

  await mode.selectOption('unavailable');
  await expect(addonsTab).toHaveAttribute('data-dirty', 'true');
  await expect(
    card.getByText('Existing values are kept and hidden.'),
  ).toBeVisible();

  const addonsRequest = page.waitForRequest(
    (request) => request.url().includes('/api/settings') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save add-ons' }).click();
  const request = await addonsRequest;
  expect(request.postDataJSON()).toEqual({ addons: { assignee: { mode: 'unavailable' } } });
  await expect(page.getByRole('status')).toContainText('Application settings saved.');
  await expect(addonsTab).not.toHaveAttribute('data-dirty', 'true');

  // Persisted after a full reload.
  await page.reload();
  await page.getByRole('tab', { name: 'Add-ons' }).click();
  const reloadedCard = page.getByRole('region', { name: /Assignee/i });
  await expect(reloadedCard.getByRole('combobox', { name: 'Availability' })).toHaveValue(
    'unavailable',
  );

  // Restore the product default (Always on) for the rest of the suite.
  await reloadedCard.getByRole('combobox', { name: 'Availability' }).selectOption('always');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/api/settings') && response.request().method() === 'PUT',
    ),
    page.getByRole('button', { name: 'Save add-ons' }).click(),
  ]);
  await expect(page.getByRole('status')).toContainText('Application settings saved.');
});

test('Users tab manages accounts and is no longer in the account menu', async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  await page.getByRole('tab', { name: 'Users' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Users' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { level: 2, name: 'Users' })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Accounts' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add user' })).toBeVisible();
  // The full /users page's Cancel link is hidden when embedded in settings.
  await expect(panel.getByRole('link', { name: 'Cancel' })).toHaveCount(0);

  await page.getByRole('button', { name: /admin/i }).first().click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Users' })).toHaveCount(0);
});
