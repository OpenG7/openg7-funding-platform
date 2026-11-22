import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MINIMUM_PERSONAL_CONTRIBUTION_AMOUNT,
  isValidPersonalContributionAmount
} from '../dist/packages/funding-core/src/index.js';

test('personal contribution presets are suggestions above a fixed 5 CAD minimum', () => {
  assert.equal(MINIMUM_PERSONAL_CONTRIBUTION_AMOUNT, 5);
  for (const amount of [5, 5.01, 7, 7.25, 12.34, 25, 50, 123.45, 1000])
    assert.equal(
      isValidPersonalContributionAmount(amount),
      true,
      String(amount)
    );
});

test('personal amounts reject invalid types, sub-minimum values and implicit rounding', () => {
  for (const amount of [
    undefined,
    null,
    true,
    '5',
    '7.25',
    [5],
    { amount: 5 },
    0,
    -5,
    4.99,
    5.001,
    5.009,
    7.250000000000001,
    NaN,
    Infinity,
    -Infinity,
    1e30
  ])
    assert.equal(
      isValidPersonalContributionAmount(amount),
      false,
      String(amount)
    );
});

test('personal amounts preserve exact safe minor units at the numeric boundary', () => {
  assert.equal(
    isValidPersonalContributionAmount(Number.MAX_SAFE_INTEGER / 100),
    true
  );
  assert.equal(
    isValidPersonalContributionAmount((Number.MAX_SAFE_INTEGER + 1) / 100),
    false
  );
  assert.equal(
    isValidPersonalContributionAmount(Number.MAX_SAFE_INTEGER),
    false
  );
});
