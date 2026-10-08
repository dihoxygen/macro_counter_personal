import { expect, test } from '@playwright/test';
import { mockApi } from './helpers';

test.describe('Daily protein goal (User Story 5)', () => {
  test('V9: 90 of a 150 g goal shows "90 / 150 g" and "60 g left" without scrolling', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await page.getByRole('button', { name: /set a protein goal/i }).click();
    await page.getByLabel(/daily protein goal/i).fill('150');
    await page.getByRole('button', { name: /save/i }).click();

    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: 'Manual' }).click();
    await page.getByLabel(/food name/i).fill('Chicken and rice');
    await page.getByLabel(/amount/i).fill('400');
    await page.getByLabel(/calories/i).fill('680');
    await page.getByLabel(/protein/i).fill('90');
    await page.getByLabel(/carbs/i).fill('70');
    await page.getByLabel(/fat/i).fill('8');
    await page.getByRole('button', { name: /^save$/i }).click();

    // Reload so we measure the initial, unscrolled view (SC-009).
    await page.reload();
    const progress = page.getByRole('region', { name: /protein goal/i });
    await expect(progress).toContainText('90 / 150 g');
    await expect(progress).toContainText('60 g left');

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const box = await progress.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  });
});
