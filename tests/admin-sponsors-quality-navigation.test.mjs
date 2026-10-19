import assert from 'node:assert/strict';
import test from 'node:test';

import { adminGuidancePage } from '../dist/apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance-pages.js';
import { AdminGuidanceState } from '../dist/apps/funding-web/src/app/features/funding/services/admin-guidance-state.js';

test('the quality route has its own guide metadata without private routing contents', () => {
  const quality = adminGuidancePage(
    '/admin/fundraiser/sponsors/quality?returnSponsorshipId=synthetic-private-id#private-fragment'
  );
  assert.equal(quality.id, 'sponsorsQuality');
  assert.equal(quality.path, '/admin/fundraiser/sponsors/quality');
  assert.equal(quality.titleKey, 'admin.sponsorsQuality.nav');
  assert.equal(adminGuidancePage('/admin/fundraiser/sponsors').id, 'sponsors');
  assert.equal(
    adminGuidancePage('/admin/fundraiser/sponsors/quality/unknown'),
    undefined
  );
  assert.equal(JSON.stringify(quality).includes('synthetic-private-id'), false);
});

test('quality guide bookmarks round-trip only their public page and bounded step', () => {
  const storage = new Map();
  const memory = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  const state = new AdminGuidanceState(() => memory);
  const snapshot = {
    enabled: true,
    bookmark: { pageId: 'sponsorsQuality', step: 2, paused: false }
  };
  assert.equal(state.save('synthetic-owner', snapshot), true);
  assert.deepEqual(state.load('synthetic-owner'), snapshot);
  assert.equal(
    state.save('synthetic-owner', {
      ...snapshot,
      bookmark: { ...snapshot.bookmark, step: 3 }
    }),
    false
  );
});
