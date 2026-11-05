import { randomUUID } from 'node:crypto';
import { expect, test } from '../test';
import { adminSql, invite, uniqueUsername } from './db';
import { completeSetup, logManually, nextCode, PASSWORD, signIn, signOut } from './flows';
import {
  anotherDevice,
  changeAmount,
  deleteEntry,
  entryList,
  newAccount,
  newDevice,
  openEntry,
  readDownload,
  seedV1Device,
  signInOn,
  SYNC_TIMEOUT,
  totals,
  waitForSynced,
} from './sync';

// Cross-device sync (007) against the real backend: separate browser contexts are separate devices.

// Several devices set up and signed in, each with its own password hashing, so longer than the default.
test.describe.configure({ timeout: 90_000 });

test.describe('the same log on every device (US1)', () => {
  test('a change on one device reaches the other, and a new device gets everything', async ({ browser }, testInfo) => {
    const { account, first: a } = await newAccount(browser, testInfo, 'one');
    const b = await anotherDevice(browser, testInfo, account);

    await logManually(a.page, 'Banana', 5);
    await expect(entryList(b.page)).toContainText('Banana', { timeout: SYNC_TIMEOUT });

    await changeAmount(b.page, /banana/i, '150');
    await expect(entryList(a.page)).toContainText('150 g', { timeout: SYNC_TIMEOUT });

    await logManually(a.page, 'Oats', 12);
    await waitForSynced(a.page);
    await deleteEntry(a.page, /banana/i);
    await expect(entryList(b.page)).not.toContainText('Banana', { timeout: SYNC_TIMEOUT });

    await b.page.reload();
    await expect(entryList(b.page)).toContainText('Oats');
    await expect(entryList(b.page)).not.toContainText('Banana');

    const c = await anotherDevice(browser, testInfo, account);
    await expect(entryList(c.page)).toContainText('Oats', { timeout: SYNC_TIMEOUT });
  });

  test('a hand-verified day adds up the same on both devices (SC-006)', async ({ browser }, testInfo) => {
    const { account, first: a } = await newAccount(browser, testInfo, 'tot');
    const b = await anotherDevice(browser, testInfo, account);

    await logManually(a.page, 'Eggs', 12.5);
    await logManually(a.page, 'Oats', 7.25);

    // 200 kcal twice, and 12.5 + 7.25 g of protein.
    await expect(totals(b.page)).toContainText('400 kcal', { timeout: SYNC_TIMEOUT });
    await expect(totals(b.page)).toContainText('19.8 g');
    await expect(totals(a.page)).toContainText('400 kcal');
    await expect(totals(a.page)).toContainText('19.8 g');
  });
});

test('existing data merges on the first sync, with nothing lost or doubled (US2)', async ({ browser }, testInfo) => {
  const { account } = await newAccount(browser, testInfo, 'mrg');
  const a = await newDevice(browser, testInfo);
  const b = await newDevice(browser, testInfo);
  await a.page.goto('/');
  await b.page.goto('/');
  const food = () => [{ id: randomUUID(), name: 'Greek yogurt' }];
  await seedV1Device(a.page, account.id, {
    entries: [{ id: randomUUID(), name: 'Greek yogurt' }, { id: randomUUID(), name: 'From device A' }],
    foods: food(),
  });
  await seedV1Device(b.page, account.id, { entries: [{ id: randomUUID(), name: 'From device B' }], foods: food() });

  await signInOn(a, account);
  await signInOn(b, account);

  for (const { page } of [a, b]) {
    await expect(entryList(page)).toContainText('From device A', { timeout: SYNC_TIMEOUT * 2 });
    await expect(entryList(page)).toContainText('From device B', { timeout: SYNC_TIMEOUT * 2 });
    await expect(entryList(page).getByRole('button', { name: /greek yogurt/i })).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Recent foods' }).getByRole('button', { name: 'Greek yogurt' })).toHaveCount(1);
  }
  expect(adminSql(`select count(*) from macro_data.saved_foods where user_id = '${account.id}';`)).toBe('1');
  expect(
    adminSql(
      `select count(*) from macro_data.log_entries e join macro_data.saved_foods f on f.user_id = e.user_id and f.id = e.saved_food_id
       where e.user_id = '${account.id}' and e.name = 'Greek yogurt';`,
    ),
  ).toBe('1');
});

test.describe('offline (US3)', () => {
  test('logging keeps working, and changes reach the other device on reconnect', async ({ browser }, testInfo) => {
    const { account, first: a } = await newAccount(browser, testInfo, 'off');
    const b = await anotherDevice(browser, testInfo, account);
    await logManually(a.page, 'Oats', 12);
    await expect(entryList(b.page)).toContainText('Oats', { timeout: SYNC_TIMEOUT });

    await a.context.setOffline(true);
    await expect(a.page.getByRole('button', { name: 'Offline: will sync later' })).toBeVisible();
    await logManually(a.page, 'Offline soup', 5);
    await logManually(a.page, 'Offline toast', 4);
    await changeAmount(a.page, /offline toast/i, '50');
    await expect(entryList(a.page)).toContainText('Offline soup');
    // 200 + 200, and the toast halved to 100.
    await expect(totals(a.page)).toContainText('500 kcal');

    await a.context.setOffline(false);

    await expect(entryList(b.page)).toContainText('Offline soup', { timeout: SYNC_TIMEOUT });
    await expect(entryList(b.page)).toContainText('50 g');
    await waitForSynced(a.page);
  });

  test('a saved food takes the same taps offline as online, and no more than 3 (SC-004)', async ({ browser }, testInfo) => {
    const { first: a } = await newAccount(browser, testInfo, 'tap');
    await logManually(a.page, 'Skyr', 11);
    await a.context.setOffline(true);

    const quickPick = a.page.getByRole('group', { name: 'Recent foods' }).getByRole('button', { name: 'Skyr' });
    await quickPick.click(); // 1
    await a.page.getByRole('button', { name: 'Log', exact: true }).click(); // 2

    await expect(entryList(a.page).getByRole('button', { name: /skyr/i })).toHaveCount(2);
  });

  test('signing out warns, keeps the change private, and syncs it on return', async ({ browser }, testInfo) => {
    const { account, first: a } = await newAccount(browser, testInfo, 'out');
    const b = await anotherDevice(browser, testInfo, account);

    await a.context.setOffline(true);
    await logManually(a.page, 'Secret snack', 3);
    await a.page.getByRole('button', { name: 'Account' }).click();
    await a.page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(a.page.getByText(/1 change hasn't synced yet/i)).toBeVisible();

    // Cancelling is the only way out while offline: signing out needs the server.
    await a.page.getByRole('button', { name: 'Cancel' }).click();
    await a.context.setOffline(false);
    await a.page.getByRole('button', { name: /back/i }).click();

    await expect(entryList(b.page)).toContainText('Secret snack', { timeout: SYNC_TIMEOUT });
  });
});

test.describe('your own data (US4)', () => {
  test('export downloads this account and nobody else', async ({ browser }, testInfo) => {
    const { first: a } = await newAccount(browser, testInfo, 'exp');
    await logManually(a.page, 'Lentils', 18);
    await waitForSynced(a.page);
    await changeAmount(a.page, /lentils/i, '150');
    await waitForSynced(a.page);

    await a.page.getByRole('button', { name: 'Account' }).click();
    const [download] = await Promise.all([
      a.page.waitForEvent('download'),
      a.page.getByRole('button', { name: 'Export my data' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^macro-counter-export-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await readDownload(download);
    expect(file.format).toBe('macro-counter-export');
    expect(file.entries.map((e) => e.name)).toEqual(['Lentils']);
    expect(file.entryVersions).toHaveLength(1);
    expect(file.savedFoods).toHaveLength(1);

    const friend = await newDevice(browser, testInfo);
    await friend.page.goto('/');
    const other = uniqueUsername('exother');
    await completeSetup(friend.page, other, invite(other));
    await friend.page.getByRole('button', { name: 'Account' }).click();
    const [theirs] = await Promise.all([
      friend.page.waitForEvent('download'),
      friend.page.getByRole('button', { name: 'Export my data' }).click(),
    ]);
    expect((await readDownload(theirs)).entries).toEqual([]);
  });

  test('two accounts never see each other through sync', async ({ browser }, testInfo) => {
    const { first: a } = await newAccount(browser, testInfo, 'isoa');
    const { first: b } = await newAccount(browser, testInfo, 'isob');

    await logManually(a.page, 'Only mine', 5);
    await waitForSynced(a.page);
    await b.page.reload();

    await expect(b.page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(b.page.getByText('Only mine')).toHaveCount(0);
  });
});

test('a tab left open never takes in the data of the next person on that browser (threat S16)', async ({ browser }, testInfo) => {
  const { account: first, first: browserProfile } = await newAccount(browser, testInfo, 'taba');
  const { account: second, first: secondDevice } = await newAccount(browser, testInfo, 'tabb');
  await logManually(secondDevice.page, 'Private dinner', 40);
  await waitForSynced(secondDevice.page);

  const staleTab = browserProfile.page;
  await expect(staleTab.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: SYNC_TIMEOUT });

  // The same browser, in a new tab: the first person leaves and the second signs in, so the cookie changes hands.
  const newTab = await browserProfile.context.newPage();
  await newTab.goto('/');
  await signOut(newTab);
  await signIn(newTab, second.username, PASSWORD, nextCode(second.setupKey, second.nextStep()));
  await expect(entryList(newTab)).toContainText('Private dinner', { timeout: SYNC_TIMEOUT });

  // The old tab syncs again, as it would on coming back into view.
  await staleTab.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await staleTab.waitForTimeout(6_000);

  const leaked = await staleTab.evaluate(
    (userId) =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open(`macro-counter.u.${userId}`);
        open.onerror = () => reject(new Error('could not open'));
        open.onsuccess = () => {
          const all = open.result.transaction('entries').objectStore('entries').getAll();
          all.onsuccess = () => {
            open.result.close();
            resolve((all.result as { name: string }[]).map((e) => e.name));
          };
        };
      }),
    first.id,
  );
  expect(leaked).toEqual([]);
  await expect(staleTab.getByText('Private dinner')).toHaveCount(0);
});

test('a meal change shows in the same group on the other device (US5)', async ({ browser }, testInfo) => {
  const { account, first: a } = await newAccount(browser, testInfo, 'meal');
  const b = await anotherDevice(browser, testInfo, account);
  await logManually(a.page, 'Porridge', 8);
  await expect(entryList(b.page)).toContainText('Porridge', { timeout: SYNC_TIMEOUT });

  await openEntry(a.page, /porridge/i);
  await a.page.getByRole('combobox', { name: 'Meal' }).selectOption('dinner');
  await a.page.getByRole('button', { name: 'Save' }).click();

  await expect(entryList(b.page).getByRole('heading', { name: /dinner/i })).toBeVisible({ timeout: SYNC_TIMEOUT });
  await expect(entryList(b.page).getByRole('heading', { name: /dinner/i })).toContainText('200 kcal');
});

test.describe('undoing a mistake (US6)', () => {
  test('an entry deleted on one device can be restored on the other, with its history', async ({ browser }, testInfo) => {
    const { account, first: a } = await newAccount(browser, testInfo, 'undo');
    const b = await anotherDevice(browser, testInfo, account);
    await logManually(a.page, 'Dinner', 30);
    await waitForSynced(a.page);
    await changeAmount(a.page, /dinner/i, '120');
    await waitForSynced(a.page);
    await changeAmount(a.page, /dinner/i, '140');
    await waitForSynced(a.page);
    await deleteEntry(a.page, /dinner/i);
    await expect(entryList(b.page)).not.toBeVisible({ timeout: SYNC_TIMEOUT });

    await b.page.getByRole('button', { name: /recently deleted/i }).click();
    await b.page.getByRole('button', { name: 'Restore Dinner' }).click();

    await expect(entryList(a.page)).toContainText('140 g', { timeout: SYNC_TIMEOUT });
    await expect(entryList(b.page)).toContainText('140 g');

    await openEntry(a.page, /dinner/i);
    await a.page.getByRole('button', { name: 'History' }).click();
    const versions = a.page.getByRole('list', { name: 'Versions' }).getByRole('listitem');
    await expect(versions).toHaveCount(4);
    await expect(versions.first()).toContainText(/restored/i);
    await expect(a.page.getByRole('list', { name: 'Versions' })).toContainText('Deleted');
  });

  test('an edit that loses to a delete is kept, and the entry stays deleted', async ({ browser }, testInfo) => {
    const { account, first: a } = await newAccount(browser, testInfo, 'lose');
    const b = await anotherDevice(browser, testInfo, account);
    await logManually(a.page, 'Stew', 10);
    await expect(entryList(b.page)).toContainText('Stew', { timeout: SYNC_TIMEOUT });

    await a.context.setOffline(true);
    await changeAmount(a.page, /stew/i, '321');
    await deleteEntry(b.page, /stew/i);
    await waitForSynced(b.page);
    await a.context.setOffline(false);

    await expect(entryList(a.page)).not.toBeVisible({ timeout: SYNC_TIMEOUT });
    await b.page.reload();
    await expect(entryList(b.page)).not.toBeVisible();
    expect(
      adminSql(`select count(*) from macro_data.entry_versions where user_id = '${account.id}' and quantity_amount = 321;`),
    ).toBe('1');
  });
});

test('the most used food comes first on both devices, and follows deletes (US7)', async ({ browser }, testInfo) => {
  const { account, first: a } = await newAccount(browser, testInfo, 'pick');
  const b = await anotherDevice(browser, testInfo, account);
  const firstPick = (page: typeof a.page) => page.getByRole('group', { name: 'Recent foods' }).getByRole('button').first();

  await logManually(a.page, 'Eggs', 6);
  await logManually(a.page, 'Eggs', 6);
  await logManually(b.page, 'Oats', 5);
  await waitForSynced(a.page);
  await waitForSynced(b.page);
  await expect(firstPick(a.page)).toHaveText('Eggs', { timeout: SYNC_TIMEOUT });
  await expect(firstPick(b.page)).toHaveText('Eggs', { timeout: SYNC_TIMEOUT });

  await logManually(b.page, 'Oats', 5);
  await logManually(b.page, 'Oats', 5);

  await expect(firstPick(a.page)).toHaveText('Oats', { timeout: SYNC_TIMEOUT });
  await expect(firstPick(b.page)).toHaveText('Oats', { timeout: SYNC_TIMEOUT });
});

test('trends match the day on another device, and work offline (US8)', async ({ browser }, testInfo) => {
  const { account, first: a } = await newAccount(browser, testInfo, 'trnd');
  const b = await anotherDevice(browser, testInfo, account);
  await logManually(a.page, 'Lunch', 30);
  await expect(totals(b.page)).toContainText('200 kcal', { timeout: SYNC_TIMEOUT });

  await b.page.getByRole('button', { name: 'Trends' }).click();
  const rows = b.page.getByRole('table', { name: 'Daily values' }).getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.last()).toContainText('200 kcal');
  await expect(rows.nth(1)).toContainText('no data');

  await b.context.setOffline(true);
  await b.page.getByRole('button', { name: '30 days' }).click();
  await expect(rows).toHaveCount(31);
  await expect(rows.last()).toContainText('200 kcal');
});
