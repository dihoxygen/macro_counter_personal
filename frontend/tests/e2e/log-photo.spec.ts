import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { egg, estimate, inspectJpeg, mockApi, multipartFile, toast, total } from './helpers';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'meal-with-gps.jpg');

test.describe('Log a food from a photo (User Story 3)', () => {
  test('V6 + V13: the uploaded photo is a resized JPEG with no EXIF, and confirming logs the items', async ({ page }) => {
    // The fixture really does carry EXIF GPS data before upload.
    const { readFileSync } = await import('node:fs');
    expect(inspectJpeg(readFileSync(fixture)).hasExif).toBe(true);

    let upload: { type: string; bytes: Buffer } | undefined;
    let fields: string[] = [];
    await mockApi(page);
    await page.route(
      (url) => url.pathname === '/api/estimates/photo',
      async (route) => {
        const request = route.request();
        const contentType = (await request.allHeaders())['content-type'] ?? '';
        const body = request.postDataBuffer()!;
        upload = multipartFile(body, contentType, 'photo');
        // "; name=" — not the filename="..." attribute.
        fields = [...body.toString('latin1').matchAll(/; name="([^"]+)"/g)].map((m) => m[1]!);
        await route.fulfill({ json: estimate(egg, toast) });
      },
    );

    await page.goto('/');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: 'Photo' }).click();
    await page.getByLabel(/photo/i).setInputFiles(fixture);
    await page.getByLabel(/note/i).fill('fried in oil');
    await page.getByRole('button', { name: 'Estimate' }).click();

    await expect(page.getByRole('group', { name: 'Scrambled eggs' })).toBeVisible();
    expect(fields).toEqual(['photo', 'note']);
    expect(upload!.type).toBe('image/jpeg');
    const jpeg = inspectJpeg(upload!.bytes);
    expect(jpeg.hasExif).toBe(false);
    expect(Math.max(jpeg.width, jpeg.height)).toBeLessThanOrEqual(1568);
    expect([jpeg.width, jpeg.height]).toEqual([1568, 1176]);

    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Scrambled eggs');
    await expect(page.getByRole('list', { name: /entries/i })).toContainText('Whole wheat toast with butter');
    await expect(total(page, 'Calories')).toContainText('253 kcal');
    await expect(total(page, 'Protein')).toContainText('13.6 g');
  });
});
