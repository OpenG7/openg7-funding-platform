import assert from 'node:assert/strict';
import test from 'node:test';

import {
  campaignDetailAction,
  groupCampaignRows
} from '../dist/apps/funding-web/src/app/features/funding/pages/admin-campaigns-page/admin-campaigns-controller.js';

const row = (id) => ({ id, contributionId: 'synthetic-dossier' });

function detailRow({ workflow = {}, preparation = {}, ...changes } = {}) {
  return {
    ...row('synthetic-obligation'),
    reference: 'SYNTHETIC-CAMPAIGN',
    companyName: 'Synthetic sponsor',
    paidAt: '2026-10-01T12:00:00Z',
    channel: 'facebook',
    target: 'openg7',
    ordinal: 1,
    quantity: 1,
    format: 'collective_text',
    obligationState: 'pending',
    timing: null,
    preparation: {
      status: 'ready',
      version: 'synthetic-version',
      approvedAt: null,
      blockers: [],
      ...preparation
    },
    workflow: {
      obligationId: 'synthetic-obligation',
      channel: 'facebook',
      target: 'openg7',
      ordinal: 1,
      state: 'action_required',
      responsibility: 'admin',
      reason: 'publication_authorization_required',
      deliveryId: null,
      scheduledAt: null,
      ...workflow
    },
    content: { title: 'Synthetic title', body: 'Synthetic content' },
    proof: null,
    adminUrl: '/admin/fundraiser/sponsors',
    ...changes
  };
}

test('an unresolved send remains the reading priority despite a dispense or an existing proof', () => {
  const proof = Object.freeze({
    id: 'synthetic-proof',
    obligationId: 'synthetic-obligation',
    deliveryId: 'synthetic-prior-delivery',
    channel: 'facebook',
    target: 'openg7',
    provenance: 'provider_verified',
    deliveredAt: '2026-10-02T12:00:00Z',
    externalPostUrl: 'https://example.invalid/published',
    visibility: 'missing',
    visibilityObservedAt: '2026-10-03T12:00:00Z'
  });
  for (const state of ['uncertain', 'error']) {
    for (const deliveryId of ['synthetic-incident-delivery', null]) {
      const item = detailRow({
        obligationState: 'adjusted',
        proof,
        workflow: { state, deliveryId }
      });
      const before = structuredClone(item);
      assert.equal(
        campaignDetailAction(item, true),
        deliveryId ? 'delivery' : 'owner'
      );
      assert.deepEqual(item, before);
    }
  }
});

test('completed or dispensed passages open their evidence section even without a proof record', () => {
  for (const changes of [
    { workflow: { state: 'complete', responsibility: 'none' } },
    { obligationState: 'adjusted' }
  ]) {
    const item = detailRow(changes);
    assert.equal(item.proof, null);
    assert.equal(campaignDetailAction(item, true), 'proof');
  }
});

test('platform work never suggests dossier preparation even when its preparation is incomplete', () => {
  for (const deliveryId of ['synthetic-scheduled-delivery', null]) {
    const item = detailRow({
      preparation: { status: 'incomplete' },
      workflow: {
        state: 'waiting',
        responsibility: 'platform',
        reason: deliveryId ? 'publication_scheduled' : 'publication_pending',
        deliveryId
      }
    });
    assert.equal(
      campaignDetailAction(item, true),
      deliveryId ? 'delivery' : 'owner'
    );
  }
});

test('administrative work opens current preparation when it needs review or can actually be approved', () => {
  for (const status of ['ready', 'incomplete', 'review_required']) {
    const item = detailRow({ preparation: { status } });
    assert.equal(campaignDetailAction(item, false), 'preparation');
  }
  const staleApprovedSummary = detailRow({
    preparation: { status: 'approved' }
  });
  assert.equal(campaignDetailAction(staleApprovedSummary, true), 'preparation');
});

test('an approved preparation uses its exact delivery or dossier as the remaining reading destination', () => {
  for (const deliveryId of ['synthetic-draft-delivery', null]) {
    const item = detailRow({
      preparation: { status: 'approved' },
      workflow: { deliveryId }
    });
    assert.equal(
      campaignDetailAction(item, false),
      deliveryId ? 'delivery' : 'owner'
    );
  }
});

test('grouping retains server due-date order when dossiers are interleaved', () => {
  const rows = [
    row('first'),
    row('same-dossier-next'),
    { ...row('other-dossier'), contributionId: 'synthetic-other-dossier' },
    row('original-dossier-later')
  ];
  const groups = groupCampaignRows(rows, true);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map((group) => group.id)).size, 3);
  assert.deepEqual(
    groups.flatMap((group) => group.rows),
    rows
  );
  assert.deepEqual(
    groups[0].rows.map((item) => item.id),
    ['first', 'same-dossier-next']
  );
  assert.deepEqual(groupCampaignRows(rows, false), [{ id: '', rows }]);
});
