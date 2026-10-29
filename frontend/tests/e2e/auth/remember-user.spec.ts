import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { invite, uniqueUsername } from './db';
import { completeSetup, nextCode, PASSWORD, signIn, signOut } from './flows';

// 004 US3 / quickstart 10–13: Remember User skips only the authenticator code, on one browser, for one account.

const codeScreen = (page: Page) =>
  page.getByRole('heading', { name: 'Enter your authenticator code' });
const today = (page: Page) => page.getByRole('heading', { level: 1, name: 'Today' });
const rememberBox = (page: Page) => page.getByRole('checkbox', { name: 'Remember User' });

/** A second browser profile: its own cookies, nothing remembered. */
async function otherBrowser(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({ ...testInfo.project.use });
  const page = await context.newPage();
  await page.goto('/');
  return page;
}

async function newAccount(page: Page, testInfo: TestInfo, suffix: string) {
  const username = uniqueUsername(`${testInfo.project.name.replace('auth-', '')}${suffix}`);
  await page.goto('/');
  const key = await completeSetup(page, username, invite(username));
  await signOut(page);
  return { username, key };
}

test('a ticked box skips the code next time on this browser only, until unticked', async ({
  page,
  browser,
}, testInfo) => {
  const { username, key } = await newAccount(page, testInfo, 'k');
  await expect(rememberBox(page)).not.toBeChecked();

  // Quickstart 10: tick, enter the code once; after signing out, the password alone is enough.
  await signIn(page, username, PASSWORD, nextCode(key), { remember: true });
  await expect(today(page)).toBeVisible();
  await signOut(page);
  await expect(rememberBox(page)).toBeChecked();
  await signIn(page, username, PASSWORD);
  await expect(today(page)).toBeVisible();
  await expect(codeScreen(page)).toHaveCount(0);

  // Quickstart 11: another browser profile still asks for the code.
  const other = await otherBrowser(browser, testInfo);
  await expect(rememberBox(other)).not.toBeChecked();
  await signIn(other, username, PASSWORD);
  await expect(codeScreen(other)).toBeVisible();
  await other.context().close();

  // Quickstart 12: unticking forgets this browser.
  await signOut(page);
  await signIn(page, username, PASSWORD, nextCode(key, 2), { remember: false });
  await expect(today(page)).toBeVisible();
  await signOut(page);
  await expect(rememberBox(page)).not.toBeChecked();
  await signIn(page, username, PASSWORD);
  await expect(codeScreen(page)).toBeVisible();
});

test('a second account that leaves the pre-ticked box alone neither gets remembered nor displaces the first', async ({
  page,
}, testInfo) => {
  // Quickstart 12a.
  const alice = await newAccount(page, testInfo, 'a');
  const bob = await newAccount(page, testInfo, 'o');

  await signIn(page, alice.username, PASSWORD, nextCode(alice.key), { remember: true });
  await expect(today(page)).toBeVisible();
  await signOut(page);

  await expect(rememberBox(page)).toBeChecked();
  await signIn(page, bob.username, PASSWORD, nextCode(bob.key));
  await expect(today(page)).toBeVisible();
  await signOut(page);

  await signIn(page, alice.username, PASSWORD);
  await expect(today(page)).toBeVisible();
  await signOut(page);
  await signIn(page, bob.username, PASSWORD);
  await expect(codeScreen(page)).toBeVisible();
});

test('"Sign out everywhere" on another browser ends remembering here', async ({
  page,
  browser,
}, testInfo) => {
  // Quickstart 13.
  const { username, key } = await newAccount(page, testInfo, 'e');
  await signIn(page, username, PASSWORD, nextCode(key), { remember: true });
  await expect(today(page)).toBeVisible();
  await signOut(page);

  const other = await otherBrowser(browser, testInfo);
  await signIn(other, username, PASSWORD, nextCode(key, 2));
  await expect(today(other)).toBeVisible();
  await other.getByRole('button', { name: 'Account' }).click();
  await other.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(other.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await other.context().close();

  await page.reload();
  await expect(rememberBox(page)).not.toBeChecked();
  await signIn(page, username, PASSWORD);
  await expect(codeScreen(page)).toBeVisible();
});
