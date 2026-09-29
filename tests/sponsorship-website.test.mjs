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
