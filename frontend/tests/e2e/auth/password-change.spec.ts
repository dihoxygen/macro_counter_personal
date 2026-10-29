import { expect, test } from '@playwright/test';
import { invite, uniqueUsername } from './db';
import { completeSetup, nextCode, PASSWORD, SIGN_IN_FAILED, signIn, signOut } from './flows';

// ASVS 2.1.5 / 2.1.6 (checklists/asvs-l2.md G1): a signed-in person changes their own password with the
// current password and an authenticator code; afterwards only the new password works.

const NEW_PASSWORD = 'a different and equally private passphrase';

test('change the password from the account screen, then sign in with the new one', async ({
  page,
}, testInfo) => {
  const username = uniqueUsername(testInfo.project.name.replace('auth-', '') + 'pw');
  await page.goto('/');
  const setupKey = await completeSetup(page, username, invite(username));

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel('Authenticator code').fill(nextCode(setupKey, 1));
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Password changed. Your other devices have been signed out.',
  );

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

  await signIn(page, username, PASSWORD, nextCode(setupKey, 2));
  await expect(page.getByRole('alert')).toHaveText(SIGN_IN_FAILED);
  await signIn(page, username, NEW_PASSWORD, nextCode(setupKey, 2));
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await signOut(page);
});
