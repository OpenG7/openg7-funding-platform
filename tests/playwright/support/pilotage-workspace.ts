import { expect, type Page } from '@playwright/test';

/** Follow the visible drawer entry before using its deferred controls. */
export async function openPilotageWorkspace(page: Page): Promise<void> {
  const spaces = page.locator('[data-og7="pilot-domains"]');
  if (!(await spaces.isVisible()))
    await page.locator('[data-og7="pilot-workspace-tools"]').click();
  await expect(spaces).toBeVisible();
}

export async function openPilotageProgramme(page: Page): Promise<void> {
  await openPilotageWorkspace(page);
  await page.locator('[data-og7="open-programme"]').click();
  await expect(page).toHaveURL(/\/publications\/programme(?:\?|$)/);
}
