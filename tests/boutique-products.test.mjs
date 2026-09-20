import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  BOUTIQUE_FEATURED_PRODUCTS as products,
  BOUTIQUE_UNIVERSES as universes
} from '../dist/apps/funding-web/src/app/features/funding/config/boutique-products.config.js';

const translations = ['fr-CA', 'en'].map((locale) =>
  JSON.parse(
    readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
  )
);
const translated = (dictionary, key) =>
  key.split('.').reduce((value, part) => value?.[part], dictionary);

test('featured products have unique IDs and translated editorial content', () => {
  assert.equal(
    new Set(products.map((product) => product.id)).size,
    products.length
  );
  for (const product of products) {
    assert.match(product.id, /^[a-z0-9-]+$/);
    assert.ok(universes.includes(product.universe), product.id);
    for (const dictionary of translations) {
      assert.ok(dictionary.funding.boutique.universes[product.universe]);
      for (const key of [product.titleKey, product.descriptionKey]) {
        assert.equal(typeof translated(dictionary, key), 'string', key);
        assert.ok(translated(dictionary, key).trim(), key);
      }
      assert.ok(
        dictionary.funding.boutique.product.status[product.availability]
      );
    }
  }
});

test('configured photos exist locally and have translated descriptions', () => {
  for (const { image } of products) {
    if (!image) continue;
    assert.match(
      image.src,
      /^assets\/boutique\/(?:(?:dragons|princesses|unicorns)\/)?[a-z0-9-]+\.(webp|png|jpe?g)$/
    );
    assert.ok(
      existsSync(path.join('apps/funding-web/src', image.src)),
      image.src
    );
    assert.ok(
      image.fit === undefined || ['contain', 'cover'].includes(image.fit)
    );
    for (const dictionary of translations) {
      assert.ok(translated(dictionary, image.altKey)?.trim(), image.altKey);
    }
  }
});

test('prices are exact CAD cents and available products have a direct shop link', () => {
  for (const product of products) {
    if (product.price) {
      assert.ok(Number.isSafeInteger(product.price.amountMinor));
      assert.ok(product.price.amountMinor >= 0);
      assert.equal(product.price.currency, 'CAD');
    }
    if (product.availability === 'available') assert.ok(product.productUrl);
    if (!product.productUrl) continue;
    const url = new URL(product.productUrl);
    assert.equal(url.protocol, 'https:');
    assert.ok(
      ['northdragon.org', 'www.northdragon.org'].includes(url.hostname)
    );
    assert.equal(url.username + url.password + url.port, '');
    assert.notEqual(
      url.pathname,
      '/',
      'Link to the product, not the shop home'
    );
  }
});
