import { expect, test } from './test';
import { banana, composer, estimate, mockApi, reviewCard } from './helpers';

// Feature 004 User Story 4 (FR-015, SC-004): describe, review and confirm with the keyboard alone.
test('a described food can be logged without the mouse @desktop-only', async ({ page }) => {
  await mockApi(page, { text: (route) => route.fulfill({ json: estimate(banana) }) });
  await page.goto('/');
  await expect(page.getByText(/nothing logged yet/i)).toBeVisible();

  const field = composer(page).getByLabel('What did you eat?');
  for (let i = 0; i < 10 && !(await field.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(field).toBeFocused();
  await page.keyboard.type('banana');
  await page.keyboard.press('Enter');

  await expect(reviewCard(page)).toBeVisible();
  expect(await reviewCard(page).evaluate((card) => card.contains(document.activeElement))).toBe(
    true,
  );

  const confirm = reviewCard(page).getByRole('button', { name: 'Confirm' });
  for (let i = 0; i < 15 && !(await confirm.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('list', { name: /entries/i })).toContainText('Banana');
  await expect(field).toBeFocused();
});
