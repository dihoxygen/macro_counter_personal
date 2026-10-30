import { test as baseTest } from '@playwright/test';
import { expect, test } from './test';
import { composer } from './helpers';

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
  const requested: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('data:') && !request.url().startsWith('blob:'))
      requested.push(request.url());
  });
  await page.goto('/');
  await rememberSignedInAccount(page);
  // The server cannot be reached (whatever happens to be listening locally): every /api call fails.
  await context.route('**/api/**', (route) => route.abort('connectionrefused'));
  await page.reload();
  // The remembered account's data opens, with AI lookup blocked.
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

  // Manual entry still works in the composer; AI entry is reported as unavailable (feature 004, FR-010).
  const box = composer(page);
  await expect(
    box.getByText('Sign in or reconnect to use AI lookup. You can still enter the food manually.'),
  ).toBeVisible();
  await expect(box.getByRole('button', { name: 'Describe' })).toBeDisabled();
  await box.getByLabel('Food name').fill('Boiled egg');
  await box.getByLabel('Amount').fill('50');
  await box.getByLabel('Calories (kcal)').fill('78');
  await box.getByLabel('Protein (g)').fill('6.3');
  await box.getByLabel('Carbs (g)').fill('0.6');
  await box.getByLabel('Fat (g)').fill('5.3');
  await box.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('list', { name: /entries/i })).toContainText('Boiled egg');

  // A quick-pick re-log works offline too (quickstart Q11).
  await box
    .getByRole('group', { name: 'Recent foods' })
    .getByRole('button', { name: 'Boiled egg' })
    .click();
  await box.getByRole('button', { name: /^log$/i }).click();
  await expect(page.getByRole('list', { name: /entries/i }).getByRole('listitem')).toHaveCount(2);

  // SC-006 / FR-018: nothing was requested from a third-party server, fonts included.
  const origin = new URL(page.url()).origin;
  expect(requested.filter((url) => new URL(url).origin !== origin)).toEqual([]);

  // History works offline.
  await page.getByRole('button', { name: /previous days/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: /previous days/i })).toBeVisible();
  await expect(page.getByText(/nothing logged/i)).toBeVisible();
});

// Feature 005 (FR-015, SC-006): the splash intro plays offline, its fonts served from the precache. The base
// `test` on purpose: ./test.ts would mark the intro as already played in every page of the context.
baseTest('the splash intro plays offline in a new tab', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve),
      );
    }
  });
  await context.route('**/api/**', (route) => route.abort('connectionrefused'));
  await context.setOffline(true);

  // A new tab is a new browser session, so the intro is due again.
  const tab = await context.newPage();
  const failedFonts: string[] = [];
  tab.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.startsWith('/fonts/intro/'))
      failedFonts.push(request.url());
  });
  await tab.goto('/');
  await expect(tab.getByTestId('splash-intro')).toBeVisible();
  await expect
    .poll(
      () =>
        tab
          .locator('[data-testid="splash-letter"][data-shape]')
          .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.index))),
      { timeout: 9_000 },
    )
    .toEqual([0, 4, 7]);
  const fontStatus = await tab.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.family.includes('MC Intro')).map((f) => f.status);
  });
  expect(fontStatus).not.toContain('error');
  expect(fontStatus.filter((s) => s === 'loaded').length).toBeGreaterThanOrEqual(12);
  expect(failedFonts).toEqual([]);
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
