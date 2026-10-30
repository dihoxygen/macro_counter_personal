import { type Page } from '@playwright/test';
import { expect, test } from '../test';
import { reset } from './db';
import { completeSetup, nextCode, PASSWORD, signIn, signOut } from './flows';

// FR-018 / US4.3 / quickstart V8: data saved before sign-in existed goes to the owner only, once.

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

/** Recreates the pre-feature single-user database (schema version 1) with two entries. */
async function seedLegacyData(page: Page) {
  await page.evaluate(async (dayKey) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('macro-counter', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('dayKey', 'dayKey');
        db.createObjectStore('savedFoods', { keyPath: 'id' }).createIndex(
          'lastUsedAt',
          'lastUsedAt',
        );
        db.createObjectStore('proteinGoals', { keyPath: 'id' }).createIndex(
          'effectiveFrom',
          'effectiveFrom',
          { unique: true },
        );
        db.createObjectStore('meta').put(1, 'schemaVersion');
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('entries', 'readwrite');
        for (const [id, name] of [
          ['legacy-1', 'Legacy porridge'],
          ['legacy-2', 'Legacy yogurt'],
        ]) {
          tx.objectStore('entries').put({
            id,
            createdAt: `${dayKey}T07:00:00.000Z`,
            updatedAt: `${dayKey}T07:00:00.000Z`,
            schemaVersion: 1,
            dayKey,
            loggedAt: `${dayKey}T07:00:00.000Z`,
            name,
            quantity: { amount: 100, unit: 'g' },
            macros: { kcal: 150, proteinG: 8, carbsG: 20, fatG: 3 },
            source: 'manual',
            savedFoodId: null,
          });
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, today());
}

const legacyExists = (page: Page) =>
  page.evaluate(async () =>
    (await indexedDB.databases()).some((db) => db.name === 'macro-counter'),
  );

test('the pre-feature data goes to the owner, never to a friend, and only once', async ({
  page,
}) => {
  await page.goto('/');
  await seedLegacyData(page);
  await page.reload();

  // A friend signs in first on this browser: nothing is adopted.
  await completeSetup(page, 'e2e-friend', reset('e2e-friend'));
  await expect(page.getByText('Legacy porridge')).toHaveCount(0);
  expect(await legacyExists(page)).toBe(true);
  await signOut(page);

  // The owner signs in: the two entries appear and the old database is gone.
  const ownerKey = await completeSetup(page, 'e2e-owner', reset('e2e-owner'));
  const entries = page.getByRole('list', { name: /entries/i });
  await expect(entries).toContainText('Legacy porridge');
  await expect(entries).toContainText('Legacy yogurt');
  await expect.poll(() => legacyExists(page)).toBe(false);
  await signOut(page);

  // Signing in again does not duplicate anything.
  await signIn(page, 'e2e-owner', PASSWORD, nextCode(ownerKey));
  await expect(entries.getByText('Legacy porridge')).toHaveCount(1);
  await expect(entries.getByText('Legacy yogurt')).toHaveCount(1);
});
