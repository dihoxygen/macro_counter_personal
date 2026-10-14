import { expect, test } from '@playwright/test';
import { invite, uniqueUsername } from '../auth/db';
import { completeSetup } from '../auth/flows';

// US5.2 / quickstart V11: past the daily AI limit the person is told when it resets, and can still log by hand.
// This project's backend runs with Limits__Ai__PerUserDaily=2 (playwright.config.ts).

test('the third lookup of the day is refused with the reset time, and manual entry still works', async ({ page }) => {
  const username = uniqueUsername('quota');
  await page.goto('/');
  await completeSetup(page, username, invite(username));

  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel(/what did you eat/i).fill('1 medium banana');
    await page.getByRole('button', { name: 'Estimate' }).click();
    await expect(page.getByRole('group', { name: 'Banana' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Add food' }).click();
  await page.getByLabel(/what did you eat/i).fill('2 scrambled eggs');
  await page.getByRole('button', { name: 'Estimate' }).click();
  await expect(page.getByRole('alert')).toContainText("You've reached today's AI lookup limit. It resets at");
  await expect(page.getByRole('alert')).toContainText('You can still add food manually.');

  await page.getByRole('button', { name: /enter manually/i }).click();
  await page.getByLabel(/food name/i).fill('Scrambled eggs');
  await page.getByLabel(/amount/i).fill('100');
  await page.getByLabel(/calories/i).fill('148');
  await page.getByLabel(/protein/i).fill('10');
  await page.getByLabel(/carbs/i).fill('1.6');
  await page.getByLabel(/fat/i).fill('11');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('list', { name: /entries/i })).toContainText('Scrambled eggs');
});
