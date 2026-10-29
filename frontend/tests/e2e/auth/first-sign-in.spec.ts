import { expect, test, type Page } from '@playwright/test';
import { invite, uniqueUsername } from './db';
import { PASSWORD, SIGN_IN_FAILED, signIn } from './flows';
import { totp } from './totp';

// US1 (003) and US2 (004) end to end against the real backend: invite code → set your password →
// authenticator → notice → Today. Each project invites its own user.

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

async function setPassword(page: Page, password: string, confirm = password) {
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password').fill(confirm);
  await page.getByRole('button', { name: 'Set password' }).click();
}

test('first sign-in: invite code → password → authenticator → notice → Today; then a normal sign-in', async ({
  page,
}, testInfo) => {
  const username = uniqueUsername(testInfo.project.name.replace('auth-', ''));
  const code = invite(username);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByLabel('Password (or Invite Code)')).toBeVisible();
  await expect(page.getByLabel(/authenticator code/i)).toHaveCount(0);
  await expect(
    page.getByText(/sign\s*up|register|create account|request|temporary code/i),
  ).toHaveCount(0);
  await expectTouchTargets(page, 'sign-in');

  // The invite code goes in the password field; no authenticator screen comes first.
  const started = Date.now();
  await signIn(page, username, code);

  // Step 1: mismatched entries are caught, a breached password is refused, then a strong one is accepted.
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  await expectTouchTargets(page, 'setup: password');
  await setPassword(page, PASSWORD, `${PASSWORD} typo`);
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
  await setPassword(page, 'password1234');
  await expect(page.getByRole('alert')).toContainText('appeared in a data breach');
  await setPassword(page, PASSWORD);

  // Step 2: read the setup key like a person would and enter the current code.
  await expect(page.getByRole('heading', { name: 'Add an authenticator' })).toBeVisible();
  await expect(page.getByRole('img', { name: /qr code/i })).toBeVisible();
  const setupKey = (await page.locator('.setup-key').textContent())!;
  await expectTouchTargets(page, 'setup: authenticator');
  // Back during setup never reaches a signed-in screen.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Add an authenticator' })).toBeVisible();
  await page.getByLabel(/6-digit code/i).fill(totp(setupKey));
  await page.getByRole('button', { name: 'Confirm' }).click();

  // Step 3: what is sent to Claude.
  await expect(page.getByRole('heading', { name: 'What is sent to Claude' })).toBeVisible();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  // SC-003: first sign-in well within 3 minutes of app time (the test types instantly).
  expect(Date.now() - started).toBeLessThan(30_000);

  // Sign out; Back must not show the app again (US1.3).
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toHaveCount(0);

  // The invite code was single-use.
  await page.goto('/');
  await signIn(page, username, code);
  await expect(page.getByRole('alert')).toHaveText(SIGN_IN_FAILED);

  // A normal sign-in: password, then the next code (the current one was just used).
  const signInStarted = Date.now();
  await signIn(page, username, PASSWORD, totp(setupKey, new Date(Date.now() + 30_000)));
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  expect(Date.now() - signInStarted).toBeLessThan(20_000);
});

test('a setup left before the authenticator resumes at authenticator setup, with no code screen', async ({
  page,
}, testInfo) => {
  const username = uniqueUsername(`${testInfo.project.name.replace('auth-', '')}r`);
  const code = invite(username);
  await page.goto('/');
  await signIn(page, username, code);
  await setPassword(page, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Add an authenticator' })).toBeVisible();

  // Closed here. Next time, the chosen password goes straight back to authenticator setup.
  await page.context().clearCookies();
  await page.goto('/');
  await signIn(page, username, PASSWORD);

  await expect(page.getByRole('heading', { name: 'Add an authenticator' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enter your authenticator code' })).toHaveCount(0);
});

test('every kind of wrong sign-in gets the same message, before any code is asked for', async ({
  page,
}, testInfo) => {
  const username = uniqueUsername(`${testInfo.project.name.replace('auth-', '')}w`);
  invite(username);
  await page.goto('/');

  for (const [user, password] of [
    [username, 'not the invite code'],
    ['nobody-here', 'anything at all'],
    [username, 'still wrong'],
  ] as const) {
    await signIn(page, user, password);
    await expect(page.getByRole('alert')).toHaveText(SIGN_IN_FAILED);
    await expect(page.getByRole('heading', { name: 'Enter your authenticator code' })).toHaveCount(
      0,
    );
  }
});
