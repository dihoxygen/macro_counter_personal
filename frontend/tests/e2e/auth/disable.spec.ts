import { expect, test } from '@playwright/test';
import { adminSql, invite, uniqueUsername } from './db';
import { completeSetup, nextCode, PASSWORD, signIn } from './flows';

// US2.4 / quickstart V5: the owner disables an account while the person is using the app.

test('a disabled person is sent to sign-in on their next server request, without a crash', async ({
  page,
}, testInfo) => {
  const username = uniqueUsername(`${testInfo.project.name.replace('auth-', '')}d`);
  const setupKey = await (async () => {
    const code = invite(username);
    await page.goto('/');
    return completeSetup(page, username, code);
  })();

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  adminSql(`select macro_admin.disable_user('${username}');`);

  // The next server call fails: opening Add food (it checks AI status) brings up sign-in over the app.
  // Manual entry stays available underneath (FR-022).
  await page.getByRole('button', { name: 'Add food' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Food name')).toBeAttached();

  // Signing in is refused while disabled, with the same generic message.
  await signIn(page, username, PASSWORD, nextCode(setupKey));
  await expect(dialog.getByRole('alert')).toHaveText(
    'Could not sign in. Check your details and try again.',
  );

  // Re-enabled: the person signs in again and AI lookup works (Testing-only fake estimator).
  adminSql(`select macro_admin.enable_user('${username}');`);
  // The refused attempt never consumed its code (disabled accounts fail before the code is checked).
  await signIn(page, username, PASSWORD, nextCode(setupKey));
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /back/i }).click();
  await page.getByRole('button', { name: 'Add food' }).click();
  await page.getByLabel(/what did you eat/i).fill('1 medium banana');
  await page.getByRole('button', { name: 'Estimate' }).click();
  await expect(page.getByRole('group', { name: 'Banana' })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
