import type { Page, TestInfo } from '@playwright/test';

import { expect } from './test.js';
import { expectAdminFontsReady } from './admin-fonts.js';

export async function prepareAdminDesignReview(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem(
      'openg7.pilotage.appearance.v1',
      JSON.stringify({ theme: 'mineral', system: false })
    );
  });
}

export async function expectAdminPageFits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
}

export async function captureAdminDesign(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fullPage = false
) {
  await expectAdminFontsReady(page);
  await expectAdminPageFits(page);
  await page.screenshot({
    path: testInfo.outputPath(name + '.png'),
    animations: 'disabled',
    fullPage
  });
}

export async function blockAdminReviewWrites(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fallback();
    writes.push(request.method() + ' ' + new URL(request.url()).pathname);
    return route.fulfill({ status: 405, json: {} });
  });
  return writes;
}
