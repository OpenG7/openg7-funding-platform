import type { Page } from '@playwright/test';

import { expect } from './test.js';

/** Reveal optional fields through the same keyboard interaction as the user. */
export async function openFollowupPresentation(page: Page): Promise<void> {
  const presentation = page.locator('[data-og7="followup-presentation"]');
  await expect(presentation).toBeVisible();
  if (
    !(await presentation.evaluate((node) => (node as HTMLDetailsElement).open))
  ) {
    await presentation.locator('summary').focus();
    await page.keyboard.press('Enter');
  }
  await expect(presentation).toHaveJSProperty('open', true);
}
