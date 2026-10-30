import { type Page } from '@playwright/test';
import { expect, test } from '../test';
import { invite, uniqueUsername } from './db';
import { totp } from './totp';

// US1 end to end against the real backend (quickstart V1, V2, V4.1). Each project invites its own user.

const PASSWORD = 'a long and private test passphrase';

async function signIn(page: Page, username: string, password: string, code?: string) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password or temporary code').fill(password);
  if (code) await page.getByLabel(/authenticator code/i).fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Every visible control is at least 44×44 CSS px (Principle IV). */
async function expectTouchTargets(page: Page, view: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"])')]
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(
        ({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44),
      )
      .map(({ el }) => el.outerHTML.slice(0, 60)),
  );
  expect(small, `targets smaller than 44px on ${view}`).toEqual([]);
}

test('first sign-in: temporary code → password → authenticator → notice → Today; then a normal sign-in', async ({
  page,
}, testInfo) => {
  const username = uniqueUsername(testInfo.project.name.replace('auth-', ''));
  const code = invite(username);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByText(/sign\s*up|register|create account|request/i)).toHaveCount(0);
  await expectTouchTargets(page, 'sign-in');

  // Temporary code in the password field, code field left blank.
  const started = Date.now();
  await signIn(page, username, code);

  // Step 1: a breached password is refused, then a strong one is accepted.
  await expect(page.getByRole('heading', { name: 'Choose a password' })).toBeVisible();
  await expectTouchTargets(page, 'setup: password');
  await page.getByLabel('New password', { exact: true }).fill('password1234');
  await page.getByLabel('Confirm new password').fill('password1234');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('alert')).toContainText('appeared in a data breach');
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm new password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set password' }).click();

  // Step 2: read the setup key like a person would and enter the current code.
  await expect(page.getByRole('heading', { name: 'Add an authenticator' })).toBeVisible();
  await expect(page.getByRole('img', { name: /qr code/i })).toBeVisible();
  const setupKey = (await page.locator('.setup-key').textContent())!;
  await expectTouchTargets(page, 'setup: authenticator');
  await page.getByLabel(/6-digit code/i).fill(totp(setupKey));
  await page.getByRole('button', { name: 'Confirm' }).click();

  // Step 3: what is sent to Claude.
  await expect(page.getByRole('heading', { name: 'What is sent to Claude' })).toBeVisible();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  // SC-001: first-time setup in under 30 s of app time (the test types instantly).
  expect(Date.now() - started).toBeLessThan(30_000);

  // Sign out; Back must not show the app again (US1.3).
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toHaveCount(0);

  // The temporary code was single-use.
  await page.goto('/');
  await signIn(page, username, code);
  await expect(page.getByRole('alert')).toHaveText(
    'Could not sign in. Check your details and try again.',
  );

  // A normal sign-in with password + the next code (the current one was just used).
  const signInStarted = Date.now();
  await signIn(page, username, PASSWORD, totp(setupKey, new Date(Date.now() + 30_000)));
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  expect(Date.now() - signInStarted).toBeLessThan(20_000);
});

test('every kind of wrong sign-in gets the same message', async ({ page }, testInfo) => {
  const username = uniqueUsername(`${testInfo.project.name.replace('auth-', '')}w`);
  invite(username);
  await page.goto('/');

  for (const [user, password, code] of [
    [username, 'not the temporary code', undefined],
    ['nobody-here', 'anything at all', '123456'],
    [username, 'still wrong', '000000'],
  ] as const) {
    await signIn(page, user, password, code);
    await expect(page.getByRole('alert')).toHaveText(
      'Could not sign in. Check your details and try again.',
    );
  }
});
