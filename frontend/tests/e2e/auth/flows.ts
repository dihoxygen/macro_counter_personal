import { expect, type Page } from '@playwright/test';
import { totp } from './totp';

export const PASSWORD = 'a long and private test passphrase';

export async function signIn(page: Page, username: string, password: string, code?: string) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password or temporary code').fill(password);
  if (code) await page.getByLabel(/authenticator code/i).fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/**
 * Signs in with a temporary code and completes first-time setup through the UI. Returns the setup key so
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
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  return setupKey;
}

/** A code from a later 30-second step, so it differs from one just used (replay guard). */
export function nextCode(setupKey: string, stepsAhead = 1): string {
  return totp(setupKey, new Date(Date.now() + 30_000 * stepsAhead));
}
