import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './test';
import { composer, logManually, mockApi } from './helpers';

// Feature 004 User Story 4 (FR-013, FR-014, FR-016): one layout from 360 px phones to 1280 px desktops.

const longName =
  'Grilled chicken thigh with roasted sweet potato, broccoli and a garlic yogurt dip';

async function seed(page: Page, count: number) {
  await logManually(page, {
    name: longName,
    amount: '400',
    kcal: '650',
    protein: '48',
    carbs: '55',
    fat: '22',
  });
  for (let i = 1; i < count; i++) {
    await logManually(page, {
      name: `Snack ${i}`,
      amount: '100',
      kcal: '100',
      protein: '5',
      carbs: '10',
      fat: '3',
    });
  }
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

test.describe('Today layout', () => {
  test('totals are visible without scrolling, nothing overflows sideways, and long names stay on one line', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/');
    await seed(page, 2);
    await page.evaluate(() => window.scrollTo(0, 0));

    const totals = await box(page.getByRole('region', { name: /totals/i }));
    const viewport = page.viewportSize()!;
    expect(totals.y).toBeGreaterThanOrEqual(0);
    expect(totals.y + totals.height).toBeLessThanOrEqual(viewport.height);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const name = page.getByRole('list', { name: /entries/i }).getByText(longName);
    const oneLine = await name.evaluate((el) => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      return el.getBoundingClientRect().height < 1.5 * lineHeight;
    });
    expect(oneLine).toBe(true);

    // FR-016: the layout viewport shrinks for the on-screen keyboard, so the composer stays above it.
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain(
      'interactive-widget=resizes-content',
    );
  });

  // One test per project, no skips (playwright.config.ts): the expected position depends on the viewport.
  test('the composer sits beside the entries on desktop and at the bottom of the screen on a phone', async ({
    page,
  }) => {
    const viewport = page.viewportSize()!;
    await mockApi(page);
    await page.goto('/');
    await seed(page, viewport.width >= 960 ? 2 : 10);
    await page.evaluate(() => window.scrollTo(0, 0));

    const totals = await box(page.getByRole('region', { name: /totals/i }));
    const entries = await box(page.getByRole('list', { name: /entries/i }));
    const log = await box(composer(page));
    if (viewport.width >= 960) {
      expect(log.x).toBeGreaterThanOrEqual(entries.x + entries.width);
      expect(entries.y).toBeGreaterThan(totals.y + totals.height);
      expect(log.y).toBeGreaterThan(totals.y + totals.height);
    } else {
      expect(log.y).toBeGreaterThan(entries.y);
      expect(Math.abs(log.y + log.height - viewport.height)).toBeLessThanOrEqual(1);
    }
  });
});
