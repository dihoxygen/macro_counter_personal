// Feature 005: the splash intro. Uses the base `test` on purpose: the shared fixture in ./test.ts marks the intro
// as already played, which is exactly what these specs must not do.
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './helpers';

const overlay = (page: Page) => page.getByTestId('splash-intro');
const letter = (page: Page, i: number) =>
  page.locator(`[data-testid="splash-letter"][data-index="${i}"]`);
const today = (page: Page) => page.getByText(/nothing logged yet/i);

async function shapedIndices(page: Page) {
  return page
    .locator('[data-testid="splash-letter"][data-shape]')
    .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.index)));
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test.describe('US1: the intro plays once per session', () => {
  test('plays the sequence, lands on the logo and hands over at 10 s (SC-001)', async ({
    page,
  }) => {
    const cspErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text()))
        cspErrors.push(msg.text());
    });
    const start = Date.now();
    await page.goto('/');
    await expect(overlay(page)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Macro Counter' })).toBeVisible();

    await expect(letter(page, 0)).toHaveAttribute('data-visible', 'true', { timeout: 1_500 });
    await expect(letter(page, 2)).toHaveAttribute('data-visible', 'true');
    await expect(letter(page, 6)).toHaveAttribute('data-visible', 'true');

    await expect.poll(() => shapedIndices(page), { timeout: 9_000 }).toEqual([0, 4, 7]);
    await expect(letter(page, 12)).toHaveAttribute('data-visible', 'true');

    await expect(overlay(page)).toBeHidden({ timeout: 11_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThan(9_000);
    expect(elapsed).toBeLessThan(11_500);
    await expect(today(page)).toBeVisible();
    expect(cspErrors).toEqual([]);
  });

  test('a reload in the same tab skips it; a new session plays it again (FR-010)', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    await expect(overlay(page)).toBeVisible();
    await page.reload();
    await expect(today(page)).toBeVisible();
    await expect(overlay(page)).toHaveCount(0);

    const fresh = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const other = await fresh.newPage();
    await mockApi(other);
    await other.goto('/');
    await expect(overlay(other)).toBeVisible();
    await fresh.close();
  });

  test('fits on one line at 360 px across runs (FR-016)', async ({ browser }) => {
    test.setTimeout(90_000);
    for (let run = 0; run < 5; run++) {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        viewport: { width: 360, height: 800 },
      });
      const page = await context.newPage();
      await mockApi(page);
      await page.goto('/');
      await expect.poll(() => shapedIndices(page), { timeout: 9_000 }).toEqual([0, 4, 7]);
      const fit = await page.evaluate(() => {
        const width = window.innerWidth;
        const boxes = [...document.querySelectorAll('[data-testid="splash-letter"]')].map((el) =>
          el.getBoundingClientRect(),
        );
        return {
          noScroll: document.documentElement.scrollWidth <= width,
          inside: boxes.every((b) => b.left >= 0 && b.right <= width),
          oneLine: new Set(boxes.map((b) => Math.round(b.top + b.height / 2) >> 3)).size <= 2,
        };
      });
      expect(fit).toEqual({ noScroll: true, inside: true, oneLine: true });
      await context.close();
    }
  });
});

test.describe('US2: the intro can be skipped', () => {
  test('a tap shows the app within half a second (SC-002)', async ({ page }) => {
    await page.goto('/');
    await expect(overlay(page)).toBeVisible();
    await page.waitForTimeout(3_000);
    const before = Date.now();
    await page.mouse.click(10, 400);
    await expect(overlay(page)).toBeHidden({ timeout: 500 });
    expect(Date.now() - before).toBeLessThan(1_000);
    await expect(today(page)).toBeVisible();
  });

  test('Escape skips it', async ({ page }) => {
    await page.goto('/');
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toBeHidden({ timeout: 500 });
    await expect(today(page)).toBeVisible();
  });

  test('the focused Skip intro button works from the keyboard and is a 44 px target', async ({
    page,
  }) => {
    await page.goto('/');
    const skip = page.getByRole('button', { name: 'Skip intro' });
    await expect(skip).toBeFocused();
    const box = (await skip.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Enter');
    await expect(overlay(page)).toBeHidden({ timeout: 500 });
  });
});

test.describe('US3: reduced motion', () => {
  test('shows a still logo and moves on within 2 s (SC-004)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const start = Date.now();
    await page.goto('/');
    await expect.poll(() => shapedIndices(page), { timeout: 1_000 }).toEqual([0, 4, 7]);
    await expect(overlay(page)).toBeHidden({ timeout: 2_500 });
    expect(Date.now() - start).toBeLessThan(3_500);
    await expect(today(page)).toBeVisible();
  });
});
