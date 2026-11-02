import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../test';
import { composer, describeFood, reviewCard } from '../helpers';
import { invite, uniqueUsername } from './db';
import { completeSetup } from './flows';

// US7 / R11: the production build runs under the strict Content-Security-Policy with zero violations. The
// page is served by the backend itself (not the dev server), so its real headers apply.

const photo = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'meal-with-gps.jpg',
);
const backend = `http://localhost:${process.env.MACRO_E2E_API_PORT ?? '5080'}`;

test('sign-in, setup with the QR code, an estimate, a photo preview and the service worker break no CSP rule', async ({
  page,
}, testInfo) => {
  // Record every violation from the very first script on.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const consoleCsp: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text()))
      consoleCsp.push(message.text());
  });

  const response = await page.goto(`${backend}/`);
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");

  const username = uniqueUsername(`${testInfo.project.name.replace('auth-', '')}c`);
  await completeSetup(page, username, invite(username));

  // A text estimate (the Testing-only fake estimator answers).
  await describeFood(page, '1 medium banana');
  await expect(reviewCard(page).getByRole('group', { name: 'Banana' })).toBeVisible();
  await reviewCard(page).getByRole('button', { name: 'Discard' }).click();

  // A photo preview shown from a blob: URL.
  await composer(page).getByRole('button', { name: 'Photo' }).click();
  await page.getByLabel('Existing photo file').setInputFiles(photo);
  await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();

  // The service worker registers from its own script file.
  await page.evaluate(() => navigator.serviceWorker.ready);

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(violations).toEqual([]);
  expect(consoleCsp).toEqual([]);
});
