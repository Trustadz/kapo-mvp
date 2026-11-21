import { expect, test, type Page } from '@playwright/test';

/**
 * Assignee add-on journey (issue #7, docs/add-ons.md §12) through the generic
 * field-slot model.
 *
 * Add-on fields are placed in Details, Properties and a view like any core
 * field. There is no standalone Add-ons card; editing happens in a small dialog
 * opened from the field row. Unavailable add-ons hide their slots and values
 * without deleting either.
 */

const PASSWORD = 'kapo1234';
const ASSIGNEE_OPTION = 'Assignee · Assigned to';

test.describe.configure({ mode: 'serial' });

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

async function userId(page: Page, username: string): Promise<string> {
  const response = await page.request.get('/api/users');
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    users: Array<{ id: string; username: string }>;
  };
  const hit = payload.users.find((user) => user.username === username);
  if (!hit) throw new Error(`User "${username}" not found`);
  return hit.id;
}

async function setAddonMode(page: Page, mode: 'Available' | 'Unavailable'): Promise<void> {
  await page.goto('/settings');
  const group = page.getByRole('group', { name: /Assignee/i });
  await expect(group).toBeVisible();
  const radio = group.getByRole('radio', { name: new RegExp(`^${mode}`) });
  if (!(await radio.isChecked())) await radio.check();
  const save = page.getByRole('button', { name: 'Save changes' });
  // The form disables Save when the selected mode already matches. Re-running
  // the journey on the seeded default ("Available") must not wait forever.
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByRole('status')).toContainText('Application settings saved.');
  }
}

async function enableForProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/p/${projectId}/settings?tab=addons`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add-ons' })).toBeVisible();
  const enable = page.getByLabel('Enable for this project');
  if (!(await enable.isChecked())) await enable.check();
  await page.getByRole('button', { name: 'Save add-ons' }).click();
  await expect(page.getByRole('status')).toContainText('Project add-ons saved.');
}

async function addLayoutFields(page: Page, projectId: string): Promise<void> {
  await page.goto(`/p/${projectId}/settings?tab=layout`);
  await expect(page.getByRole('heading', { level: 1, name: 'Layout' })).toBeVisible();

  const mainSelect = page.getByRole('combobox', { name: 'Add a field to Main area' });
  if ((await mainSelect.count()) > 0 && (await mainSelect.isVisible())) {
    await mainSelect.selectOption({ label: ASSIGNEE_OPTION });
  }
  const sidebarSelect = page.getByRole('combobox', { name: 'Add a field to Properties sidebar' });
  if ((await sidebarSelect.count()) > 0 && (await sidebarSelect.isVisible())) {
    await sidebarSelect.selectOption({ label: ASSIGNEE_OPTION });
  }
  await page
    .getByRole('combobox', { name: 'Add a property to Kanban' })
    .selectOption({ label: ASSIGNEE_OPTION });

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Layout settings saved.');
}

async function editAssignee(page: Page, card: ReturnType<Page['locator']>): Promise<void> {
  await card.getByRole('button', { name: 'Assign Assigned to' }).click();
  const listbox = page.getByRole('listbox', { name: 'People' });
  await expect(listbox).toBeVisible();
  await page.getByRole('combobox', { name: 'Search people' }).fill('may');
  await expect(listbox.locator('[title="Maya"]')).toHaveCount(1);
  await listbox.getByRole('option', { name: 'Maya' }).click();
  await expect(page.getByRole('status')).toContainText('Add-on saved.');
  await expect(listbox).toBeHidden();
}


/** Restore the seeded Home layout/value so later specs don't see add-on meta. */
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, 'admin');
  const homeId = await findProjectId(page, 'Home improvement');
  const childId = await findProjectId(page, 'Paint hallway');
  await page.request.put(`/api/projects/${homeId}/settings`, {
    data: {
      layout_template: null,
      view_fields: { kanban: [], card: [], tree: ['status'], list: [] },
    },
  });
  for (const projectId of [homeId, childId]) {
    await page.request.patch(`/api/projects/${projectId}/addons/assignee`, {
      data: { values: { assignee: null } },
    });
  }
  await page.request.put('/api/settings', {
    data: { addons: { assignee: { mode: 'always' } } },
  });
  await page.close();
});

test.describe('Assignee add-on as a real layout field', () => {
  test('places add-on fields in Details, Properties and a view; edits inline', async ({
    page,
  }) => {
    await login(page, 'admin');
    await setAddonMode(page, 'Available');

    const homeId = await findProjectId(page, 'Home improvement');
    const mayaId = await userId(page, 'maya');
    await enableForProject(page, homeId);
    await addLayoutFields(page, homeId);

    // The standalone card is gone; only the layout rows remain.
    await page.goto(`/p/${homeId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Add-ons' })).toHaveCount(0);
    const details = page.locator('section[aria-labelledby="details-heading"]');
    const properties = page.locator('aside[aria-labelledby="properties-heading"]');
    await expect(details.getByText('Assigned to', { exact: true })).toBeVisible();
    await expect(properties.getByText('Assigned to', { exact: true })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Assign Assigned to' })).toBeVisible();
    await expect(properties.getByRole('button', { name: 'Assign Assigned to' })).toBeVisible();

    // Details and Properties share the same add-on value: edit once here.
    await editAssignee(page, details);
    await expect(details.getByText('Maya', { exact: true })).toBeVisible();
    await expect(properties.getByText('Maya', { exact: true })).toBeVisible();

    // Persisted after a full reload.
    await page.reload();
    await expect(details.getByText('Maya', { exact: true })).toBeVisible();

    const pageResponse = await page.request.get(`/api/projects/${homeId}`);
    const pagePayload = (await pageResponse.json()) as {
      addons: { items: Array<{ identifier: string; values: Record<string, unknown> }> };
    };
    expect(pagePayload.addons.items[0]?.values.assignee).toBe(mayaId);

    // Set the child's assignee through the inherited field row, then verify the
    // compact add-on field in the Kanban meta row.
    const childId = await findProjectId(page, 'Paint hallway');
    await page.goto(`/p/${childId}`);
    await editAssignee(page, page.locator('section[aria-labelledby="details-heading"]'));

    await page.goto(`/p/${homeId}`);
    const childCard = page.getByRole('article').filter({ hasText: 'Paint hallway' });
    await expect(childCard.getByText('Assigned to: Maya')).toBeVisible();
    await expect(childCard.locator('[title="Maya"]')).toBeVisible();

    // Making the add-on globally unavailable hides every slot safely; the
    // stored layout refs and value survive and return when it is available.
    await setAddonMode(page, 'Unavailable');
    await page.goto(`/p/${homeId}`);
    await expect(page.getByText('Assigned to', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Assigned to: Maya')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Assigned to' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Add-ons' })).toHaveCount(0);

    await setAddonMode(page, 'Available');
    await page.goto(`/p/${homeId}`);
    await expect(details.getByText('Maya', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('article').filter({ hasText: 'Paint hallway' }).getByText('Assigned to: Maya'),
    ).toBeVisible();
  });

  test('read-only viewers see add-on values without Edit controls', async ({ page }) => {
    await login(page, 'alex');
    const homeId = await findProjectId(page, 'Home improvement');
    await page.goto(`/p/${homeId}`);
    const details = page.locator('section[aria-labelledby="details-heading"]');
    const properties = page.locator('aside[aria-labelledby="properties-heading"]');
    await expect(details.getByText('Maya', { exact: true })).toBeVisible();
    await expect(properties.getByText('Maya', { exact: true })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Assign Assigned to' })).toHaveCount(0);
    await expect(properties.getByRole('button', { name: 'Assign Assigned to' })).toHaveCount(0);
  });

  test('layout field selectors hide unavailable add-on fields', async ({ page }) => {
    await login(page, 'admin');
    const homeId = await findProjectId(page, 'Home improvement');
    await setAddonMode(page, 'Unavailable');
    await page.goto(`/p/${homeId}/settings?tab=layout`);
    await expect(page.getByRole('heading', { level: 1, name: 'Layout' })).toBeVisible();
    await expect(page.getByRole('option', { name: ASSIGNEE_OPTION })).toHaveCount(0);
    await expect(page.getByText('Assigned to', { exact: true })).toHaveCount(0);

    await setAddonMode(page, 'Available');
    await page.goto(`/p/${homeId}/settings?tab=layout`);
    // The field is already placed in Details/Properties/Kanban; Card still has
    // an empty slot list, so its selector must offer the add-on field.
    await expect(
      page
        .getByRole('combobox', { name: 'Add a property to Card' })
        .getByRole('option', { name: ASSIGNEE_OPTION }),
    ).toBeAttached();
  });
});
