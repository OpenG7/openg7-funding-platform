import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicBuildersResponse } from '../dist/apps/funding-web/src/app/features/funding/models/public-builders.utils.js';
import { parsePublicDirectoryPagination } from '../dist/apps/funding-api/src/public-directory-pagination.js';

test('directory parameters and public builder responses reject misleading data', () => {
  assert.deepEqual(parsePublicDirectoryPagination(new URLSearchParams(), 24), {
    page: 1,
    pageSize: 24
  });
  for (const query of [
    'page=0',
    'page=-1',
    'page=1&page=2',
    'pageSize=51',
    'page=1.5',
    'page=Infinity'
  ])
    assert.equal(
      parsePublicDirectoryPagination(new URLSearchParams(query)),
      null
    );
  const row = {
    public_id: 'public-a',
    display_name: 'Builder',
    contribution_type: 'personal_support',
    amount: null,
    currency: 'CAD',
    paid_at: null
  };
  const valid = {
    data_source: 'database',
    builders: [row],
    last_updated_at: '2026-09-19T00:00:00Z',
    pagination: { page: 1, page_size: 12, total_count: 1 }
  };
  assert.equal(isPublicBuildersResponse(valid), true);
  for (const patch of [
    { builders: [row, row] },
    { data_source: 'empty' },
    { pagination: { page: 1, page_size: 12, total_count: 2 } },
    { builders: [{ ...row, amount: NaN }] },
    { builders: [{ ...row, display_name: ' ' }] },
    { builders: [{ ...row, public_id: undefined }] }
  ])
    assert.equal(isPublicBuildersResponse({ ...valid, ...patch }), false);
});
