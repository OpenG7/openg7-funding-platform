import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, type BrowserType, type Page } from '@playwright/test';

/** Complete the fixture's OIDC sign-in in an existing browser context. */
export async function signInAdminIdentity(
  page: Page,
  path: string,
  role = 'owner'
) {
  await page.goto('/admin/login?returnUrl=' + encodeURIComponent(path));
  await page.locator('[data-og7="identity-sign-in"]').click();
  await page.getByLabel('Compte de test').selectOption(role);
  await page.getByRole('button', { name: 'Continuer' }).click();
}

/** Real OIDC login against the identity stack owned by the calling recipe. */
export async function openAdminIdentity(
  browser: BrowserType,
  origin: string,
  path: string,
  role = 'owner',
  language = 'fr-CA'
) {
  const context = await browser.launchPersistentContext(
    await mkdtemp(join(tmpdir(), 'og7-admin-journey-')),
    { baseURL: origin, viewport: { width: 1280, height: 1000 } }
  );
  try {
    await context.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    const page = context.pages()[0]!;
    page.setDefaultTimeout(10000);
    await signInAdminIdentity(page, path, role);
    await expect(page).toHaveURL(origin + path);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}
