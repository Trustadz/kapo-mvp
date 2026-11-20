import { expect, test, type Page } from '@playwright/test';

/**
 * Issue #56 — subtle motion + session-scoped changed-field feedback.
 *
 * Covers the two things that are safest to assert in a real browser: menus get
 * an entry animation that is disabled under `prefers-reduced-motion: reduce`,
 * and a saved status keeps a changed marker until a full page reload clears it.
 * Kanban/collection FLIP is presentation-only and covered by the existing
 * reorder specs plus manual QA.
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

test('flow-over menus animate in and respect reduced motion', async ({ page }) => {
  await login(page, 'tristan');
  await openProject(page, 'Home improvement');
  // The shared e2e projects default to reduced motion for stable drag rects;
  // this spec explicitly exercises the animated path.
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const trigger = page.getByRole('button', { name: 'Project actions' });
  await trigger.click();
  const panel = page.getByRole('menu', { name: 'Project actions' });
  await expect(panel).toBeVisible();

  const motion = await panel.evaluate((node) => {
    const style = getComputedStyle(node);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(motion.name).not.toBe('none');
  expect(motion.duration).not.toBe('0s');

  // Closing is immediate and focus returns to the trigger: motion must not
  // delay keyboard handling.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click();
  const reducedPanel = page.getByRole('menu', { name: 'Project actions' });
  await expect(reducedPanel).toBeVisible();
  const reducedAnimation = await reducedPanel.evaluate(
    (node) => getComputedStyle(node).animationName,
  );
  expect(reducedAnimation).toBe('none');
  await page.keyboard.press('Escape');
});

test('a saved status stays marked until a full page reload', async ({ page }) => {
  await login(page, 'tristan');
  await openProject(page, 'Home improvement');

  const select = page.getByLabel('Project status');
  const original = await select.inputValue();
  const options = await select
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  const next = options.find((value) => value !== original);
  expect(next).toBeTruthy();

  await select.selectOption(next!);
  await expect(select).toHaveValue(next!);

  const changedRow = page.locator('[data-changed="true"]').filter({ hasText: 'Status' });
  await expect(changedRow).toBeVisible();
  const background = await changedRow.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');

  // Restore the seeded status, then prove a full load clears the marker.
  await select.selectOption(original);
  await expect(select).toHaveValue(original);
  await page.reload();
  await expect(page.getByLabel('Project status')).toHaveValue(original);
  await expect(page.locator('[data-changed="true"]')).toHaveCount(0);
});
