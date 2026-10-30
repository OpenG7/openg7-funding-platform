import { expect, type Page } from '@playwright/test';

/** Exercise a retained personal bookmark after its menu entry has been retired. */
export async function restoreLegacyGuideMode(
  page: Page,
  mode: 'payment' | 'automatic' | 'workflows'
) {
  await expect(
    page.locator('[data-og7="admin-guidance-toggle"]')
  ).toBeVisible();
  const reload = await page.evaluate(async (selectedMode) => {
    const response = await fetch('/api/admin/auth/current');
    if (!response.ok)
      throw new Error('The bookmark fixture requires a session');
    const identity = (await response.json()) as { id: string };
    const key = `og7-admin-guidance:v1:${identity.id}`;
    const snapshot = JSON.parse(localStorage.getItem(key) ?? 'null') as Record<
      string,
      unknown
    > | null;
    if (snapshot?.['enabled'] === true && snapshot['mode'] === selectedMode)
      return false;
    localStorage.setItem(
      key,
      JSON.stringify({
        bookmark: null,
        ...snapshot,
        enabled: true,
        mode: selectedMode
      })
    );
    return true;
  }, mode);
  if (reload) await page.reload();
  await expect(page.locator('[data-og7="admin-guidance-panel"]')).toBeVisible();
}
