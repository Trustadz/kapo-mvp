import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Inbox drag to reorder and reparent (issue #53).
 *
 * Card view: dragging between cards reorders the capture in the one global
 * priority sequence; the right-hand rail remains the release target.
 * Tree view: dropping on a row's middle reparents the capture (keeping it in the
 * Inbox and its global priority), dropping between rows reorders it globally.
 * Non-Inbox rows are drop targets but never drag sources.
 */

test.describe.configure({ mode: 'serial' });

// Keep both the dragged card and the sticky release rail comfortably in view.
test.use({ viewport: { width: 1440, height: 1200 } });

const PASSWORD = 'kapo1234';

async function login(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function capture(page: Page, title: string): Promise<void> {
  const input = page.getByRole('textbox', { name: /add a project to root/i });
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('status')).toContainText(`Added "${title}" to Inbox.`);
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

/** Drop `source` before/after `target`, using the same vertical edge zones the UI uses. */
async function dragBetween(
  source: Locator,
  target: Locator,
  edge: 'before' | 'after',
  sourcePosition: { x: number; y: number },
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Drag target is not visible');
  const y = edge === 'before' ? 2 : box.height - 2;
  await source.dragTo(target, {
    sourcePosition,
    targetPosition: { x: Math.min(200, Math.max(16, box.width / 2)), y },
  });
}

test('Card view reorders Inbox cards globally and keeps the release rail separate', async ({
  page,
}) => {
  await login(page, 'admin');
  const first = `E2E card drag A ${Date.now()}`;
  const second = `E2E card drag B ${Date.now()}`;
  await capture(page, first);
  await capture(page, second);

  await page.goto('/inbox');
  const list = page.getByRole('list', { name: 'Projects in the Inbox' });
  const cards = list.locator('article');
  const card = (title: string) => cards.filter({ hasText: title });
  const titles = () =>
    cards.evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('h2')?.textContent ?? ''),
    );

  await expect(card(first)).toBeVisible();
  await expect(card(second)).toBeVisible();
  // The keyboard-accessible actions remain available alongside drag.
  await expect(card(first).getByRole('button', { name: /change parent/i })).toBeVisible();
  await expect(card(first).getByRole('button', { name: /release to/i })).toBeVisible();

  const before = await titles();
  expect(before.indexOf(first)).toBeLessThan(before.indexOf(second));

  // Drop the first card after the second: the global sequence swaps them.
  // The full suite may already have more Inbox cards than this spec creates;
  // bring both endpoints into view instead of relying on drag auto-scroll.
  await card(first).scrollIntoViewIfNeeded();
  await card(second).scrollIntoViewIfNeeded();
  await dragBetween(card(first), card(second), 'after', { x: 12, y: 12 });
  await expect(page.getByText(`Reordered “${first}”.`)).toBeVisible();
  const reordered = await titles();
  expect(reordered.indexOf(second)).toBeLessThan(reordered.indexOf(first));
  await page.waitForTimeout(200); // FLIP settle before measuring the rail drag source

  // The rail is still a release target, not a reorder target.
  const rail = page.getByRole('region', { name: 'Release drop area' });
  await card(first).scrollIntoViewIfNeeded();
  await card(first).dragTo(rail, { sourcePosition: { x: 12, y: 12 } });
  await expect(card(first).getByText('Pulled')).toBeVisible();

  await page.goto('/inbox');
  const projectId = await findProjectId(page, first);
  const response = await page.request.get(`/api/projects/${projectId}`);
  const payload = (await response.json()) as { project: { inbox: boolean } };
  expect(payload.project.inbox).toBe(false);
  // The second capture stayed in the Inbox: a rail drop releases only the source.
  expect((await titles()).indexOf(second)).toBeGreaterThanOrEqual(0);
});

test('Tree view reparents on a row middle and reorders between rows', async ({ page }) => {
  await login(page, 'admin');
  const first = `E2E tree drag A ${Date.now()}`;
  const second = `E2E tree drag B ${Date.now()}`;
  await capture(page, first);
  await capture(page, second);
  const firstId = await findProjectId(page, first);
  const householdId = await findProjectId(page, 'Household');

  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Tree' }).click();
  const tree = page.getByRole('region', { name: 'Application tree' });
  const row = (title: string) => tree.getByRole('row', { name: new RegExp(title) });
  const firstRow = row(first);
  const secondRow = row(second);
  const householdRow = row('Household');

  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();
  // Inbox rows are draggable; the non-Inbox parent only receives drops.
  await expect(firstRow).toHaveAttribute('draggable', 'true');
  await expect(householdRow).toHaveAttribute('draggable', 'false');

  // Middle of another row = reparent under it, keeping the Inbox flag.
  const householdBox = await householdRow.boundingBox();
  if (!householdBox) throw new Error('Household row is not visible');
  await firstRow.dragTo(householdRow, {
    sourcePosition: { x: 300, y: 6 },
    targetPosition: { x: 200, y: householdBox.height / 2 },
  });
  await expect(
    page.getByText(`Moved “${first}” under Household; it stays in the Inbox.`),
  ).toBeVisible();

  const parentResponse = await page.request.get(`/api/projects/${firstId}`);
  const parentPayload = (await parentResponse.json()) as {
    project: { inbox: boolean; parent: { id: string } | null; statusName: string | null };
  };
  expect(parentPayload.project.inbox).toBe(true);
  expect(parentPayload.project.parent?.id).toBe(householdId);
  expect(parentPayload.project.statusName).toBe('To do');
  await page.waitForTimeout(200); // FLIP settle before the next tree drag

  // Between rows = reorder globally after the target (Book boiler service is a
  // different-parent Inbox row, so this is a genuine cross-branch reorder).
  const targetRow = row('Book boiler service');
  await dragBetween(firstRow, targetRow, 'after', { x: 300, y: 6 });
  await expect(page.getByText(`Reordered “${first}”.`)).toBeVisible();

  const treeResponse = await page.request.get('/api/inbox');
  const treePayload = (await treeResponse.json()) as {
    tree: Array<{ id: string; title: string }>;
  };
  const order = treePayload.tree.map((node) => node.id);
  const bookId = await findProjectId(page, 'Book boiler service');
  expect(order.indexOf(firstId)).toBe(order.indexOf(bookId) + 1);
});
