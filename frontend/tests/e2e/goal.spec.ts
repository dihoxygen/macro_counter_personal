import { expect, test } from '@playwright/test';
import { logManually, mockApi } from './helpers';

test.describe('Daily protein goal (User Story 5)', () => {
  test('V9: 90 of a 150 g goal shows "90 / 150 g" and "60 g left" without scrolling', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // Set 180 g first, then change it to 150 g from the main screen (FR-018).
    await page.getByRole('button', { name: /set a protein goal/i }).click();
    await page.getByLabel(/daily protein goal/i).fill('180');
    await page.getByRole('button', { name: /save/i }).click();
    await page.getByRole('button', { name: /change goal/i }).click();
    await expect(page.getByLabel(/daily protein goal/i)).toHaveValue('180');
    await page.getByLabel(/daily protein goal/i).fill('150');
    await page.getByRole('button', { name: /save/i }).click();

    await logManually(page, { name: 'Chicken and rice', amount: '400', kcal: '680', protein: '90', carbs: '70', fat: '8' });

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

  test('Goal settings in the header opens the goal, and saving returns to Today (feature 004)', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Goal settings' }).click();
    await page.getByLabel(/daily protein goal/i).fill('140');
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(page.getByRole('region', { name: /protein goal/i })).toContainText('0 / 140 g');
  });
});
