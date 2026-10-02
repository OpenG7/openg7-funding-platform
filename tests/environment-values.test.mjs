import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBooleanEnv,
  parseNonNegativeIntegerEnv,
  parsePositiveIntegerEnv
} from '../dist/apps/funding-api/src/environment-values.js';

test('optional feature flags preserve accepted spellings and caller defaults', () => {
  for (const value of ['1', 'true', 'yes', 'on', ' TRUE ', ' On ']) {
    assert.equal(parseBooleanEnv(value, false), true);
  }
  for (const value of ['0', 'false', 'no', 'off', ' FALSE ', ' Off ']) {
    assert.equal(parseBooleanEnv(value, true), false);
  }
  for (const value of [undefined, '', '  ', 'invalid']) {
    assert.equal(parseBooleanEnv(value, false), false);
    assert.equal(parseBooleanEnv(value, true), true);
  }
});

test('optional positive limits keep defaults for invalid values and cap valid values', () => {
  for (const value of [
    undefined,
    '',
    '  ',
    '0',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    'invalid'
  ]) {
    assert.equal(parsePositiveIntegerEnv(value, 6, 20), 6);
  }
  assert.equal(parsePositiveIntegerEnv(' 12 ', 6, 20), 12);
  assert.equal(parsePositiveIntegerEnv('200', 6, 20), 20);
  assert.equal(parsePositiveIntegerEnv('200', 6), 200);
  // Existing numeric spellings remain compatible with startup configuration.
  assert.equal(parsePositiveIntegerEnv('1e3', 10), 1000);
});

test('nonnegative startup limits preserve explicit zero and blank-string compatibility', () => {
  assert.equal(parseNonNegativeIntegerEnv(undefined, 30), 30);
  for (const value of ['0', '', '  ']) {
    assert.equal(parseNonNegativeIntegerEnv(value, 30), 0);
  }
  assert.equal(parseNonNegativeIntegerEnv(' 15 ', 30), 15);
  for (const value of ['-1', '1.5', 'NaN', 'Infinity', 'invalid']) {
    assert.equal(parseNonNegativeIntegerEnv(value, 30), 30);
  }
});
