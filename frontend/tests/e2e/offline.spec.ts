import { expect, test } from '@playwright/test';

// Runs against the production build (`vite preview`), where the service worker is active.
// No /api mocks here: offline, every /api call genuinely fails (Principle III).

/**
 * Someone signed in on this device before (feature 003): the device remembers the account, so the app can
 * open that account's own data when the server can't be reached (research R9, quickstart V9.1).
 */
async function rememberSignedInAccount(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('macro-counter-device', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('device').put(1, 'schemaVersion');
      };
      open.onsuccess = () => {
        const tx = open.result.transaction('device', 'readwrite');
        tx.objectStore('device').put(
          {
            userId: '00000000-0000-4000-8000-0000000000aa',
            username: 'offline-tester',
            role: 'user',
            updatedAt: new Date().toISOString(),
          },
          'activeAccount',
        );
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
}

test('the app works offline: Today, history and manual entry; AI shows as unavailable', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await rememberSignedInAccount(page);
  await page.reload();
  // No server here: the remembered account's data opens, with AI lookup blocked.
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    'Offline – sign in or reconnect to use AI lookup',
  );
  // Wait until the service worker controls the page, so the app shell is cached.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve),
      );
    }
  });

  await context.setOffline(true);
  await page.reload();

  // Today loads from the cache.
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();

  // Manual entry still works; AI entry is reported as unavailable.
  await page.getByRole('button', { name: 'Add food' }).click();
  await expect(
    page.getByText('Sign in or reconnect to use AI lookup. You can still enter the food manually.'),
  ).toBeVisible();
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
