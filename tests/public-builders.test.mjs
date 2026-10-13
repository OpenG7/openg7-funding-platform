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

test('builder pages preserve full, partial and past-end boundaries without accepting malformed totals', () => {
  const builders = Array.from({ length: 53 }, (_, index) => ({
    public_id: `synthetic-builder-${index}`,
    display_name: `Builder ${index}`,
    contribution_type: 'personal_support',
    amount: null,
    currency: 'CAD',
    paid_at: null
  }));
  const response = (page) => ({
    data_source: 'database',
    builders: builders.slice((page - 1) * 50, page * 50),
    last_updated_at: '2026-09-19T00:00:00Z',
    pagination: { page, page_size: 50, total_count: builders.length }
  });
  for (const page of [1, 2, 3, 100_000])
    assert.equal(isPublicBuildersResponse(response(page)), true);
  const partial = response(2);
  for (const patch of [
    { page: 0 },
    { page: 100_001 },
    { page: '2' },
    { page_size: 51 },
    { page_size: 1.5 },
    { total_count: -1 },
    { total_count: Infinity },
    { total_count: '53' }
  ])
    assert.equal(
      isPublicBuildersResponse({
        ...partial,
        pagination: { ...partial.pagination, ...patch }
      }),
      false
    );
  assert.equal(
    isPublicBuildersResponse({
      ...partial,
      builders: partial.builders.slice(1)
    }),
    false
  );
  assert.equal(
    isPublicBuildersResponse({ ...partial, pagination: undefined }),
    false
  );
});
