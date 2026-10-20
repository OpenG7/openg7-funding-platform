import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_GUIDANCE_LOAD_RETRIES,
  guidanceChunkRetrySource,
  guidanceChunkRetryUrl,
  loadGuidanceChunkRetry
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance-retry.js';

const base = 'https://funding.example.test/app/';
const chunk = base + 'chunk-ABC123.js';
const fetchFailure = (url = chunk) =>
  new TypeError('Failed to fetch dynamically imported module: ' + url);

test('a recognized failed application chunk can retry without replacing the current page', () => {
  assert.equal(guidanceChunkRetrySource(fetchFailure(), base), chunk);
  assert.equal(
    guidanceChunkRetrySource(
      new TypeError('error loading dynamically imported module: ' + chunk),
      base
    ),
    chunk
  );
  assert.equal(
    guidanceChunkRetryUrl(chunk, base, 1),
    chunk + '?og7GuideRetry=1'
  );
});

test('retry URLs accept only the bounded explicit attempts', () => {
  for (const attempt of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    ADMIN_GUIDANCE_LOAD_RETRIES + 1
  ])
    assert.equal(guidanceChunkRetryUrl(chunk, base, attempt), null);
  assert.equal(
    guidanceChunkRetryUrl(chunk, base, ADMIN_GUIDANCE_LOAD_RETRIES),
    chunk + '?og7GuideRetry=' + ADMIN_GUIDANCE_LOAD_RETRIES
  );
  assert.equal(
    guidanceChunkRetrySource(fetchFailure(chunk + '?og7GuideRetry=2'), base),
    chunk
  );
});

test('foreign, credentialed, nonchunk and unrelated application URLs cannot become imports', () => {
  for (const url of [
    'https://foreign.example.test/app/chunk-ABC123.js',
    'https://user:password@funding.example.test/app/chunk-ABC123.js',
    'https://funding.example.test/chunk-ABC123.js',
    'https://funding.example.test/app/nested/chunk-ABC123.js',
    'https://funding.example.test/api/admin/chunk-ABC123.js',
    base + 'main-ABC123.js',
    base + 'chunk-ABC123.js?unrelated=1',
    base + 'chunk-ABC123.js#fragment',
    'data:text/javascript,export default 1',
    'file:///app/chunk-ABC123.js'
  ]) {
    assert.equal(guidanceChunkRetrySource(fetchFailure(url), base), null, url);
    assert.equal(guidanceChunkRetryUrl(url, base, 1), null, url);
  }
});

test('evaluation failures and unknown error shapes do not choose another module', () => {
  for (const error of [
    new Error(fetchFailure().message),
    new TypeError('A component failed while rendering'),
    new SyntaxError('Unexpected export'),
    { message: fetchFailure().message },
    null
  ])
    assert.equal(guidanceChunkRetrySource(error, base), null);
});

test('invalid retries stop before any import can be issued', async () => {
  await assert.rejects(
    loadGuidanceChunkRetry(
      'https://foreign.example.test/chunk-ABC123.js',
      base,
      1,
      'AdminWorkflowGuideComponent'
    ),
    /Guidance module retry unavailable/
  );
});
