import type { Page } from '@playwright/test';

import { expect } from './test.js';

export const fontFamilies = (value: string) =>
  value.split(',').map((family) => family.trim().replace(/^['"]|['"]$/g, ''));

/** Wait for faces used by the real rendered admin page, without forcing a load. */
export async function expectAdminFontsReady(page: Page) {
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      inter: document.fonts.check('400 16px Inter', 'Administration'),
      sora: document.fonts.check('600 26px Sora', 'Administration'),
      faces: Array.from(document.fonts, (face) => ({
        family: face.family.replace(/^['"]|['"]$/g, ''),
        weight: face.weight,
        status: face.status
      }))
    };
  });
  expect(fonts.inter).toBe(true);
  expect(fonts.sora).toBe(true);
  for (const family of ['Inter', 'Sora']) {
    expect(
      fonts.faces.some(
        (face) =>
          face.family === family &&
          face.status === 'loaded' &&
          face.weight === '400 700'
      ),
      `${family}: locally loaded variable face 400–700`
    ).toBe(true);
  }
}

export function watchFontRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') requests.push(request.url());
  });
  return requests;
}

export function expectLocalAdminFonts(requests: string[], pageUrl: string) {
  expect(requests.length).toBeGreaterThan(0);
  const origin = new URL(pageUrl).origin;
  for (const request of requests) {
    const url = new URL(request);
    expect(url.origin).toBe(origin);
    expect(url.pathname).toMatch(/\.woff2$/);
  }
  for (const family of ['inter', 'sora'])
    expect(requests.some((url) => url.toLowerCase().includes(family))).toBe(
      true
    );
}
