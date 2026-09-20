import { AxeBuilder } from '@axe-core/playwright';

import { BOUTIQUE_FEATURED_PRODUCTS as products } from '../../apps/funding-web/src/app/features/funding/config/boutique-products.config.js';

import { expect, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
});

for (const language of ['fr-CA', 'en']) {
  const english = language === 'en';
  const prefix = english ? '/en' : '';

  test(`selection is translated, accessible and usable on mobile (${language})`, async ({
    page
  }) => {
    const errors: string[] = [];
    const photoRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('/assets/boutique/'))
        photoRequests.push(request.url());
    });
    await page.goto(`${prefix}/boutique`);
    await page
      .getByRole('link', {
        name: english ? 'Explore the selection' : 'Découvrir la sélection',
        exact: true
      })
      .focus();
    await page.keyboard.press('Enter');
    const selection = page.locator('[data-og7="boutique-featured"]');
    await expect(page).toHaveURL(/#featured-products$/);
    await expect(selection).toBeFocused();
    await expect(
      selection.getByText(english ? 'Featured products' : 'Produits vedettes', {
        exact: true
      })
    ).toBeVisible();
    await expect(
      selection.locator('[data-og7="boutique-product"]')
    ).toHaveCount(products.length);

    for (const product of products) {
      const card = selection.locator(`[data-og7-id="${product.id}"]`);
      if (!product.image) {
        await expect(
          card.getByText(english ? 'Photo coming soon' : 'Visuel à venir', {
            exact: true
          })
        ).toBeVisible();
        await expect(card.locator('img')).toHaveCount(0);
      }
      if (!product.price)
        await expect(
          card.locator('[data-og7="boutique-product-price"]')
        ).toHaveCount(0);
      if (product.availability !== 'available' || !product.productUrl) {
        await expect(card.getByRole('link')).toHaveCount(0);
      } else {
        await expect(card.getByRole('link')).toHaveAttribute(
          'href',
          product.productUrl
        );
        await expect(card.getByRole('link')).toHaveAttribute(
          'target',
          '_blank'
        );
      }
    }
    if (products.every((product) => !product.image))
      expect(photoRequests).toEqual([]);

    const filters = selection.getByRole('group', {
      name: english
        ? 'Explore creations by realm'
        : 'Explorer les créations par univers'
    });
    for (const [universe, label] of [
      ['dragons', 'Dragons'],
      ['princesses', 'Princesses'],
      ['unicorns', english ? 'Unicorns' : 'Licornes']
    ]) {
      const filter = filters.getByRole('button', { name: label, exact: true });
      await filter.focus();
      await page.keyboard.press('Space');
      await expect(filter).toBeFocused();
      await expect(filter).toHaveAttribute('aria-pressed', 'true');
      await expect(filters.locator('button[aria-pressed="true"]')).toHaveCount(
        1
      );
      const matching = products.filter(
        (product) => product.universe === universe
      );
      await expect(
        selection.locator('[data-og7="boutique-product"]')
      ).toHaveCount(matching.length);
      await expect(selection.getByRole('status')).toHaveText(
        `${english ? 'Creations to discover:' : 'Créations à découvrir :'} ${matching.length}`
      );
      for (const product of products) {
        await expect(
          selection.locator(`[data-og7-id="${product.id}"]`)
        ).toHaveCount(product.universe === universe ? 1 : 0);
      }
    }
    await filters
      .getByRole('button', {
        name: english ? 'All realms' : 'Tous les univers',
        exact: true
      })
      .click();
    await expect(
      selection.locator('[data-og7="boutique-product"]')
    ).toHaveCount(products.length);
    expect(
      await selection.evaluate((element) =>
        Boolean(
          element.compareDocumentPosition(
            document.querySelector('[aria-labelledby="collections-title"]')!
          ) & Node.DOCUMENT_POSITION_FOLLOWING
        )
      )
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-og7="boutique-featured"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(errors).toEqual([]);
    await expect(
      page.getByRole('link', {
        name: english ? 'Return home' : 'Retour à l’accueil',
        exact: true
      })
    ).toHaveAttribute('href', english ? '/en' : '/');
  });

  test.describe(`server rendering (${language})`, () => {
    test.use({ javaScriptEnabled: false });

    test('selection is present without JavaScript', async ({ page }) => {
      await page.goto(`${prefix}/boutique`);
      const selection = page.locator('[data-og7="boutique-featured"]');
      await expect(
        selection.getByText(
          english ? 'Featured products' : 'Produits vedettes',
          { exact: true }
        )
      ).toBeVisible();
      await expect(
        selection.locator('[data-og7="boutique-product"]')
      ).toHaveCount(products.length);
    });
  });
}
