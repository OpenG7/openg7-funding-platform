import assert from 'node:assert/strict';
import test from 'node:test';
import { isSponsorshipWebsiteVisibilityRequest } from '../dist/apps/funding-api/src/sponsorship-website.service.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';

test('website visibility requires a confirmed, versioned, bounded decision and an authorized role', () => {
  const input = {
    contributionId: '10000000-0000-4000-8000-000000000401',
    expectedVersion: '2026-09-29',
    visible: true,
    confirmed: true
  };
  assert.equal(isSponsorshipWebsiteVisibilityRequest(input), true);
  for (const value of [
    null,
    [],
    {},
    { ...input, confirmed: false },
    { ...input, confirmed: undefined },
    { ...input, visible: 'true' },
    { ...input, expectedVersion: '' },
    { ...input, expectedVersion: 'a'.repeat(129) },
    { ...input, contributionId: 'invalid' },
    { ...input, feedStatus: 'published' }
  ])
    assert.equal(isSponsorshipWebsiteVisibilityRequest(value), false);
  for (const prefix of ['/admin', '/api/admin']) {
    assert.equal(
      adminRoleAllows(
        'reader',
        'POST',
        prefix + '/sponsorships/website-visibility'
      ),
      false
    );
    for (const role of ['operator', 'owner'])
      assert.equal(
        adminRoleAllows(
          role,
          'POST',
          prefix + '/sponsorships/website-visibility'
        ),
        true
      );
  }
});

test('an explicit website refresh names one exact passage and rejects partial or unbounded commands', () => {
  const input = {
    contributionId: '10000000-0000-4000-8000-000000000401',
    expectedVersion: 'synthetic-v1',
    visible: true,
    confirmed: true,
    refresh: {
      requestId: '10000000-0000-4000-8000-000000000402',
      obligationId: '10000000-0000-4000-8000-000000000403',
      expectedVersion: 1
    }
  };
  assert.equal(isSponsorshipWebsiteVisibilityRequest(input), true);
  for (const value of [
    false,
    null,
    [],
    {},
    { ...input.refresh, expectedVersion: 0 },
    { ...input.refresh, expectedVersion: 1.5 },
    { ...input.refresh, expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...input.refresh, requestId: 'bad' },
    { ...input.refresh, obligationId: 'bad' },
    { ...input.refresh, unexpected: true }
  ])
    assert.equal(
      isSponsorshipWebsiteVisibilityRequest({ ...input, refresh: value }),
      false
    );
  assert.equal(
    isSponsorshipWebsiteVisibilityRequest({ ...input, visible: false }),
    false
  );
});
