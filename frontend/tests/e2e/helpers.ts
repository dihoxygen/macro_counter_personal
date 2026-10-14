import type { Page, Route } from '@playwright/test';

export const banana = {
  name: 'Banana',
  portion: { amount: 118, unit: 'g' },
  portionDescription: '1 medium banana (~118 g)',
  macros: { kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 },
  flags: [] as string[],
};

export const egg = {
  name: 'Scrambled eggs',
  portion: { amount: 100, unit: 'g' },
  portionDescription: '2 large eggs (~100 g)',
  macros: { kcal: 148, proteinG: 10, carbsG: 1.6, fatG: 11 },
  flags: [] as string[],
};

export const toast = {
  name: 'Whole wheat toast with butter',
  portion: { amount: 35, unit: 'g' },
  portionDescription: '1 slice (~30 g) with ~5 g butter',
  macros: { kcal: 105, proteinG: 3.6, carbsG: 12, fatG: 4.9 },
  flags: [] as string[],
};

type Item = typeof banana;

export function estimate(...items: Item[]) {
  const total = items.reduce(
    (acc, i) => ({
      kcal: acc.kcal + i.macros.kcal,
      proteinG: acc.proteinG + i.macros.proteinG,
      carbsG: acc.carbsG + i.macros.carbsG,
      fatG: acc.fatG + i.macros.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  return { recognized: items.length > 0, items, total, flags: [] };
}

/**
 * The session every mocked spec runs under. role "user" on purpose: an owner would trigger the one-time
 * adoption of pre-feature local data (US4), which these specs are not about.
 */
export const signedInSession = {
  state: 'signed_in',
  csrfToken: 'test',
  user: { id: '00000000-0000-4000-8000-000000000001', username: 'tester', role: 'user' },
};

/** Mocks every /api call; nothing reaches a real backend. */
export async function mockApi(
  page: Page,
  options: { aiAvailable?: boolean; text?: (route: Route) => Promise<void> | void } = {},
) {
  // Match on the path prefix: a glob like **/api/** would also catch Vite's /src/api/*.ts modules.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => route.fulfill({ status: 404, json: { title: 'not mocked', status: 404, code: 'invalid_request' } }),
  );
  await page.route(
    (url) => url.pathname === '/api/auth/session',
    (route) => route.fulfill({ json: signedInSession }),
  );
  await page.route(
    (url) => url.pathname === '/api/status',
    (route) => route.fulfill({ json: { aiAvailable: options.aiAvailable ?? true } }),
  );
  if (options.text) await page.route((url) => url.pathname === '/api/estimates/text', options.text);
}

/** Reads a labelled total (e.g. "Protein") from the totals panel. */
export function total(page: Page, label: string) {
  return page.getByRole('region', { name: /totals/i }).getByRole('group', { name: label });
}

/** Extracts the named file part from a multipart/form-data body. */
export function multipartFile(body: Buffer, contentType: string, field: string): { type: string; bytes: Buffer } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) throw new Error(`no boundary in ${contentType}`);
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2); // skip CRLF after delimiter and before next
    const split = part.indexOf('\r\n\r\n');
    const headers = part.subarray(0, split).toString('utf8');
    if (headers.includes(`name="${field}"`)) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? '';
      return { type, bytes: part.subarray(split + 4) };
    }
    start = next;
  }
  throw new Error(`field ${field} not found`);
}

/** Lists JPEG segment markers and reads the frame size from the SOF header. */
export function inspectJpeg(bytes: Buffer): { width: number; height: number; hasExif: boolean } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  let offset = 2;
  let hasExif = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error(`bad marker at ${offset}`);
    const marker = bytes[offset + 1]!;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe1 && bytes.subarray(offset + 4, offset + 10).toString('latin1') === 'Exif\0\0') {
      hasExif = true;
    }
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), hasExif };
    }
    offset += 2 + length;
  }
  throw new Error('no SOF segment');
}
