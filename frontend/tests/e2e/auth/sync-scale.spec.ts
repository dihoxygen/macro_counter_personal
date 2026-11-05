import { expect, test } from '../test';
import { adminSql } from './db';
import { logManually } from './flows';
import { anotherDevice, entryList, newAccount, SYNC_TIMEOUT, waitForSynced } from './sync';

// The timed promises (SC-001, SC-003, SC-008, SC-009), with a year of daily logging (about 2,500 records).

function seedAYear(userId: string) {
  adminSql(`
    with days as (select generate_series(0, 364) as back),
         rows as (select back, generate_series(1, 7) as n from days)
    insert into macro_data.log_entries (user_id, id, created_at, effective_at, schema_version, revision, day_key, logged_at, name,
        quantity_amount, quantity_unit, kcal, protein_g, carbs_g, fat_g, source, version_id, meal_category)
    select '${userId}', gen_random_uuid(), now(), now() - (back || ' days')::interval, 1, row_number() over (order by back, n) + 1000,
        (current_date - back), now() - (back || ' days')::interval, 'Food ' || n, 100, 'g', 300, 20, 30, 10, 'manual', gen_random_uuid(), 'lunch'
    from rows;
    update macro_data.sync_state set revision = (select max(revision) from macro_data.log_entries where user_id = '${userId}')
    where user_id = '${userId}';
  `);
}

test('a new device, trends and export keep their promises with a year of data', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { account } = await newAccount(browser, testInfo, 'year');
  seedAYear(account.id);

  const started = Date.now();
  const device = await anotherDevice(browser, testInfo, account);
  await expect(entryList(device.page)).toContainText('Food 1', { timeout: 15_000 });
  await waitForSynced(device.page);
  expect(Date.now() - started, 'a new device is ready within 15 s (SC-003)').toBeLessThan(15_000);

  await device.page.getByRole('button', { name: 'Trends' }).click();
  const trendsStarted = Date.now();
  await device.page.getByRole('button', { name: '90 days' }).click();
  const rows = device.page.getByRole('table', { name: 'Daily values' }).getByRole('row');
  await expect(rows).toHaveCount(91);
  expect(Date.now() - trendsStarted, '90 days of trends open within 2 s (SC-008)').toBeLessThan(2_000);
  await expect(rows.last()).toContainText('2100 kcal');

  await device.page.getByRole('button', { name: /back/i }).click();
  await device.page.getByRole('button', { name: 'Account' }).click();
  const exportStarted = Date.now();
  const [download] = await Promise.all([
    device.page.waitForEvent('download'),
    device.page.getByRole('button', { name: 'Export my data' }).click(),
  ]);
  await download.path();
  expect(Date.now() - exportStarted, 'an export finishes within 5 s (SC-009)').toBeLessThan(5_000);
});

test('changes reach another device within 10 s at least 19 times in 20 (SC-001)', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { account, first: a } = await newAccount(browser, testInfo, 'lat');
  const b = await anotherDevice(browser, testInfo, account);

  let onTime = 0;
  for (let attempt = 1; attempt <= 20; attempt++) {
    const name = `Attempt ${attempt}`;
    await logManually(a.page, name, 1);
    const started = Date.now();
    await entryList(b.page).getByRole('button', { name: new RegExp(`^${name} `) }).waitFor({ timeout: 30_000 });
    if (Date.now() - started < SYNC_TIMEOUT) onTime += 1;
    // Paced like a person: both devices share one rate limit of 60 requests a minute.
    await a.page.waitForTimeout(2_500);
  }

  expect(onTime).toBeGreaterThanOrEqual(19);
});
