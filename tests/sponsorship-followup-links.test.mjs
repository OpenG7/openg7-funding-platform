import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSponsorshipFollowupUrl,
  sponsorshipFollowupLocaleFromUrl
} from '../dist/apps/funding-api/src/sponsorship-followup-links.js';

test('follow-up links retain the authorized origin and only the new encoded token', () => {
  const token = 'synthetic+token/with?reserved=#&characters';
  for (const [base, locale, pathname] of [
    [
      'https://example.test/start?token=old&reference=old#step',
      'fr-CA',
      '/fonds-des-batisseurs/suivi-commandite'
    ],
    [
      'https://example.test:8443/en/start?checkout=success#step',
      'en',
      '/en/fonds-des-batisseurs/suivi-commandite'
    ],
    [
      'http://localhost:4200/start?followup_token=old',
      'en',
      '/en/fonds-des-batisseurs/suivi-commandite'
    ]
  ]) {
    const url = new URL(buildSponsorshipFollowupUrl(base, token, locale));
    assert.equal(url.origin, new URL(base).origin);
    assert.equal(url.pathname, pathname);
    assert.deepEqual([...url.searchParams], [['token', token]]);
    assert.equal(url.hash, '');
  }
  assert.equal(
    new URL(buildSponsorshipFollowupUrl('https://example.test/en', token))
      .pathname,
    '/fonds-des-batisseurs/suivi-commandite'
  );
});

test('follow-up locale comes only from the exact English path prefix', () => {
  for (const pathname of [
    '/en',
    '/en/',
    '/en/fonds-des-batisseurs',
    '/en/fonds-des-batisseurs/suivi-commandite'
  ]) {
    assert.equal(
      sponsorshipFollowupLocaleFromUrl(`https://example.test${pathname}`),
      'en'
    );
  }
  for (const value of [
    undefined,
    null,
    '',
    'invalid',
    '/en/relative',
    'https://example.test/',
    'https://example.test/fr/start',
    'https://example.test/enough',
    'https://example.test/en-CA/start',
    'https://en.example.test/start?locale=en#en',
    'https://example.test/EN/start',
    'https://example.test/start?next=/en'
  ]) {
    assert.equal(sponsorshipFollowupLocaleFromUrl(value), 'fr-CA');
  }
});

test('webhook locale does not transfer the Checkout return origin or query into its link', () => {
  const returnUrl =
    'https://return.example.test/en/return?token=old&other=value#step';
  const result = new URL(
    buildSponsorshipFollowupUrl(
      'https://configured.example.test/base?unrelated=value#fragment',
      'synthetic-current-token',
      sponsorshipFollowupLocaleFromUrl(returnUrl)
    )
  );
  assert.equal(result.origin, 'https://configured.example.test');
  assert.equal(result.pathname, '/en/fonds-des-batisseurs/suivi-commandite');
  assert.deepEqual(
    [...result.searchParams],
    [['token', 'synthetic-current-token']]
  );
  assert.equal(result.hash, '');
});
