import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { banana, estimate, liveTrackCount, mockApi, recordMediaStreams } from './helpers';

const photo = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'meal-with-gps.jpg');

const MIN = 44;

/** Every visible button, link and form control must be at least 44×44 CSS px (Principle IV). */
async function expectTouchTargets(page: Page, view: string) {
  const small = await page.evaluate((min) => {
    const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          what: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((t) => t.width < min || t.height < min);
  }, MIN);
  expect(small, `targets smaller than ${MIN}px on ${view}`).toEqual([]);
}

test.describe('Touch targets', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch targets are checked at the mobile viewport');

  test('every view meets the 44×44 px minimum', async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await recordMediaStreams(page);
    await mockApi(page, {
      text: (route) =>
        route.fulfill({
          json: estimate({ ...banana, macros: { ...banana.macros, kcal: 300 }, flags: ['calorie_macro_mismatch'] }),
        }),
    });
    await page.goto('/');
    await expectTouchTargets(page, 'Today (empty)');

    // Add food: describe, review (with a warning and the editor open), photo, manual.
    await page.getByRole('button', { name: 'Add food' }).click();
    await expectTouchTargets(page, 'Add food / describe');
    await page.getByLabel(/what did you eat/i).fill('banana');
    await page.getByRole('button', { name: 'Estimate' }).click();
    await page.getByRole('group', { name: 'Banana' }).waitFor();
    await expectTouchTargets(page, 'Review');
    await page.getByRole('button', { name: /edit/i }).click();
    await expectTouchTargets(page, 'Review / editing');
    await page.getByRole('button', { name: /done/i }).click();
    await page.getByRole('button', { name: /add item/i }).click();
    await expectTouchTargets(page, 'Review / add item');
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await page.getByRole('button', { name: /yes, these values are right/i }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: 'Photo' }).click();
    await expectTouchTargets(page, 'Add food / photo');
    await page.getByLabel('Existing photo file').setInputFiles(photo);
    await page.getByRole('img', { name: 'Selected photo' }).waitFor();
    await expectTouchTargets(page, 'Photo step (selected)');
    await page.getByRole('button', { name: 'Take photo' }).click();
    await page.getByLabel('Camera preview').waitFor();
    await expectTouchTargets(page, 'Photo step (live camera)');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => liveTrackCount(page)).toBe(0);
    await page.getByRole('button', { name: 'Manual' }).click();
    await expectTouchTargets(page, 'Add food / manual');
    await page.getByRole('button', { name: /back/i }).click();

    // Today with an entry, and the entry editor.
    await expectTouchTargets(page, 'Today (with entries)');
    await page.getByRole('button', { name: /banana/i }).click();
    await expectTouchTargets(page, 'Entry editor');
    await page.getByRole('button', { name: /^delete$/i }).click();
    await expectTouchTargets(page, 'Entry editor / delete');
    await page.getByRole('button', { name: /keep/i }).click();
    await page.getByRole('button', { name: /^cancel$/i }).click();

    // Recent, history, goal.
    await page.getByRole('button', { name: /^recent$/i }).click();
    await expectTouchTargets(page, 'Recent');
    await page.getByRole('button', { name: /banana/i }).click();
    await expectTouchTargets(page, 'Recent / re-log');
    await page.getByRole('button', { name: /back to list/i }).click();
    await page.getByRole('button', { name: /← back/i }).click();

    await page.getByRole('button', { name: /previous days/i }).click();
    await expectTouchTargets(page, 'Previous days');
    await page.getByRole('button', { name: /← back/i }).click();

    await page.getByRole('button', { name: /set a protein goal/i }).click();
    await expectTouchTargets(page, 'Protein goal');
  });
});
