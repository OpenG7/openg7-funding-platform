import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePublicSponsorshipPagination } from '../dist/apps/funding-api/src/public-sponsorship-pagination.js';
import {
  isPublicSponsorshipsResponse,
  publicHttpsUrl,
  publicMediaUrl
} from '../dist/apps/funding-web/src/app/features/funding/models/public-sponsors.utils.js';
import {
  sponsorProfile,
  sponsorsResponse
} from './fixtures/public-sponsors.mjs';

test('public pagination is bounded, strict and backward compatible', () => {
  const parse = (value) =>
    parsePublicSponsorshipPagination(new URLSearchParams(value));
  assert.deepEqual(parse(''), { page: 1, pageSize: 50 });
  assert.deepEqual(parse('page=5&pageSize=12'), { page: 5, pageSize: 12 });
  for (const value of [
    'page=0',
    'page=-1',
    'page=1.5',
    'page=3abc',
    'page=100001',
    'page=Infinity',
    'page=',
    'page=1&page=2',
    'pageSize=51',
    'pageSize=0',
    'pageSize=12&pageSize=12'
  ])
    assert.equal(parse(value), null, value);
});

test('response validation accepts legacy data without inventing totals and rejects inconsistent pages', () => {
  const report = sponsorsResponse([sponsorProfile(), sponsorProfile(1)]);
  assert.equal(isPublicSponsorshipsResponse(report), true);
  assert.equal(
    isPublicSponsorshipsResponse({ ...report, data_source: 'empty' }),
    false
  );
  const { pagination, ...legacy } = report;
  assert.equal(isPublicSponsorshipsResponse(legacy), true);
  for (const patch of [
    { total_count: 1 },
    { published_count: 3 },
    { page_size: 0 },
    { page: -1 },
    { total_count: 2.5 }
  ]) {
    assert.equal(
      isPublicSponsorshipsResponse({
        ...report,
        pagination: { ...pagination, ...patch }
      }),
      false
    );
  }
  assert.equal(
    isPublicSponsorshipsResponse({ ...report, last_updated_at: 'invalid' }),
    false
  );
  assert.equal(
    isPublicSponsorshipsResponse({
      ...report,
      sponsorships: [sponsorProfile(), sponsorProfile()]
    }),
    false
  );
  assert.equal(
    isPublicSponsorshipsResponse(
      sponsorsResponse([sponsorProfile(1, { amount: NaN })])
    ),
    false
  );
  assert.equal(
    isPublicSponsorshipsResponse(
      sponsorsResponse([sponsorProfile(1, { media: [{}] })])
    ),
    false
  );
  assert.equal(isPublicSponsorshipsResponse(sponsorsResponse([], 9)), true);
});

test('public links use HTTPS or the public media endpoints, never executable schemes or credentials', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:image/svg+xml,x',
    'http://example.com',
    '//example.com/path',
    'https://name:password@example.com',
    '/admin/media'
  ]) {
    assert.equal(publicHttpsUrl(url), null);
    assert.equal(publicMediaUrl(url), null);
  }
  assert.equal(
    publicHttpsUrl('https://example.com/post'),
    'https://example.com/post'
  );
  assert.equal(
    publicMediaUrl('/api/public/sponsor-media/photo-1'),
    '/api/public/sponsor-media/photo-1'
  );
  assert.equal(
    publicMediaUrl('/api/public/sponsor-logos/logo.webp'),
    '/api/public/sponsor-logos/logo.webp'
  );
  assert.equal(publicMediaUrl('/api/public/sponsor-media/../../admin'), null);
});
