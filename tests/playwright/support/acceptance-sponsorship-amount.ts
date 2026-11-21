import type { Locator } from '@playwright/test';

import { expect } from './test.js';

/** Financial recipes retain their explicit amount independently of current presets. */
export async function setAcceptanceSponsorshipAmount(
  form: Locator,
  amount: number
): Promise<void> {
  expect(Number.isFinite(amount) && amount > 0).toBe(true);
  const input = form.locator('#custom-contribution');
  await expect(input).toBeEnabled();
  await input.fill(String(amount));
  await input.blur();
  expect(Number((await input.inputValue()).replace(',', '.'))).toBe(amount);
}
