import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Issue #34 — sampled contrast checks on rendered key screens.
 *
 * Complements the deterministic token calculator in tests/unit/contrast.test.ts:
 * this spec reads computed colours from real components in both themes, so a
 * component that hardcodes a colour or paints the wrong token is caught too.
 * Runs against the seeded household from `first-install`.
 */

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1100 } });

const PASSWORD = 'kapo1234';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgba | null {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match?.[1]) return null;
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3) return null;
  return {
    r: parts[0] ?? 0,
    g: parts[1] ?? 0,
    b: parts[2] ?? 0,
    a: parts[3] ?? 1,
  };
}

function luminance(color: Rgba): number {
  const linear = (component: number): number => {
    const value = component / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function ratio(foreground: Rgba, background: Rgba): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

interface SampledColors {
  color: Rgba;
  background: Rgba;
  border: Rgba;
  outline: Rgba;
  outlineWidth: number;
}

async function sample(locator: Locator): Promise<SampledColors> {
  return locator.evaluate((element) => {
    const toRgba = (value: string): { r: number; g: number; b: number; a: number } | null => {
      const match = value.match(/rgba?\(([^)]+)\)/i);
      if (!match?.[1]) return null;
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      if (parts.length < 3) return null;
      return {
        r: parts[0] ?? 0,
        g: parts[1] ?? 0,
        b: parts[2] ?? 0,
        a: parts[3] ?? 1,
      };
    };
    const effectiveBackground = (node: Element): { r: number; g: number; b: number; a: number } => {
      let current: Element | null = node;
      while (current) {
        const parsed = toRgba(window.getComputedStyle(current).backgroundColor);
        if (parsed && parsed.a >= 0.99) return parsed;
        current = current.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const style = window.getComputedStyle(element);
    return {
      color: toRgba(style.color) ?? { r: 0, g: 0, b: 0, a: 1 },
      background: effectiveBackground(element),
      border: toRgba(style.borderTopColor) ?? { r: 0, g: 0, b: 0, a: 1 },
      outline: toRgba(style.outlineColor) ?? { r: 0, g: 0, b: 0, a: 1 },
      outlineWidth: Number.parseFloat(style.outlineWidth || '0'),
    };
  });
}

async function expectTextContrast(
  locator: Locator,
  minimum: number,
  label: string,
): Promise<void> {
  const colors = await sample(locator);
  const measured = ratio(colors.color, colors.background);
  expect(
    measured,
    `${label}: text ${JSON.stringify(colors.color)} on ${JSON.stringify(colors.background)} = ${measured.toFixed(2)}:1, needs ${minimum}:1`,
  ).toBeGreaterThanOrEqual(minimum);
}

async function expectBorderContrast(
  locator: Locator,
  minimum: number,
  label: string,
): Promise<void> {
  const colors = await sample(locator);
  const measured = ratio(colors.border, colors.background);
  expect(
    measured,
    `${label}: border ${JSON.stringify(colors.border)} on ${JSON.stringify(colors.background)} = ${measured.toFixed(2)}:1, needs ${minimum}:1`,
  ).toBeGreaterThanOrEqual(minimum);
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  // The seeded accounts follow the system appearance, so media emulation keeps
  // the theme across every full navigation in the test.
  await page.emulateMedia({ colorScheme: theme });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

for (const theme of ['light', 'dark'] as const) {
  test(`sampled screens meet WCAG AA in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await login(page);
    await useTheme(page, theme);

    // Home shell: heading, active navigation, capture field and focus ring.
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expectTextContrast(page.locator('main h1'), 4.5, 'Home heading');
    await expectTextContrast(
      page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]'),
      4.5,
      'Active sidebar destination',
    );
    const capture = page.getByRole('textbox', { name: /add a project to root/i });
    await expectTextContrast(capture, 4.5, 'Capture input text');
    await expectBorderContrast(capture, 3, 'Capture input border');
    await capture.focus();
    const focused = await sample(capture);
    expect(focused.outlineWidth, 'Capture input needs a visible focus ring').toBeGreaterThan(0);
    expect(
      ratio(focused.outline, focused.background),
      `Capture focus ring ${JSON.stringify(focused.outline)} on ${JSON.stringify(focused.background)}`,
    ).toBeGreaterThanOrEqual(3);

    // Inbox Card view: card title, muted context and the Inbox row highlight.
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    const firstCard = page.getByRole('article').first();
    await expectTextContrast(firstCard.getByRole('heading').first(), 4.5, 'Inbox card title');
    await expectTextContrast(
      firstCard.locator('p').first(),
      4.5,
      'Inbox card muted context',
    );

    // Project page: breadcrumb link, details and the Move dialog.
    const response = await page.request.get('/api/search?q=Home%20improvement');
    const payload = (await response.json()) as {
      results: Array<{ id: string; title: string }>;
    };
    const project = payload.results.find((result) => result.title === 'Home improvement');
    expect(project).toBeTruthy();
    await page.goto(`/p/${project!.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Home improvement' })).toBeVisible();
    await expectTextContrast(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').last(),
      4.5,
      'Breadcrumb link',
    );

    await page.getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('menuitem', { name: 'Move…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Move project' });
    await expect(dialog).toBeVisible();
    await expectTextContrast(dialog.getByRole('heading', { name: 'Move project' }), 4.5, 'Dialog title');
    await expectTextContrast(dialog.locator('p').first(), 4.5, 'Dialog description');
    await expectBorderContrast(
      dialog.getByLabel('Destination', { exact: true }),
      3,
      'Dialog select border',
    );
    await page.keyboard.press('Escape');

    // Application settings: labels, hint copy and control boundary.
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Application settings' })).toBeVisible();
    await expectTextContrast(
      page
        .getByRole('form', { name: 'General application settings' })
        .locator('label')
        .first(),
      4.5,
      'Settings field label',
    );
    await expectBorderContrast(page.locator('#settings-default-role'), 3, 'Settings select border');

    // Inbox Tree highlight: the Inbox row's own background is brand-light.
    await page.goto('/inbox');
    await page.getByRole('button', { name: 'Tree' }).click();
    const tree = page.getByRole('region', { name: 'Application tree' });
    const inboxRow = tree.getByRole('row', { name: /Renovate basement/ });
    await expect(inboxRow).toBeVisible();
    await expectTextContrast(
      inboxRow.getByRole('link', { name: 'Renovate basement', exact: true }),
      4.5,
      'Inbox Tree highlighted row title',
    );
  });
}
