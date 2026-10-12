import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedinPublicationImageIds } from '../dist/packages/funding-core/src/index.js';

test('immutable provider image references accept a legacy URN or ordered unique collection and fail closed', () => {
  assert.deepEqual(linkedinPublicationImageIds('urn:li:image:one'), [
    'urn:li:image:one'
  ]);
  assert.deepEqual(
    linkedinPublicationImageIds('["urn:li:image:two","urn:li:image:one"]'),
    ['urn:li:image:two', 'urn:li:image:one']
  );
  for (const value of [
    null,
    '',
    'synthetic-old-id',
    '{}',
    'null',
    '[1]',
    '["urn:li:image:one","urn:li:image:one"]',
    '["https://temporary.example.invalid/image"]',
    JSON.stringify(
      Array.from({ length: 11 }, (_, index) => `urn:li:image:${index}`)
    )
  ])
    assert.deepEqual(linkedinPublicationImageIds(value), []);
});
