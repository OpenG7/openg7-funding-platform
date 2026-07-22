import { expect, test } from '@playwright/test';

// Covers FR/EN navigation, the sitemap, and the prerendered English routes
// (apps/funding-web/src/app/app.routes.server.ts marks 'commanditaires' and
// 'en/commanditaires' as RenderMode.Prerender), which the existing specs
// only ever exercise through the default French routes.

test.describe('Docker FR/EN navigation', () => {
  test('switches from French to English via the header toggle and stays on the equivalent page', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs');
    await expect(
      page.getByRole('heading', { name: /13 outils\./i })
    ).toBeVisible();

    await page
      .getByRole('button', { name: /Switch site language to English/i })
      .click();

    await expect(page).toHaveURL(/\/en\/fonds-des-batisseurs$/);
    await expect(
      page.getByRole('heading', { name: /13 tools\./i })
    ).toBeVisible();

    await page.locator('nav').getByRole('link', { name: 'Sponsors' }).click();

    await expect(page).toHaveURL(/\/en\/commanditaires$/);
    await expect(
      page.getByRole('heading', { name: 'OpenG7 Sponsors' })
    ).toBeVisible();
  });

  test('serves the sitemap with both French and English sponsor URLs', async ({
    request
  }) => {
    const response = await request.get('/sitemap.xml');
    await expect(response).toBeOK();
    expect(response.headers()['content-type']).toContain('xml');

    const body = await response.text();
    expect(body).toContain('https://openg7.org/commanditaires');
    expect(body).toContain('https://openg7.org/en/commanditaires');
  });

  test('serves the prerendered French and English sponsors routes without client-side JavaScript', async ({
    request
  }) => {
    const frResponse = await request.get('/commanditaires');
    await expect(frResponse).toBeOK();
    expect(await frResponse.text()).toContain('Commanditaires OpenG7');

    const enResponse = await request.get('/en/commanditaires');
    await expect(enResponse).toBeOK();
    expect(await enResponse.text()).toContain('OpenG7 Sponsors');
  });
});
