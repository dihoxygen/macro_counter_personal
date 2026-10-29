import { expect, type Page } from '@playwright/test';
import { totp } from './totp';

export const PASSWORD = 'a long and private test passphrase';

export const SIGN_IN_FAILED = 'Username or password is incorrect.';

/**
 * Signs in like a person (004 research R1): the password (or invite code) screen, then, if the password was
 * accepted and a `code` is given, the authenticator screen. A refused password leaves the alert showing.
 */
export async function signIn(
  page: Page,
  username: string,
  password: string,
  code?: string,
  options: { remember?: boolean } = {},
) {
  const passwordField = page.getByLabel('Password (or Invite Code)');
  await page.getByLabel('Username').fill(username);
  await passwordField.fill(password);
  if (options.remember !== undefined)
    await page.getByLabel('Remember User').setChecked(options.remember);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (!code) return;
  const codeScreen = page.getByRole('heading', { name: 'Enter your authenticator code' });
  // Either the code screen, or a refusal. A refusal clears the password, so a stale alert from an
  // earlier attempt (shown while the password is still filled in) does not count.
  await expect
    .poll(
      async () =>
        (await codeScreen.isVisible()) ||
        ((await page.getByRole('alert').first().isVisible()) &&
          (await passwordField.count()) > 0 &&
          (await passwordField.inputValue()) === ''),
    )
    .toBe(true);
  if (!(await codeScreen.isVisible())) return;
  await page.getByLabel('Authenticator code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}

/**
 * Signs in with an invite code and completes first-time setup through the UI. Returns the setup key so
 * later sign-ins can compute codes. Ends on Today.
 */
export async function completeSetup(
  page: Page,
  username: string,
  code: string,
  password = PASSWORD,
): Promise<string> {
  await signIn(page, username, code);
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password').fill(password);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('heading', { name: 'Add an authenticator' })).toBeVisible();
  const setupKey = (await page.locator('.setup-key').textContent())!;
  await page.getByLabel(/6-digit code/i).fill(totp(setupKey));
  await page.getByRole('button', { name: 'Confirm' }).click();
  // After an owner reset the notice was already acknowledged, so setup may end here.
  const today = page.getByRole('heading', { level: 1, name: 'Today' });
  const notice = page.getByRole('button', { name: 'I understand' });
  await expect(today.or(notice)).toBeVisible();
  if (await notice.isVisible()) await notice.click();
  await expect(today).toBeVisible();
  return setupKey;
}

/** A code from a later 30-second step, so it differs from one just used (replay guard). */
export function nextCode(setupKey: string, stepsAhead = 1): string {
  return totp(setupKey, new Date(Date.now() + 30_000 * stepsAhead));
}

/** Logs a food by hand from Today and returns to Today. */
export async function logManually(page: Page, name: string, protein: number) {
  await page.getByRole('button', { name: 'Add food' }).click();
  const manual = page.getByRole('button', { name: 'Manual' });
  if (await manual.isVisible()) await manual.click();
  await page.getByLabel(/food name/i).fill(name);
  await page.getByLabel(/amount/i).fill('100');
  await page.getByLabel(/calories/i).fill('200');
  await page.getByLabel(/protein/i).fill(String(protein));
  await page.getByLabel(/carbs/i).fill('10');
  await page.getByLabel(/fat/i).fill('5');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('list', { name: /entries/i })).toContainText(name);
}

export async function setProteinGoal(page: Page, grams: number) {
  await page.getByRole('button', { name: /set a protein goal/i }).click();
  await page.getByLabel(/daily protein goal/i).fill(String(grams));
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByRole('region', { name: /protein goal/i })).toContainText(`/ ${grams} g`);
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
}
