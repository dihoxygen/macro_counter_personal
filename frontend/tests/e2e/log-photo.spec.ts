import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { composer, egg, estimate, inspectJpeg, mockApi, multipartFile, toast, total, withOrientation } from './helpers';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'meal-with-gps.jpg');

/** Mocks the photo endpoint and records each uploaded photo part and the form field names. */
async function capturePhotoUploads(page: Page) {
  const uploads: { type: string; bytes: Buffer; fields: string[] }[] = [];
  await mockApi(page);
  await page.route(
    (url) => url.pathname === '/api/estimates/photo',
    async (route) => {
      const request = route.request();
      const contentType = (await request.allHeaders())['content-type'] ?? '';
      const body = request.postDataBuffer()!;
      // "; name=" — not the filename="..." attribute.
      const fields = [...body.toString('latin1').matchAll(/; name="([^"]+)"/g)].map((m) => m[1]!);
      uploads.push({ ...multipartFile(body, contentType, 'photo'), fields });
      await route.fulfill({ json: estimate(egg, toast) });
    },
  );
  return uploads;
}

/** Feature 004: the photo step is the composer's Photo method, on Today. */
async function openPhotoStep(page: Page) {
  await page.goto('/');
  await composer(page).getByRole('button', { name: 'Photo' }).click();
}

test.describe('Log a food from a photo (feature 001 US3, feature 002 US1)', () => {
  test('V6 + V13: a library photo is a resized JPEG with no EXIF, and confirming logs the items', async ({ page }) => {
    // The fixture really does carry EXIF GPS data before upload.
    expect(inspectJpeg(readFileSync(fixture)).hasExif).toBe(true);
    const uploads = await capturePhotoUploads(page);

    await openPhotoStep(page);
    await page.getByLabel('Existing photo file').setInputFiles(fixture);
    await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();
    await page.getByLabel(/note/i).fill('fried in oil');
    await page.getByRole('button', { name: 'Estimate' }).click();

    await expect(page.getByRole('group', { name: 'Scrambled eggs' })).toBeVisible();
    expect(uploads).toHaveLength(1);
    const upload = uploads[0]!;
    expect(upload.fields).toEqual(['photo', 'note']);
    expect(upload.type).toBe('image/jpeg');
    const jpeg = inspectJpeg(upload.bytes);
    expect(jpeg.hasExif).toBe(false);
    expect([jpeg.width, jpeg.height]).toEqual([1568, 1176]);

    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Scrambled eggs');
    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Whole wheat toast with butter');
    await expect(total(page, 'Calories')).toContainText('253 kcal');
    await expect(total(page, 'Protein')).toContainText('13.6 g');
  });

  test('the photo step offers both sources, and the library input never forces the camera (FR-001, FR-002)', async ({
    page,
  }) => {
    await mockApi(page);
    await openPhotoStep(page);
    await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose existing photo' })).toBeVisible();
    expect(await page.getByLabel('Existing photo file').getAttribute('capture')).toBeNull();
  });

  test('a non-image file is rejected before anything is sent (FR-012)', async ({ page }) => {
    const uploads = await capturePhotoUploads(page);
    await openPhotoStep(page);
    await page
      .getByLabel('Existing photo file')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });

    await expect(page.getByRole('alert')).toHaveText("This photo couldn't be used. Choose another photo.");
    await page.getByRole('button', { name: 'Estimate' }).click();
    await expect(page.getByRole('alert')).toHaveText('Choose or take a photo first.');
    expect(uploads).toHaveLength(0);
  });

  test('a photo with an EXIF rotation is sent upright and still without EXIF (FR-011)', async ({ page }) => {
    const uploads = await capturePhotoUploads(page);
    const rotated = withOrientation(readFileSync(fixture), 6);
    expect(inspectJpeg(rotated).hasExif).toBe(true);

    await openPhotoStep(page);
    await page
      .getByLabel('Existing photo file')
      .setInputFiles({ name: 'rotated.jpg', mimeType: 'image/jpeg', buffer: rotated });
    await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Estimate' }).click();

    await expect(page.getByRole('group', { name: 'Scrambled eggs' })).toBeVisible();
    const jpeg = inspectJpeg(uploads[0]!.bytes);
    expect([jpeg.width, jpeg.height]).toEqual([1176, 1568]);
    expect(jpeg.hasExif).toBe(false);
  });
});

// The desktop file dialog flow: the mobile project leaves out @desktop-only tests (playwright.config.ts).
test('desktop: both sources, and a file chosen from disk (feature 002 US3)', { tag: '@desktop-only' }, async ({ page }) => {
  const uploads = await capturePhotoUploads(page);
  await openPhotoStep(page);
  // The fake camera exists, so the live camera is offered next to the file dialog.
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeEnabled();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose existing photo' }).click();
  const fileChooser = await chooser;
  expect(fileChooser.isMultiple()).toBe(false);
  await fileChooser.setFiles(fixture);

  await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Estimate' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('list', { name: /entries/i })).toContainText('Scrambled eggs');
  expect(uploads).toHaveLength(1);
});
