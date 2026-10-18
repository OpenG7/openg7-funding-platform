import assert from 'node:assert/strict';
import test from 'node:test';

import { adminCampaignsDestination } from '../dist/apps/funding-web/src/app/features/funding/models/admin-campaigns-navigation.js';

test('campaign navigation leaves independent shell parameters alone', () => {
  assert.deepEqual(
    adminCampaignsDestination(new URLSearchParams('returnTo=assistant')),
    { kind: 'all' }
  );
});

test('campaign navigation resolves a canonical dossier and exact promised passage', () => {
  assert.deepEqual(
    adminCampaignsDestination(
      new URLSearchParams({
        sponsorshipId: 'A0000000-0000-4000-8000-000000000001',
        obligationId: 'B0000000-0000-4000-8000-000000000026'
      })
    ),
    {
      kind: 'focused',
      focus: {
        sponsorshipId: 'a0000000-0000-4000-8000-000000000001',
        obligationId: 'b0000000-0000-4000-8000-000000000026'
      }
    }
  );
});

test('ambiguous, malformed and orphaned campaign links are rejected before a read', () => {
  for (const query of [
    'sponsorshipId=',
    'sponsorshipId=not-a-dossier',
    'obligationId=b0000000-0000-4000-8000-000000000001',
    'sponsorshipId=a0000000-0000-4000-8000-000000000001&sponsorshipId=a0000000-0000-4000-8000-000000000001',
    'sponsorshipId=a0000000-0000-4000-8000-000000000001&obligationId=',
    'sponsorshipId=a0000000-0000-4000-8000-000000000001&obligationId=b0000000-0000-4000-8000-000000000001&obligationId=b0000000-0000-4000-8000-000000000001'
  ])
    assert.deepEqual(adminCampaignsDestination(new URLSearchParams(query)), {
      kind: 'invalid'
    });
});
