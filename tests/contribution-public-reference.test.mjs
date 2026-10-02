import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeContributionPublicReference } from '../dist/apps/funding-api/src/contribution-public-reference.js';

test('contribution references normalize surrounding whitespace and letter case', () => {
  for (const [value, expected] of [
    ['OG7-2026-A1B2', 'OG7-2026-A1B2'],
    ['  og7-2026-a1b2c3d4  ', 'OG7-2026-A1B2C3D4'],
    ['\tOg7-2026-ab12cd\n', 'OG7-2026-AB12CD']
  ]) {
    assert.equal(normalizeContributionPublicReference(value), expected);
  }
});

test('missing and malformed contribution references do not become usable references', () => {
  for (const value of [
    undefined,
    null,
    '',
    '  ',
    'OG7-2026-ABC',
    'OG7-2026-ABCDEFGHI',
    'OG7-202-ABCD',
    'OG7-20260-ABCD',
    'OG8-2026-ABCD',
    'OG7-2026-AB-C',
    'OG7-2026-AB_C',
    'OG7-2026-ABCé',
    'OG7-2026-AB CD',
    'OG7-2026-AB\nCD',
    'prefix-OG7-2026-ABCD',
    'OG7-2026-ABCD-suffix'
  ]) {
    assert.equal(normalizeContributionPublicReference(value), null);
  }
});

test('reference format validation preserves historical years without imposing a calendar policy', () => {
  assert.equal(
    normalizeContributionPublicReference('OG7-0000-0000'),
    'OG7-0000-0000'
  );
  assert.equal(
    normalizeContributionPublicReference('OG7-9999-99999999'),
    'OG7-9999-99999999'
  );
});
