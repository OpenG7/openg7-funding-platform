import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAdminSearch,
  searchAmount,
  searchAdmin
} from '../dist/apps/funding-api/src/admin-search.service.js';

test('search validates private input and pagination without echoing the query', () => {
  assert.deepEqual(parseAdminSearch({ query: '  Cafe\u0301  ' }), {
    query: 'Café',
    page: 1,
    pageSize: 10
  });
  for (const body of [
    null,
    [],
    {},
    { query: 'a' },
    { query: 'x'.repeat(121) },
    { query: 'private@example.invalid\n' },
    { query: 'email', page: '1' },
    { query: 'email', page: 0 },
    { query: 'email', page: 10001 },
    { query: 'email', pageSize: 21 },
    { query: 'email', pageSize: 1.5 }
  ]) {
    assert.throws(() => parseAdminSearch(body), { message: 'Invalid search' });
  }
  assert.equal(
    parseAdminSearch({ query: "' OR TRUE --" }).query,
    "' OR TRUE --"
  );
});

test('amount search parses cents exactly with an optional explicit currency', () => {
  for (const query of ['100.50 CAD', 'CAD 100,50', 'cad 100.5']) {
    assert.deepEqual(searchAmount(query), { minor: 10050, currency: 'cad' });
  }
  assert.deepEqual(searchAmount('0.29 USD'), { minor: 29, currency: 'usd' });
  assert.deepEqual(searchAmount('100'), { minor: 10000, currency: null });
  for (const query of [
    '1.234 CAD',
    '-100',
    '1e3',
    'CAD 10 USD',
    '9007199254740991.99'
  ])
    assert.equal(searchAmount(query), null);
});

test('no database is unavailable rather than a complete empty search', async () => {
  const result = await searchAdmin(null, {
    query: 'private@example.invalid',
    page: 2
  });
  assert.equal(result.available, false);
  assert.equal(result.missingSources.length, 3);
  assert.equal(result.page, 2);
  assert.ok(!JSON.stringify(result).includes('private@'));
});
