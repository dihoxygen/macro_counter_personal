import { expect, test } from '@playwright/test';
import { banana, describeFood, estimate, mockApi, reviewCard, total } from './helpers';

test.describe('Re-log a recent food (User Story 4)', () => {
  test('V10: a food logged via AI can be re-logged in ≤ 3 interactions from Today', async ({ page }) => {
    await mockApi(page, { text: (route) => route.fulfill({ json: estimate(banana) }) });
    await page.goto('/');

    // First log it through the AI.
    await describeFood(page, '1 medium banana');
    await reviewCard(page).getByRole('button', { name: 'Confirm' }).click();
    await expect(total(page, 'Calories')).toContainText('105 kcal');

    // Re-log it from Recent, counting user actions.
    let interactions = 0;
    const act = async (fn: () => Promise<void>) => {
      interactions++;
      await fn();
    };
    await act(() => page.getByRole('button', { name: /^recent$/i }).click());
    await act(() => page.getByRole('button', { name: /banana/i }).click());
    await act(() => page.getByRole('button', { name: /^log$/i }).click());

    expect(interactions).toBeLessThanOrEqual(3);
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(total(page, 'Calories')).toContainText('210 kcal');
    await expect(total(page, 'Protein')).toContainText('2.6 g');
  });

  test('V10: changing the quantity scales the macros proportionally', async ({ page }) => {
    await mockApi(page, { text: (route) => route.fulfill({ json: estimate(banana) }) });
    await page.goto('/');
    await describeFood(page, '1 medium banana');
    await reviewCard(page).getByRole('button', { name: 'Confirm' }).click();

    await page.getByRole('button', { name: /^recent$/i }).click();
    await page.getByRole('button', { name: /banana/i }).click();
    await page.getByRole('spinbutton', { name: 'Amount' }).fill('59'); // half of 118 g
    await page.getByRole('button', { name: /^log$/i }).click();

    await expect(total(page, 'Calories')).toContainText('158 kcal'); // 105 + 52.5
  });
});
