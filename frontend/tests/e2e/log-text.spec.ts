import { expect, test } from '@playwright/test';
import { banana, egg, estimate, mockApi, toast, total } from './helpers';

test.describe('Log a food by text (User Story 1)', () => {
  test('V1–V2: estimate a banana, review it, confirm, and see totals rise exactly', async ({ page }) => {
    let body: unknown;
    await mockApi(page, {
      text: async (route) => {
        body = route.request().postDataJSON();
        await route.fulfill({ json: estimate(banana) });
      },
    });
    await page.goto('/');
    await expect(total(page, 'Calories')).toContainText('0 kcal');

    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel(/what did you eat/i).fill('1 medium banana');
    await page.getByRole('button', { name: 'Estimate' }).click();

    // V1: estimate shown with units and an AI label before anything is saved.
    const item = page.getByRole('group', { name: 'Banana' });
    await expect(item).toContainText('1 medium banana (~118 g)');
    await expect(item).toContainText('105 kcal');
    await expect(item).toContainText('1.3 g');
    await expect(page.getByText(/ai estimate/i)).toBeVisible();
    expect(body).toEqual({ description: '1 medium banana' }); // FR-015: only the description

    // V2: confirm → entry appears; totals equal the confirmed values.
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Banana');
    await expect(total(page, 'Calories')).toContainText('105 kcal');
    await expect(total(page, 'Protein')).toContainText('1.3 g');
    await expect(total(page, 'Carbs')).toContainText('27 g');
    await expect(total(page, 'Fat')).toContainText('0.4 g');
  });

  test('V3: an edited protein value is what gets saved', async ({ page }) => {
    await mockApi(page, { text: (route) => route.fulfill({ json: estimate(banana) }) });
    await page.goto('/');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel(/what did you eat/i).fill('1 medium banana');
    await page.getByRole('button', { name: 'Estimate' }).click();

    const item = page.getByRole('group', { name: 'Banana' });
    await item.getByRole('button', { name: /edit/i }).click();
    await item.getByLabel(/protein/i).fill('2');
    await item.getByRole('button', { name: /done/i }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(total(page, 'Protein')).toContainText('2 g');
  });

  test('V4: several foods show a per-item breakdown and a combined total', async ({ page }) => {
    await mockApi(page, { text: (route) => route.fulfill({ json: estimate(egg, toast) }) });
    await page.goto('/');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel(/what did you eat/i).fill('2 scrambled eggs and toast with butter');
    await page.getByRole('button', { name: 'Estimate' }).click();

    await expect(page.getByRole('group', { name: 'Scrambled eggs' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Whole wheat toast with butter' })).toBeVisible();
    await expect(page.getByRole('group', { name: /total/i })).toContainText('253 kcal');
  });

  test("V5: unrecognizable input shows Couldn't identify food, not an estimate", async ({ page }) => {
    await mockApi(page, { text: (route) => route.fulfill({ json: estimate() }) });
    await page.goto('/');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel(/what did you eat/i).fill('asdf');
    await page.getByRole('button', { name: 'Estimate' }).click();

    await expect(page.getByText(/couldn.t identify food/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  });

  test('V14: Cancel aborts the request and adds nothing', async ({ page }) => {
    let aborted = false;
    await mockApi(page, {
      text: async (route) => {
        // Never answer; the client must abort.
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        await route.fulfill({ json: estimate(banana) }).catch(() => {
          aborted = true;
        });
      },
    });
    page.on('requestfailed', (request) => {
      if (request.url().includes('/api/estimates/text')) aborted = true;
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel(/what did you eat/i).fill('1 medium banana');
    await page.getByRole('button', { name: 'Estimate' }).click();

    await expect(page.getByRole('status')).toContainText(/estimating/i);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => aborted).toBe(true);

    await page.getByRole('button', { name: /back/i }).click();
    await expect(total(page, 'Calories')).toContainText('0 kcal');
    await expect(page.getByText(/nothing logged yet/i)).toBeVisible();
  });

  test('V11: with AI unavailable, manual entry still logs and totals update', async ({ page }) => {
    await mockApi(page, { aiAvailable: false });
    await page.goto('/');
    await page.getByRole('button', { name: 'Add food' }).click();

    await expect(page.getByText(/ai lookup is unavailable/i)).toBeVisible();
    await page.getByLabel(/food name/i).fill('Greek yogurt');
    await page.getByLabel(/amount/i).fill('170');
    await page.getByLabel(/unit/i).selectOption('g');
    await page.getByLabel(/calories/i).fill('100');
    await page.getByLabel(/protein/i).fill('17');
    await page.getByLabel(/carbs/i).fill('6');
    await page.getByLabel(/fat/i).fill('0.7');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Greek yogurt');
    await expect(total(page, 'Protein')).toContainText('17 g');
  });
});
