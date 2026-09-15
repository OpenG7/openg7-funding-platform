import assert from 'node:assert/strict';
import test from 'node:test';

import { listAdminSponsorships } from '../dist/apps/funding-api/src/fund-contributions.repository.js';

test('an admin UUID search selects the exact contribution before pagination', async () => {
  const id = '831af81a-561e-4ec4-9d1c-f91944710116';
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params: [...params] });
      return { rows: [] };
    }
  };
  const result = await listAdminSponsorships(pool, {
    page: 1,
    pageSize: 6,
    search: ` ${id} `
  });

  assert.equal(queries.length, 2);
  for (const { sql, params } of queries) {
    assert.match(sql, /AND id = \$1::uuid/);
    assert.doesNotMatch(sql, /ILIKE/);
    assert.equal(params[0], id);
  }
  assert.deepEqual(result.items, []);
  assert.equal(result.pagination.totalItems, 0);
});

test('ordinary admin searches keep matching names and public references', async () => {
  const queries = [];
  await listAdminSponsorships(
    {
      async query(sql, params) {
        queries.push({ sql, params: [...params] });
        return { rows: [] };
      }
    },
    { page: 1, pageSize: 6, search: ' OG7-CMD-0001 ' }
  );

  for (const { sql, params } of queries) {
    assert.match(sql, /sponsor_company_name ILIKE \$1/);
    assert.match(sql, /public_reference ILIKE \$1/);
    assert.doesNotMatch(sql, /id = \$1::uuid/);
    assert.equal(params[0], '%OG7-CMD-0001%');
  }
});
