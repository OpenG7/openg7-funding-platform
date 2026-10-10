import { expect, type Page } from '@playwright/test';

/** Wait for each dismissed toast's render before selecting the next one. */
export async function dismissContributionToasts(page: Page): Promise<void> {
  const toasts = page.locator('[data-og7="contribution-toast"]');
  while (await toasts.count()) {
    const id = await toasts.first().getAttribute('data-og7-id');
    expect(id).toBeTruthy();
    const toast = page.locator(
      `[data-og7="contribution-toast"][data-og7-id="${id}"]`
    );
    await toast.getByRole('button', { name: 'Fermer', exact: true }).click();
    // .first() would now refer to the next notification. Wait on this id.
    await expect(toast).toHaveCount(0);
  }
  await expect(toasts).toHaveCount(0);
}
