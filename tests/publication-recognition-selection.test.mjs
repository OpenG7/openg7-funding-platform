import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLICATION_RECOGNITION_POLICY_VERSION,
  selectPublicationRecognitionSources
} from '../dist/packages/funding-core/src/index.js';

const disclosure = 'Commandite rémunérée.';
const source = (id, codeUnits = 100) => {
  const name = `Atelier ${id}`;
  return {
    id,
    contributionId: `contribution-${id}`,
    name,
    title: name,
    body: 'x'.repeat(codeUnits - name.length - disclosure.length - 4),
    disclosureText: disclosure
  };
};
const select = (candidates, existingSources = [], capacity = 8) =>
  selectPublicationRecognitionSources({
    candidates,
    existingSources,
    capacity
  });
const ids = (sources) => sources.map((item) => item.id);

test('selection accepts a complete 2900-unit block and diagnoses 2901 without truncation', () => {
  const exact = source('exact', 2900);
  const result = select([exact]);
  assert.equal(result.codeUnits, 2900);
  assert.equal(
    result.message,
    `${exact.title}\n\n${exact.body}\n\n${disclosure}`
  );
  assert.deepEqual(result.retained, [exact]);
  assert.deepEqual(result.needsCorrection, []);
  assert.equal(result.existingIssue, null);

  const oversized = source('oversized', 2901);
  const originalBody = oversized.body;
  const refused = select([oversized]);
  assert.equal(refused.message, '');
  assert.equal(refused.codeUnits, 0);
  assert.deepEqual(refused.retained, []);
  assert.deepEqual(refused.deferred, []);
  assert.deepEqual(refused.needsCorrection, [
    { source: oversized, codeUnits: 2901, reason: 'SOURCE_TEXT_TOO_LONG' }
  ]);
  assert.equal(oversized.body, originalBody);
});

test('emoji are measured in UTF-16 code units and remain whole', () => {
  const exact = {
    ...source('emoji'),
    name: 'A',
    title: 'A',
    body: '😀'.repeat(1437)
  };
  const accepted = select([exact]);
  assert.equal(accepted.codeUnits, 2900);
  assert.equal(accepted.message, `A\n\n${exact.body}\n\n${disclosure}`);
  assert.deepEqual(accepted.retained, [exact]);
  const oversized = { ...exact, id: 'emoji-over', body: `${exact.body}x` };
  assert.deepEqual(select([oversized]).needsCorrection, [
    { source: oversized, codeUnits: 2901, reason: 'SOURCE_TEXT_TOO_LONG' }
  ]);
});

test('a custom title accounts for its authoritative identity: raw 2880, rendered 2907', () => {
  const custom = {
    ...source('custom'),
    name: 'Atelier Nord',
    title: 'Titre',
    body: 'x'.repeat(2850)
  };
  assert.equal(
    [custom.title, custom.body, disclosure].join('\n\n').length,
    2880
  );
  const result = select([custom, source('next')]);
  assert.deepEqual(ids(result.retained), ['next']);
  assert.deepEqual(result.needsCorrection, [
    { source: custom, codeUnits: 2907, reason: 'SOURCE_TEXT_TOO_LONG' }
  ]);
});

test('selection measures canonical NFC and LF rendering rather than the raw source', () => {
  const decomposed = {
    ...source('canonical'),
    name: 'Cafe\u0301',
    title: 'Cafe\u0301',
    body: 'x'.repeat(2871)
  };
  assert.equal(
    [decomposed.title, decomposed.body, disclosure].join('\n\n').length,
    2901
  );
  const result = select([decomposed]);
  assert.equal(result.codeUnits, 2900);
  assert.equal(result.message, `Café\n\n${decomposed.body}\n\n${disclosure}`);
  assert.deepEqual(result.retained, [decomposed]);
  const lineEndings = { ...source('line-endings'), body: 'First\r\nSecond' };
  assert.equal(select([lineEndings]).message.includes('First\nSecond'), true);
});

test('an individually oversized head does not prevent later valid sources from advancing', () => {
  const oversized = source('head', 4000);
  const valid = [source('first'), source('second')];
  const result = select([oversized, ...valid]);
  assert.deepEqual(result.retained, valid);
  assert.deepEqual(result.deferred, []);
  assert.deepEqual(result.needsCorrection, [
    { source: oversized, codeUnits: 4000, reason: 'SOURCE_TEXT_TOO_LONG' }
  ]);
});

test('a source that fits alone but not the batch defers later valid sources in supplied order', () => {
  const existing = source('existing', 2000);
  const first = source('first', 1000);
  const smaller = source('smaller', 100);
  const oversized = source('last-oversized', 3000);
  const result = select([first, smaller, oversized], [existing]);
  assert.deepEqual(result.retained, [existing]);
  assert.deepEqual(result.deferred, [first, smaller]);
  assert.equal(result.codeUnits, 2000);
  assert.deepEqual(result.needsCorrection, [
    { source: oversized, codeUnits: 3000, reason: 'SOURCE_TEXT_TOO_LONG' }
  ]);
});

test('eight ordered sources form batches of three, three and two under the rendered budget', () => {
  const candidates = Array.from({ length: 8 }, (_, index) =>
    source(`company-${index + 1}`, 900)
  );
  const batches = [];
  let remaining = candidates;
  while (remaining.length) {
    const result = select(remaining);
    assert.equal(result.existingIssue, null);
    assert.deepEqual(result.needsCorrection, []);
    assert.ok(result.codeUnits <= 2900);
    batches.push(result.retained);
    remaining = result.deferred;
  }
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [3, 3, 2]
  );
  assert.deepEqual(batches.flat(), candidates);
});

test('capacity counts existing members and still diagnoses impossible deferred candidates', () => {
  const existing = source('existing');
  const first = source('first');
  const later = source('later');
  const oversized = source('oversized', 3000);
  const result = select([first, later, oversized], [existing], 2);
  assert.deepEqual(result.retained, [existing, first]);
  assert.deepEqual(result.deferred, [later]);
  assert.equal(result.codeUnits, 202);
  assert.deepEqual(result.needsCorrection, [
    { source: oversized, codeUnits: 3000, reason: 'SOURCE_TEXT_TOO_LONG' }
  ]);
});

test('invalid existing members are preserved and no candidate is added', () => {
  const candidates = [source('new')];
  for (const [existing, capacity, issue] of [
    [[source('a', 1600), source('b', 1600)], 8, 'EXISTING_MESSAGE_TOO_LONG'],
    [[source('a'), source('b')], 1, 'EXISTING_CAPACITY_EXCEEDED'],
    [[{ ...source('identity'), name: '' }], 8, 'SOURCE_CONTENT_MISSING']
  ]) {
    const result = select(candidates, existing, capacity);
    assert.deepEqual(result.retained, existing);
    assert.deepEqual(result.deferred, candidates);
    assert.equal(result.existingIssue, issue);
    assert.equal(result.codeUnits, result.message.length);
  }
});

test('an invalid candidate identity is diagnosed without preventing the next valid candidate', () => {
  const invalid = { ...source('invalid'), name: 'A\nB' };
  const next = source('next');
  const result = select([invalid, next]);
  assert.deepEqual(result.retained, [next]);
  assert.deepEqual(result.deferred, []);
  assert.equal(result.needsCorrection[0].source, invalid);
  assert.equal(result.needsCorrection[0].reason, 'SOURCE_CONTENT_MISSING');
});

test('selection does not mutate sources, queue order or existing membership', () => {
  const existing = Object.freeze(source('existing'));
  const candidates = Object.freeze([Object.freeze(source('next'))]);
  const input = Object.freeze({
    existingSources: Object.freeze([existing]),
    candidates,
    capacity: 2
  });
  const before = structuredClone(input);
  const result = selectPublicationRecognitionSources(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.retained, [existing, ...candidates]);
});

test('invalid capacities are rejected and the rendering policy has an explicit version', () => {
  for (const capacity of [0, -1, 1.5, Infinity, NaN])
    assert.throws(() => select([], [], capacity), RangeError);
  assert.equal(PUBLICATION_RECOGNITION_POLICY_VERSION, 'recognition-v1');
});
