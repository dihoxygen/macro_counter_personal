import { expect, test, type Page } from '@playwright/test';
import { invite, uniqueUsername } from './db';
import { completeSetup, nextCode, PASSWORD, SIGN_IN_FAILED, signIn } from './flows';

// 004 US1 / quickstart 5–7, 9: the password first, then the authenticator code on its own screen.

async function setUpAndSignOut(
  page: Page,
  suffix: string,
  project: string,
): Promise<{ username: string; key: string }> {
  const username = uniqueUsername(`${project.replace('auth-', '')}${suffix}`);
  await page.goto('/');
  const key = await completeSetup(page, username, invite(username));
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  return { username, key };
}

const codeScreen = (page: Page) =>
  page.getByRole('heading', { name: 'Enter your authenticator code' });

test('a wrong password fails on the sign-in screen; the right one asks for the code, then Today', async ({
  page,
}, testInfo) => {
  const { username, key } = await setUpAndSignOut(page, 'm', testInfo.project.name);

  // Quickstart 5: a wrong password never reaches the code screen.
  await signIn(page, username, 'not the password at all');
  await expect(page.getByRole('alert')).toHaveText(SIGN_IN_FAILED);
  await expect(codeScreen(page)).toHaveCount(0);

  // Quickstart 6: an unknown name looks the same.
  await signIn(page, 'nobody-at-all', 'not the password at all');
  await expect(page.getByRole('alert')).toHaveText(SIGN_IN_FAILED);
  await expect(codeScreen(page)).toHaveCount(0);

  // Quickstart 7: the right password, a wrong code, then the right code.
  await signIn(page, username, PASSWORD);
  await expect(codeScreen(page)).toBeVisible();
  await expect(page.getByLabel('Authenticator code')).toBeFocused();
  const right = nextCode(key);
  await page.getByLabel('Authenticator code').fill(right === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toHaveText('That code is incorrect. Try again.');
  await page.getByLabel('Authenticator code').fill(right);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});

test('"Use a different account" goes back to the password screen', async ({ page }, testInfo) => {
  const { username } = await setUpAndSignOut(page, 'b', testInfo.project.name);

  await signIn(page, username, PASSWORD);
  await expect(codeScreen(page)).toBeVisible();
  await page.getByRole('button', { name: 'Use a different account' }).click();

  await expect(page.getByLabel('Password (or Invite Code)')).toBeVisible();
  // The pending sign-in is gone: a reload stays on the password screen.
  await page.reload();
  await expect(page.getByLabel('Password (or Invite Code)')).toBeVisible();
  await expect(codeScreen(page)).toHaveCount(0);
});

test('a reload on the code screen keeps asking for the code', async ({ page }, testInfo) => {
  const { username, key } = await setUpAndSignOut(page, 'l', testInfo.project.name);

  await signIn(page, username, PASSWORD);
  await expect(codeScreen(page)).toBeVisible();
  await page.reload();

  await expect(codeScreen(page)).toBeVisible();
  await page.getByLabel('Authenticator code').fill(nextCode(key));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});

test.describe('at 360 px (FR-023)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  async function expectFitsAndTappable(page: Page, names: string[]) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    for (const name of names) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
  }

  test('the sign-in and code screens fit and are easy to tap', async ({ page }, testInfo) => {
    const { username } = await setUpAndSignOut(page, 'n', testInfo.project.name);
    await expectFitsAndTappable(page, ['Sign in']);

    await signIn(page, username, PASSWORD);
    await expect(codeScreen(page)).toBeVisible();
    await expectFitsAndTappable(page, ['Verify', 'Use a different account']);
  });
});
