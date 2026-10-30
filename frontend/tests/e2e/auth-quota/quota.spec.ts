import { expect, test } from '../test';
import { invite, uniqueUsername } from '../auth/db';
import { completeSetup } from '../auth/flows';
import { composer, describeFood, reviewCard } from '../helpers';

// US5.2 / quickstart V11: past the daily AI limit the person is told when it resets, and can still log by hand.
// This project's backend runs with Limits__Ai__PerUserDaily=2 (playwright.config.ts).

test('the third lookup of the day is refused with the reset time, and manual entry still works', async ({ page }) => {
  const username = uniqueUsername('quota');
  await page.goto('/');
  await completeSetup(page, username, invite(username));

  for (let i = 0; i < 2; i++) {
    await describeFood(page, '1 medium banana');
    await expect(reviewCard(page).getByRole('group', { name: 'Banana' })).toBeVisible();
    await reviewCard(page).getByRole('button', { name: 'Confirm' }).click();
    await expect(reviewCard(page)).toHaveCount(0);
  }

  await describeFood(page, '2 scrambled eggs');
  // FR-019: the refusal shows in the composer's card area, on Today.
  const alert = composer(page).getByRole('alert');
  await expect(alert).toContainText("You've reached today's AI lookup limit. It resets at");
  await expect(alert).toContainText('You can still add food manually.');

  await composer(page).getByRole('button', { name: /enter manually/i }).click();
  await composer(page).getByLabel(/food name/i).fill('Scrambled eggs');
  await composer(page).getByLabel(/amount/i).fill('100');
  await composer(page).getByLabel(/calories/i).fill('148');
  await composer(page).getByLabel(/protein/i).fill('10');
  await composer(page).getByLabel(/carbs/i).fill('1.6');
  await composer(page).getByLabel(/fat/i).fill('11');
  await composer(page).getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('list', { name: /entries/i })).toContainText('Scrambled eggs');
});
