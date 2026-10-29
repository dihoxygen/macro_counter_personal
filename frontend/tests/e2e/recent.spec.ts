import { expect, test } from '@playwright/test';
import { banana, composer, describeFood, estimate, mockApi, reviewCard, total } from './helpers';

test.describe('Re-log a recent food (User Story 4; feature 004 User Story 2)', () => {
  test('V10: a food logged via AI can be re-logged from Today in 2 interactions', async ({ page }) => {
    await mockApi(page, { text: (route) => route.fulfill({ json: estimate(banana) }) });
    await page.goto('/');

    // First log it through the AI.
    await describeFood(page, '1 medium banana');
    await reviewCard(page).getByRole('button', { name: 'Confirm' }).click();
    await expect(total(page, 'Calories')).toContainText('105 kcal');

    // Re-log it from the quick picks on Today, counting user actions (SC-002).
    let interactions = 0;
    const act = async (fn: () => Promise<void>) => {
      interactions++;
      await fn();
    };
    const picks = composer(page).getByRole('group', { name: 'Recent foods' });
    await act(() => picks.getByRole('button', { name: 'Banana' }).click());
    await act(() => composer(page).getByRole('button', { name: /^log$/i }).click());

    expect(interactions).toBe(2);
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(total(page, 'Calories')).toContainText('210 kcal');
    await expect(total(page, 'Protein')).toContainText('2.6 g');
  });

  test('V10: changing the quantity scales the macros proportionally', async ({ page }) => {
    await mockApi(page, { text: (route) => route.fulfill({ json: estimate(banana) }) });
    await page.goto('/');
    await describeFood(page, '1 medium banana');
    await reviewCard(page).getByRole('button', { name: 'Confirm' }).click();

    await composer(page).getByRole('group', { name: 'Recent foods' }).getByRole('button', { name: 'Banana' }).click();
    await composer(page).getByRole('spinbutton', { name: 'Amount' }).fill('59'); // half of 118 g
    await composer(page).getByRole('button', { name: /^log$/i }).click();

    await expect(total(page, 'Calories')).toContainText('158 kcal'); // 105 + 52.5
  });

  test('the full list stays reachable through More recent foods', async ({ page }) => {
    await mockApi(page, { text: (route) => route.fulfill({ json: estimate(banana) }) });
    await page.goto('/');
    await describeFood(page, '1 medium banana');
    await reviewCard(page).getByRole('button', { name: 'Confirm' }).click();

    await composer(page).getByRole('button', { name: 'More recent foods' }).click();
    await page.getByRole('list', { name: /recent foods/i }).getByRole('button', { name: /banana/i }).click();
    await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible();
    await page.getByRole('button', { name: /^log$/i }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(total(page, 'Calories')).toContainText('210 kcal');
  });
});
