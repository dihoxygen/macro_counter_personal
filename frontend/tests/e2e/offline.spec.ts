import { expect, test } from '@playwright/test';

// Runs against the production build (`vite preview`), where the service worker is active.
// No /api mocks here: offline, every /api call genuinely fails (Principle III).

test('the app works offline: Today, history and manual entry; AI shows as unavailable', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  // Wait until the service worker controls the page, so the app shell is cached.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve));
    }
  });

  await context.setOffline(true);
  await page.reload();

  // Today loads from the cache.
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();

  // Manual entry still works; AI entry is reported as unavailable.
  await page.getByRole('button', { name: 'Add food' }).click();
  await expect(page.getByText(/ai lookup is unavailable/i)).toBeVisible();
  await page.getByLabel(/food name/i).fill('Boiled egg');
  await page.getByLabel(/amount/i).fill('50');
  await page.getByLabel(/calories/i).fill('78');
  await page.getByLabel(/protein/i).fill('6.3');
  await page.getByLabel(/carbs/i).fill('0.6');
  await page.getByLabel(/fat/i).fill('5.3');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('list', { name: /entries/i })).toContainText('Boiled egg');

  // History works offline.
  await page.getByRole('button', { name: /previous days/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: /previous days/i })).toBeVisible();
  await expect(page.getByText(/nothing logged/i)).toBeVisible();
});

test('the service worker never serves /api from the cache', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  const status = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/status');
      return response.status;
    } catch {
      return 'network-error';
    }
  });
  expect(status).toBe('network-error');
});
