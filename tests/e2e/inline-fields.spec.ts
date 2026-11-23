import { expect, test, type Page } from '@playwright/test';

/**
 * Inline editing on the project page (issue: inline field editors).
 *
 * Covers the in-place title, every generic add-on field type through the
 * e2e-only `e2e-fields` fixture add-on, longtext Markdown edit/preview/render,
 * immediate user-picker saves and Viewer read-only behaviour. The fixture is
 * registered only when Playwright starts the server with KAPO_E2E_ADDONS=1.
 */

const PASSWORD = 'kapo1234';
const FIXTURE = 'e2e-fields';
const FIELD_KEYS = ['notes', 'summary', 'estimate', 'due', 'flagged', 'category', 'reviewer'];

function fixtureRef(key: string): string {
  return `addon:${FIXTURE}:${key}`;
}

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

async function setLayout(
  page: Page,
  projectId: string,
  main: string[],
  sidebar: string[],
): Promise<void> {
  const response = await page.request.put(`/api/projects/${projectId}/settings`, {
    data: { layout_template: { main, sidebar } },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function clearFixtureValues(page: Page, projectId: string): Promise<void> {
  const values = Object.fromEntries(FIELD_KEYS.map((key) => [key, null]));
  const response = await page.request.patch(`/api/projects/${projectId}/addons/${FIXTURE}`, {
    data: { values },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function configureFixtureLayout(page: Page, projectId: string): Promise<void> {
  await setLayout(
    page,
    projectId,
    FIELD_KEYS.map(fixtureRef),
    ['status', 'reporter', fixtureRef('notes')],
  );
  await clearFixtureValues(page, projectId);
}

async function fixtureValues(page: Page, projectId: string): Promise<Record<string, unknown>> {
  const response = await page.request.get(`/api/projects/${projectId}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    addons: { items: Array<{ identifier: string; values: Record<string, unknown> }> };
  };
  return payload.addons.items.find((item) => item.identifier === FIXTURE)?.values ?? {};
}

async function openHome(page: Page): Promise<{ homeId: string; details: ReturnType<Page['locator']> }> {
  const homeId = await findProjectId(page, 'Home improvement');
  await page.goto(`/p/${homeId}`);
  const details = page.locator('section[aria-labelledby="details-heading"]');
  await expect(details).toBeVisible();
  return { homeId, details };
}

async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: 'Add-on saved.' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await login(page, 'admin');
  const homeId = await findProjectId(page, 'Home improvement');
  await configureFixtureLayout(page, homeId);
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, 'admin');
  const homeId = await findProjectId(page, 'Home improvement');
  await page.request.patch(`/api/projects/${homeId}`, { data: { title: 'Home improvement' } });
  await page.request.put(`/api/projects/${homeId}/settings`, {
    data: { layout_template: null },
  });
  await clearFixtureValues(page, homeId);
  await page.close();
});

test('edits the project title in place with Enter, blur, Escape and unchanged-value guards', async ({
  page,
}) => {
  const { homeId } = await openHome(page);
  let titlePatches = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === `/api/projects/${homeId}`
    ) {
      titlePatches += 1;
    }
  });

  const originalTitle = 'Home improvement';
  const heading = page.getByRole('heading', { level: 1, name: originalTitle });

  // Escape cancels without sending a request.
  await heading.getByRole('button', { name: originalTitle }).click();
  const input = page.getByRole('textbox', { name: 'Project title' });
  await expect(input).toHaveValue(originalTitle);
  await input.fill('Do not save this');
  await input.press('Escape');
  await expect(page.getByRole('heading', { level: 1, name: originalTitle })).toBeVisible();

  // Enter on an unchanged value closes the editor without a request.
  await page.getByRole('heading', { level: 1, name: originalTitle }).getByRole('button').click();
  await page.getByRole('textbox', { name: 'Project title' }).press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: originalTitle })).toBeVisible();
  await page.waitForTimeout(250);
  expect(titlePatches).toBe(0);

  // Enter saves and the heading updates.
  const renamed = 'Home improvement inline';
  await page.getByRole('heading', { level: 1, name: originalTitle }).getByRole('button').click();
  const saveInput = page.getByRole('textbox', { name: 'Project title' });
  await saveInput.fill(renamed);
  const patchDone = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === `/api/projects/${homeId}`,
  );
  await saveInput.press('Enter');
  await patchDone;
  await expect(page.getByRole('status').filter({ hasText: 'Project title saved.' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();

  // Persisted after a full reload.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();

  // Blur also saves (clicking the Details heading leaves the input).
  const blurred = 'Home improvement blur';
  await page.getByRole('heading', { level: 1, name: renamed }).getByRole('button').click();
  const blurInput = page.getByRole('textbox', { name: 'Project title' });
  await blurInput.fill(blurred);
  await page.getByRole('heading', { level: 2, name: 'Details' }).click();
  await expect(page.getByRole('heading', { level: 1, name: blurred })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Project title saved.' })).toBeVisible();

  // Restore the shared fixture title for the rest of the suite.
  await page.request.patch(`/api/projects/${homeId}`, { data: { title: originalTitle } });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: originalTitle })).toBeVisible();
});

test('edits every generic add-on field type inline', async ({ page }) => {
  const { homeId, details } = await openHome(page);

  // text: Enter saves.
  await details.getByRole('button', { name: 'Set Summary' }).click();
  await details.getByRole('textbox', { name: 'Summary' }).fill('Inspect basement');
  await details.getByRole('textbox', { name: 'Summary' }).press('Enter');
  await expectSaved(page);
  await expect(details.getByText('Inspect basement', { exact: true })).toBeVisible();

  // text: Escape cancels and the displayed value stays put.
  await details.getByRole('button', { name: 'Edit Summary' }).click();
  await details.getByRole('textbox', { name: 'Summary' }).fill('Discard this');
  await details.getByRole('textbox', { name: 'Summary' }).press('Escape');
  await expect(details.getByText('Inspect basement', { exact: true })).toBeVisible();
  await expect(details.getByText('Discard this')).toHaveCount(0);

  // number: valid value saves.
  await details.getByRole('button', { name: 'Set Estimate' }).click();
  await details.getByRole('spinbutton', { name: 'Estimate' }).fill('3');
  await details.getByRole('spinbutton', { name: 'Estimate' }).press('Enter');
  await expectSaved(page);
  await expect(details.getByText('3', { exact: true })).toBeVisible();

  // number: a server field error reverts the old value and is announced.
  await details.getByRole('button', { name: 'Edit Estimate' }).click();
  await details.getByRole('spinbutton', { name: 'Estimate' }).fill('999');
  await details.getByRole('spinbutton', { name: 'Estimate' }).press('Enter');
  await expect(details.getByText('Enter a value of at most 100.')).toBeVisible();
  await expect(details.getByText('3', { exact: true })).toBeVisible();

  // date: Enter saves.
  await details.getByRole('button', { name: 'Set Due date' }).click();
  await details.getByLabel('Due date').fill('2026-12-01');
  await details.getByLabel('Due date').press('Enter');
  await expectSaved(page);
  await expect(details.getByText('1 Dec 2026', { exact: true })).toBeVisible();

  // boolean: immediate checkbox save.
  await details.getByRole('checkbox', { name: 'Flagged' }).click();
  await expectSaved(page);
  await expect(details.getByRole('checkbox', { name: 'Flagged' })).toBeChecked();

  // select: immediate native dropdown save.
  await details.getByRole('combobox', { name: 'Category' }).selectOption('work');
  await expectSaved(page);
  await expect(details.getByRole('combobox', { name: 'Category' })).toHaveValue('work');

  // select with optionsSource users: searchable picker, immediate save.
  await details.getByRole('button', { name: 'Assign Reviewer' }).click();
  const listbox = page.getByRole('listbox', { name: 'People' });
  await expect(listbox).toBeVisible();
  await page.getByRole('combobox', { name: 'Search people' }).fill('may');
  await listbox.getByRole('option', { name: 'Maya' }).click();
  await expectSaved(page);
  await expect(listbox).toBeHidden();
  await expect(details.getByText('Maya', { exact: true })).toBeVisible();

  // Persisted through the per-field PATCH endpoint.
  const values = await fixtureValues(page, homeId);
  expect(values.summary).toBe('Inspect basement');
  expect(values.estimate).toBe(3);
  expect(values.due).toBe('2026-12-01');
  expect(values.flagged).toBe(true);
  expect(values.category).toBe('work');
  expect(typeof values.reviewer).toBe('string');
});

test('edits longtext Markdown with preview, renders it safely and stays read-only for Viewers', async ({
  page,
}) => {
  const { homeId, details } = await openHome(page);

  await details.getByRole('button', { name: 'Set Notes' }).click();
  const editor = details.getByRole('textbox', { name: 'Notes' });
  const markdown = [
    '**Bold** plan with *care* and `code`.',
    '',
    '- buy paint',
    '- sand the door',
    '',
    'See [Kapo](https://example.com) and [bad](javascript:alert(1)).',
    '',
    '<script>alert(1)</script>',
  ].join('\n');
  await editor.fill(markdown);

  // Preview renders the supported formatting and never live HTML/unsafe URLs.
  await details.getByRole('tab', { name: 'Preview' }).click();
  await expect(details.locator('strong').filter({ hasText: 'Bold' })).toBeVisible();
  await expect(details.locator('em').filter({ hasText: 'care' })).toBeVisible();
  await expect(details.locator('code').filter({ hasText: 'code' })).toBeVisible();
  await expect(details.locator('a').filter({ hasText: 'Kapo' })).toHaveAttribute(
    'href',
    'https://example.com/',
  );
  await expect(details.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(details.locator('script')).toHaveCount(0);
  await expect(details.getByText('<script>alert(1)</script>', { exact: true })).toBeVisible();

  await details.getByRole('tab', { name: 'Edit' }).click();
  await details.getByRole('button', { name: 'Save changes' }).click();
  await expectSaved(page);

  // Rendered Markdown in Details and Properties.
  const properties = page.locator('aside[aria-labelledby="properties-heading"]');
  await expect(details.locator('strong').filter({ hasText: 'Bold' })).toBeVisible();
  await expect(properties.locator('strong').filter({ hasText: 'Bold' })).toBeVisible();
  await expect(details.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(details.locator('script')).toHaveCount(0);

  await page.reload();
  await expect(
    page
      .locator('section[aria-labelledby="details-heading"]')
      .locator('strong')
      .filter({ hasText: 'Bold' }),
  ).toBeVisible();

  const values = await fixtureValues(page, homeId);
  expect(values.notes).toBe(markdown);

  // Viewer: plain heading, rendered values, no inline editors.
  await page.context().clearCookies();
  await login(page, 'alex');
  await page.goto(`/p/${homeId}`);
  const viewerDetails = page.locator('section[aria-labelledby="details-heading"]');
  await expect(viewerDetails.locator('strong').filter({ hasText: 'Bold' })).toBeVisible();
  const viewerHeading = page.getByRole('heading', { level: 1, name: 'Home improvement' });
  await expect(viewerHeading).toBeVisible();
  await expect(viewerHeading.getByRole('button')).toHaveCount(0);
  await expect(viewerDetails.getByRole('button', { name: /Notes/ })).toHaveCount(0);
  await expect(viewerDetails.getByRole('textbox', { name: 'Notes' })).toHaveCount(0);
  await expect(
    page.locator('aside[aria-labelledby="properties-heading"]').getByRole('button', { name: /Notes/ }),
  ).toHaveCount(0);
});
