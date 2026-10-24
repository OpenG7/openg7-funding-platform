import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminCampaignsDestination,
  adminCampaignsReturnContext
} from '../dist/apps/funding-web/src/app/features/funding/models/admin-campaigns-navigation.js';
import { publicationJourneySelection } from '../dist/apps/funding-web/src/app/features/funding/models/admin-sponsorship-publication-navigation.js';

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

const returnDossier = 'a0000000-0000-4000-8000-000000000001';
const returnPassage = 'b0000000-0000-4000-8000-000000000026';
const historicalDelivery = 'c0000000-0000-4000-8000-000000000001';
const oldDraft = 'd0000000-0000-4000-8000-000000000001';
const selectedDraft = 'd0000000-0000-4000-8000-000000000002';
const returnRow = { contributionId: returnDossier, id: returnPassage };
const returnParams = (changes = {}) =>
  new URLSearchParams({
    sponsorshipId: returnDossier,
    obligationId: returnPassage,
    draftId: selectedDraft,
    deliveryId: historicalDelivery,
    ...changes
  });

test('proof-view return restores the selected historical source when two drafts share its passage and delivery', () => {
  const targets = [oldDraft, selectedDraft].map((draftId) => ({
    key: draftId,
    draftId,
    deliveryId: historicalDelivery,
    obligationId: returnPassage,
    channel: 'facebook',
    target: 'openg7'
  }));
  const row = {
    ...returnRow,
    workflow: { deliveryId: 'c0000000-0000-4000-8000-000000000099' }
  };
  const context = adminCampaignsReturnContext(returnParams(), row);
  assert.deepEqual(context, {
    draftId: selectedDraft,
    deliveryId: historicalDelivery
  });
  assert.deepEqual(
    publicationJourneySelection(
      targets,
      new URLSearchParams({
        sponsorshipId: returnDossier,
        obligationId: returnPassage,
        ...context
      })
    ),
    { state: 'selected', target: targets[1] }
  );
  assert.deepEqual(
    publicationJourneySelection(
      targets,
      new URLSearchParams({
        deliveryId: historicalDelivery,
        obligationId: returnPassage
      })
    ),
    { state: 'choose' }
  );
});

test('proof-view return never fills a source-only intent with an unrelated current delivery', () => {
  const params = returnParams();
  params.delete('deliveryId');
  assert.deepEqual(adminCampaignsReturnContext(params, returnRow), {
    draftId: selectedDraft
  });
  params.delete('draftId');
  assert.equal(adminCampaignsReturnContext(params, returnRow), null);
});

test('proof-view return rejects malformed, repeated, orphaned and foreign contexts as a whole', () => {
  const candidates = [
    returnParams({ draftId: 'private-text-must-not-enter-a-return-link' }),
    returnParams({ deliveryId: '' }),
    returnParams({ sponsorshipId: 'a0000000-0000-4000-8000-000000000002' }),
    returnParams({ obligationId: 'b0000000-0000-4000-8000-000000000027' }),
    returnParams()
  ];
  candidates[4].append('draftId', selectedDraft);
  const repeatedDelivery = returnParams();
  repeatedDelivery.append('deliveryId', historicalDelivery);
  candidates.push(repeatedDelivery);
  const orphan = returnParams();
  orphan.delete('obligationId');
  candidates.push(orphan);
  for (const params of candidates)
    assert.equal(
      adminCampaignsReturnContext(params, returnRow),
      null,
      params.toString()
    );
  const valid = returnParams({
    draftId: selectedDraft.toUpperCase(),
    deliveryId: historicalDelivery.toUpperCase()
  });
  valid.set('search', 'private editorial filter');
  assert.deepEqual(adminCampaignsReturnContext(valid, returnRow), {
    draftId: selectedDraft,
    deliveryId: historicalDelivery
  });
});
