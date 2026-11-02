import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from '@playwright/test';
import { expect, test } from './test';
import {
  composer,
  egg,
  estimate,
  hidePage,
  inspectJpeg,
  liveTrackCount,
  mockApi,
  multipartFile,
  recordMediaStreams,
  showPage,
  toast,
  total,
} from './helpers';

// Chromium runs with --use-fake-device-for-media-stream (playwright.config.ts): a synthetic camera.
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'meal-with-gps.jpg');

let uploads: Buffer[];

test.beforeEach(async ({ page }) => {
  uploads = [];
  await recordMediaStreams(page);
  await mockApi(page);
  await page.route(
    (url) => url.pathname === '/api/estimates/photo',
    async (route) => {
      const request = route.request();
      const contentType = (await request.allHeaders())['content-type'] ?? '';
      uploads.push(multipartFile(request.postDataBuffer()!, contentType, 'photo').bytes);
      await route.fulfill({ json: estimate(egg, toast) });
    },
  );
});

/** Feature 004: the photo step is the composer's Photo method, on Today. */
async function openPhotoStep(page: Page) {
  await page.goto('/');
  await composer(page).getByRole('button', { name: 'Photo' }).click();
}

async function startCamera(page: Page) {
  await openPhotoStep(page);
  await page.getByRole('button', { name: 'Take photo' }).click();
  // SC-003: the preview appears within 3 s.
  await expect(page.getByLabel('Camera preview')).toBeVisible({ timeout: 3_000 });
  await expect.poll(() => liveTrackCount(page)).toBeGreaterThan(0);
}

/** SC-004: the camera is off within 2 s. */
async function expectCameraOff(page: Page) {
  await expect.poll(() => liveTrackCount(page), { timeout: 2_000 }).toBe(0);
}

test.describe('Live camera (feature 002 US2)', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera']);
  });

  test('take a snapshot, estimate and confirm; the camera turns off after the snapshot', async ({ page }) => {
    await startCamera(page);
    await page.getByRole('button', { name: 'Take snapshot' }).click();
    await expectCameraOff(page);
    await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();

    await page.getByRole('button', { name: 'Estimate' }).click();
    await expect(page.getByRole('group', { name: 'Scrambled eggs' })).toBeVisible();
    expect(uploads).toHaveLength(1);
    const jpeg = inspectJpeg(uploads[0]!);
    expect(jpeg.hasExif).toBe(false);
    expect(Math.max(jpeg.width, jpeg.height)).toBeLessThanOrEqual(1568);

    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Scrambled eggs');
    await expect(total(page, 'Calories')).toContainText('253 kcal');
  });

  test('Retake brings the live preview back', async ({ page }) => {
    await startCamera(page);
    await page.getByRole('button', { name: 'Take snapshot' }).click();
    await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();
    await expectCameraOff(page);

    await page.getByRole('button', { name: 'Retake' }).click();
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    await expect.poll(() => liveTrackCount(page)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Take snapshot' }).click();
    await expectCameraOff(page);
  });

  test('after a snapshot, the remembered camera starts again on the next visit', async ({ page }) => {
    await startCamera(page);
    await page.getByRole('button', { name: 'Take snapshot' }).click();
    await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();

    await page.reload();
    await composer(page).getByRole('button', { name: 'Photo' }).click();
    await page.getByRole('button', { name: 'Take photo' }).click();
    await expect(page.getByLabel('Camera preview')).toBeVisible({ timeout: 3_000 });
    await expect.poll(() => liveTrackCount(page)).toBeGreaterThan(0);
  });

  test('Cancel turns the camera off', async ({ page }) => {
    await startCamera(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expectCameraOff(page);
  });

  test('switching to Describe turns the camera off', async ({ page }) => {
    await startCamera(page);
    await composer(page).getByRole('button', { name: 'Describe' }).click();
    await expectCameraOff(page);
  });

  test('leaving Today turns the camera off (feature 004)', async ({ page }) => {
    await startCamera(page);
    await page.getByRole('button', { name: 'Previous days' }).click();
    await expectCameraOff(page);
  });

  test('hiding the app pauses the camera; it resumes only on request', async ({ page }) => {
    await startCamera(page);
    await hidePage(page);
    await expectCameraOff(page);
    await expect(page.getByRole('status')).toHaveText('Camera paused');

    await showPage(page);
    await expect(page.getByRole('button', { name: 'Resume camera' })).toBeVisible();
    expect(await liveTrackCount(page)).toBe(0);

    await page.getByRole('button', { name: 'Resume camera' }).click();
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    await expect.poll(() => liveTrackCount(page)).toBeGreaterThan(0);
  });

  test('works with the keyboard alone (FR-015)', async ({ page }) => {
    await openPhotoStep(page);
    const takePhoto = page.getByRole('button', { name: 'Take photo' });
    await expect(takePhoto).toBeEnabled(); // camera detection takes a moment
    await takePhoto.focus();
    await page.keyboard.press('Enter');
    const snapshot = page.getByRole('button', { name: 'Take snapshot' });
    await expect(snapshot).toBeVisible();
    await snapshot.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Estimate' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: 'Scrambled eggs' })).toBeVisible();
  });
});

test('permission denied: the user is told, and can still log an existing photo (SC-005)', async ({ page, context }) => {
  await context.clearPermissions();
  await openPhotoStep(page);
  await page.getByRole('button', { name: 'Take photo' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera access is blocked');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose existing photo' }).click();
  await (await chooser).setFiles(fixture);
  await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Estimate' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('list', { name: /entries/i })).toContainText('Scrambled eggs');
  expect(inspectJpeg(readFileSync(fixture)).hasExif).toBe(true);
  expect(inspectJpeg(uploads[0]!).hasExif).toBe(false);
});
