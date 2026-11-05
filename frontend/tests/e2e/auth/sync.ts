import { readFile } from 'node:fs/promises';
import { expect, type Browser, type BrowserContext, type Download, type Page, type TestInfo } from '@playwright/test';
import { adminSql, invite, uniqueUsername } from './db';
import { completeSetup, nextCode, PASSWORD, signIn } from './flows';

/** Sync's own promise for a change to reach another open device (SC-001). */
export const SYNC_TIMEOUT = 10_000;

export interface Device {
  context: BrowserContext;
  page: Page;
}

export interface Account {
  username: string;
  id: string;
  setupKey: string;
  /** Each sign-in needs its own authenticator code: a code cannot be used twice. */
  nextStep: () => number;
}

const appOptions = (testInfo: TestInfo) => ({
  baseURL: testInfo.project.use.baseURL,
  viewport: testInfo.project.use.viewport,
  isMobile: testInfo.project.use.isMobile,
  hasTouch: testInfo.project.use.hasTouch,
});

/** A browser profile of its own, like another device. */
export async function newDevice(browser: Browser, testInfo: TestInfo): Promise<Device> {
  const context = await browser.newContext(appOptions(testInfo));
  // As in test.ts: this context did not come from the fixture.
  await context.addInitScript(() => sessionStorage.setItem('macro.introPlayed', '1'));
  const page = await context.newPage();
  return { context, page };
}

/** A fresh account, set up on its first device, which ends on Today. */
export async function newAccount(browser: Browser, testInfo: TestInfo, prefix: string) {
  const project = testInfo.project.name.replace('auth-', '');
  const username = uniqueUsername(`${project}${prefix}`);
  const first = await newDevice(browser, testInfo);
  await first.page.goto('/');
  const setupKey = await completeSetup(first.page, username, invite(username));
  const id = adminSql(`select id from macro.users where username = '${username}';`);
  let step = 0;
  const account: Account = { username, id, setupKey, nextStep: () => ++step };
  return { account, first };
}

export async function signInOn(device: Device, account: Account) {
  await device.page.goto('/');
  await signIn(device.page, account.username, PASSWORD, nextCode(account.setupKey, account.nextStep()));
  await expect(device.page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
}

/** A second device, signed in to the same account, on Today. */
export async function anotherDevice(browser: Browser, testInfo: TestInfo, account: Account): Promise<Device> {
  const device = await newDevice(browser, testInfo);
  await signInOn(device, account);
  return device;
}

export const entryList = (page: Page) => page.getByRole('list', { name: /entries/i });

export const totals = (page: Page) => page.getByRole('region', { name: /totals/i });

export async function openEntry(page: Page, name: string | RegExp) {
  await entryList(page).getByRole('button', { name }).click();
}

export async function waitForSynced(page: Page) {
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: SYNC_TIMEOUT });
}

export async function changeAmount(page: Page, name: string | RegExp, grams: string) {
  await openEntry(page, name);
  await page.getByRole('spinbutton', { name: /amount/i }).fill(grams);
  await page.getByRole('button', { name: 'Save' }).click();
}

export async function deleteEntry(page: Page, name: string | RegExp) {
  await openEntry(page, name);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: /yes, delete/i }).click();
}

export async function readDownload(download: Download) {
  return JSON.parse(await readFile(await download.path(), 'utf8')) as {
    format: string;
    entries: { name: string }[];
    savedFoods: unknown[];
    proteinGoals: unknown[];
    entryVersions: unknown[];
  };
}

/** A v1 per-account database, as a device held it before this feature (research R6). */
export async function seedV1Device(
  page: Page,
  userId: string,
  seed: { entries: { id: string; name: string }[]; foods: { id: string; name: string }[] },
) {
  await page.evaluate(
    ({ userId, seed }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(`macro-counter.u.${userId}`, 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          db.createObjectStore('entries', { keyPath: 'id' }).createIndex('dayKey', 'dayKey');
          db.createObjectStore('savedFoods', { keyPath: 'id' }).createIndex('lastUsedAt', 'lastUsedAt');
          db.createObjectStore('proteinGoals', { keyPath: 'id' }).createIndex('effectiveFrom', 'effectiveFrom', { unique: true });
          db.createObjectStore('meta');
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['entries', 'savedFoods', 'meta'], 'readwrite');
          const now = new Date().toISOString();
          const day = new Date();
          const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
          const meta = { createdAt: now, updatedAt: now, schemaVersion: 1 };
          const macros = { kcal: 150, proteinG: 8, carbsG: 20, fatG: 3 };
          const quantity = { amount: 100, unit: 'g' };
          for (const { id, name } of seed.entries) {
            tx.objectStore('entries').put({ ...meta, id, dayKey, loggedAt: now, name, quantity, macros, source: 'manual', savedFoodId: null });
          }
          for (const { id, name } of seed.foods) {
            tx.objectStore('savedFoods').put({ ...meta, id, name, referenceQuantity: quantity, macros, source: 'manual', lastUsedAt: now });
          }
          tx.objectStore('meta').put(1, 'schemaVersion');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('seeding failed'));
        };
        open.onerror = () => reject(new Error('opening failed'));
      }),
    { userId, seed },
  );
}
