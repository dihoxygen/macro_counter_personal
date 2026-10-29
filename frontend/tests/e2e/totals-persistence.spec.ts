import { expect, test } from '@playwright/test';
import { logManually, mockApi, total } from './helpers';

const yogurt = { name: 'Greek yogurt', amount: '170', kcal: '100', protein: '17', carbs: '6', fat: '0.7' };
const chicken = { name: 'Chicken breast', amount: '150', kcal: '248', protein: '46.5', carbs: '0', fat: '5.4' };

test.describe('Running totals (User Story 2)', () => {
  test('V7: entries and totals survive a reload', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await logManually(page, yogurt);
    await logManually(page, chicken);
    await expect(total(page, 'Protein')).toContainText('63.5 g');

    await page.reload();

    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Greek yogurt');
    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Chicken breast');
    await expect(total(page, 'Protein')).toContainText('63.5 g');
    await expect(total(page, 'Calories')).toContainText('348 kcal');
  });

  test('V8: edit and delete update totals immediately and exactly', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await logManually(page, yogurt);
    await logManually(page, chicken);

    await page.getByRole('button', { name: /greek yogurt/i }).click();
    await page.getByLabel(/amount/i).fill('85');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(total(page, 'Protein')).toContainText('55 g');
    await expect(total(page, 'Calories')).toContainText('298 kcal');

    await page.getByRole('button', { name: /chicken breast/i }).click();
    await page.getByRole('button', { name: /^delete$/i }).click();
    await page.getByRole('button', { name: /yes, delete/i }).click();
    await expect(total(page, 'Protein')).toContainText('8.5 g');
    await expect(total(page, 'Calories')).toContainText('50 kcal');
  });

  test('V12: totals reset at local midnight and yesterday stays viewable', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 8, 23, 57, 0) });
    await mockApi(page);
    await page.goto('/');
    await logManually(page, yogurt);
    await expect(total(page, 'Protein')).toContainText('17 g');

    await page.clock.fastForward('04:00');

    await expect(total(page, 'Protein')).toContainText('0 g');
    await expect(page.getByText(/nothing logged yet/i)).toBeVisible();

    await page.getByRole('button', { name: /previous days/i }).click();
    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Greek yogurt');
    await expect(total(page, 'Protein')).toContainText('17 g');
  });
});
