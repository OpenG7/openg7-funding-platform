import assert from 'node:assert/strict';
import test from 'node:test';

import { projectSponsorshipPublicationWorkflow as project } from '../dist/apps/funding-api/src/sponsorship-progress-workflow.js';
import { preparationBalanceBlockers } from '../dist/apps/funding-api/src/admin-preparation.projection.js';
import { recordedSponsorshipCommitment } from './support/sponsorship-commitment-fixture.mjs';

const agreement = () =>
  recordedSponsorshipCommitment(['facebook_batch', 'linkedin_batch']);
const publication = (obligation, deliveryStatus, changes = {}) => ({
  id: 'draft-' + obligation.id,
  obligationId: obligation.id,
  channel: obligation.channel,
  target: obligation.target,
  status: 'scheduled',
  deliveryId: 'delivery-' + obligation.id,
  deliveryStatus,
  deliveryMode: 'live',
  batchStatus: 'scheduled',
  slotStatus: 'scheduled',
  scheduledAt: '2026-11-01T18:00:00Z',
  publishedAt: null,
  ...changes
});

test('the platform owns scheduled, executing and bounded retry work without claiming fulfilment', () => {
  for (const [status, changes, reason] of [
    ['approved', {}, 'publication_scheduled'],
    ['publishing', {}, 'publication_publishing'],
    [
      'approved',
      { nextAttemptAt: '2026-11-01T18:02:00Z' },
      'publication_retry_pending'
    ]
  ]) {
    const commitment = agreement();
    const workflow = project(
      commitment,
      commitment.obligations.map((o) => publication(o, status, changes))
    );
    assert.equal(workflow.state, 'waiting');
    assert.equal(workflow.responsibility, 'platform');
    assert.equal(workflow.reason, reason);
    assert.ok(workflow.obligations.every((item) => item.state === 'waiting'));
    assert.ok(commitment.obligations.every((o) => o.state === 'pending'));
  }
});

test('a source date alone never supplies the exact final publication authorization', () => {
  const commitment = agreement();
  const workflow = project(
    commitment,
    commitment.obligations.map((o) =>
      publication(o, null, { deliveryId: null, status: 'scheduled' })
    )
  );
  assert.equal(workflow.state, 'action_required');
  assert.equal(workflow.reason, 'publication_authorization_required');
  assert.equal(workflow.responsibility, 'admin');
  assert.equal(
    project(commitment, []).reason,
    'publication_preparation_required'
  );
});

test('partial success preserves each exact obligation and distinguishes certain failure from uncertainty', () => {
  for (const [status, state, reason] of [
    ['failed', 'error', 'publication_failed'],
    ['uncertain', 'uncertain', 'publication_uncertain'],
    ['approved', 'waiting', 'publication_scheduled']
  ]) {
    const commitment = agreement();
    Object.assign(commitment.obligations[0], {
      state: 'fulfilled',
      fulfilmentEvidenceId: 'qualified-facebook-evidence'
    });
    const workflow = project(
      commitment,
      commitment.obligations.map((o) =>
        publication(o, o.channel === 'facebook' ? 'published' : status)
      ),
      [],
      undefined,
      ['qualified-facebook-evidence']
    );
    assert.equal(workflow.state, state);
    assert.equal(workflow.reason, reason);
    assert.equal(workflow.obligations[0].state, 'complete');
    assert.equal(workflow.obligations[0].responsibility, 'none');
    assert.equal(
      workflow.obligations[1].deliveryId,
      'delivery-synthetic-obligation-1'
    );
  }
});

test('unknown original terms, paused feeds and simulation require distinct human action', () => {
  assert.deepEqual(project(null, []), {
    state: 'blocked',
    responsibility: 'admin',
    reason: 'commitment_needs_confirmation',
    obligations: []
  });
  const commitment = agreement();
  for (const [status, changes, reason] of [
    ['approved', { feedPaused: true }, 'publication_paused'],
    ['approved', { workerEnabled: false }, 'publication_worker_disabled'],
    ['published', { deliveryMode: 'mock' }, 'publication_simulation'],
    ['published', {}, 'publication_pending']
  ]) {
    const workflow = project(
      commitment,
      commitment.obligations.map((o) => publication(o, status, changes))
    );
    assert.equal(workflow.reason, reason);
    assert.equal(workflow.responsibility, 'admin');
    assert.notEqual(workflow.state, 'complete');
  }
});

test('a legacy pending job without a final delivery cannot masquerade as an authorized schedule', () => {
  const commitment = agreement();
  const workflow = project(
    commitment,
    commitment.obligations.map((o) =>
      publication(o, 'pending', { deliveryId: null })
    )
  );
  assert.equal(workflow.state, 'action_required');
  assert.equal(workflow.responsibility, 'admin');
  assert.equal(workflow.reason, 'publication_authorization_required');
});

test('one exact scheduled passage does not authorize another passage or reuse a legacy unbound row', () => {
  const commitment = agreement();
  commitment.obligations = [
    commitment.obligations[0],
    {
      ...commitment.obligations[0],
      id: 'second-facebook',
      ordinal: 2
    }
  ];
  commitment.offer.benefits = [
    { ...commitment.offer.benefits[0], quantity: 2 }
  ];
  const scheduled = publication(commitment.obligations[0], 'approved');
  const workflow = project(commitment, [scheduled]);
  assert.equal(workflow.state, 'waiting');
  assert.equal(workflow.obligations[0].reason, 'publication_scheduled');
  assert.equal(workflow.obligations[1].reason, 'publication_pending');
  assert.equal(workflow.obligations[1].deliveryId, null);
  const legacy = project(commitment, [{ ...scheduled, obligationId: null }]);
  assert.equal(legacy.state, 'action_required');
  assert.equal(
    legacy.obligations[0].reason,
    'publication_preparation_required'
  );
});

test('an unresolved historical send holds repeated passages on its channel without supplying fulfilment or blocking another channel', () => {
  for (const [status, state, responsibility, reason] of [
    ['uncertain', 'uncertain', 'admin', 'publication_uncertain'],
    ['publishing', 'waiting', 'platform', 'publication_publishing']
  ]) {
    for (const target of ['openg7', 'openg20']) {
      const commitment = agreement();
      const first = commitment.obligations[0];
      commitment.obligations.push({
        ...first,
        id: 'second-facebook',
        ordinal: 2
      });
      commitment.offer.benefits[0].quantity = 2;
      const unresolved = publication(first, status, {
        obligationId: null,
        target
      });
      const workflow = project(commitment, [unresolved]);
      const held = workflow.obligations.filter(
        (item) => item.channel === 'facebook'
      );
      assert.ok(held.every((item) => item.state === state));
      assert.ok(held.every((item) => item.responsibility === responsibility));
      assert.ok(held.every((item) => item.reason === reason));
      assert.ok(
        held.every((item) => item.deliveryId === unresolved.deliveryId)
      );
      assert.ok(held.every((item) => item.scheduledAt === null));
      assert.ok(
        commitment.obligations.every(
          (item) => item.state === 'pending' && !item.fulfilmentEvidenceId
        )
      );
      assert.equal(
        workflow.obligations.find((item) => item.channel === 'linkedin').reason,
        'publication_preparation_required'
      );
      const dateOnly = project(commitment, [
        { ...unresolved, deliveryId: null, deliveryStatus: null }
      ]);
      assert.equal(dateOnly.obligations[0].state, 'action_required');
      assert.equal(
        dateOnly.obligations[0].reason,
        'publication_preparation_required'
      );
    }
  }
});

test('all recorded fulfilments or explicit waivers complete the workflow without another declaration', () => {
  const commitment = agreement();
  Object.assign(commitment.obligations[0], {
    state: 'fulfilled',
    fulfilmentEvidenceId: 'qualified-evidence'
  });
  commitment.obligations[1].state = 'adjusted';
  const workflow = project(commitment, [], [], undefined, [
    'qualified-evidence'
  ]);
  assert.equal(workflow.state, 'complete');
  assert.equal(workflow.responsibility, 'none');
  assert.equal(workflow.reason, 'publication_done');
});

test('a fulfilled flag without a qualified proof never closes the workflow and uncertainty remains visible after fulfilment', () => {
  const commitment = agreement();
  for (const obligation of commitment.obligations)
    Object.assign(obligation, {
      state: 'fulfilled',
      fulfilmentEvidenceId: 'proof-' + obligation.id
    });
  const unverified = project(commitment, []);
  assert.equal(unverified.state, 'blocked');
  assert.equal(unverified.reason, 'fulfilment_unverified');
  const uncertain = project(
    commitment,
    [publication(commitment.obligations[0], 'uncertain')],
    [],
    undefined,
    commitment.obligations.map((obligation) => obligation.fulfilmentEvidenceId)
  );
  assert.equal(uncertain.state, 'uncertain');
  assert.equal(uncertain.reason, 'publication_uncertain');
});

test('a blocked image promise cannot change another authorized text promise into a human action', () => {
  const commitment = agreement();
  Object.assign(commitment.obligations[1], {
    state: 'blocked',
    blockedReason: 'required_elements_missing'
  });
  const workflow = project(commitment, [
    publication(commitment.obligations[0], 'approved')
  ]);
  assert.equal(workflow.obligations[0].state, 'waiting');
  assert.equal(workflow.obligations[0].responsibility, 'platform');
  assert.equal(workflow.obligations[1].state, 'blocked');
});

test('a retired source cannot displace the active authorized passage, while an uncertain retired attempt remains visible', () => {
  const commitment = agreement();
  commitment.obligations = [commitment.obligations[0]];
  const active = publication(commitment.obligations[0], 'approved');
  for (const retiredStatus of ['cancelled', 'rejected']) {
    for (const retiredDelivery of ['draft', 'blocked']) {
      const retired = {
        ...active,
        id: 'retired-source',
        deliveryId: 'retired-delivery',
        status: retiredStatus,
        deliveryStatus: retiredDelivery
      };
      for (const rows of [
        [retired, active],
        [active, retired]
      ]) {
        const workflow = project(commitment, rows);
        assert.equal(workflow.reason, 'publication_scheduled');
        assert.equal(workflow.obligations[0].deliveryId, active.deliveryId);
        const uncertain = project(
          commitment,
          rows.map((item) =>
            item.id === retired.id
              ? { ...item, deliveryStatus: 'uncertain' }
              : item
          )
        );
        assert.equal(uncertain.reason, 'publication_uncertain');
        assert.equal(uncertain.obligations[0].deliveryId, retired.deliveryId);
      }
    }
  }
});

test('a sole human refusal remains blocked with its exact delivery instead of requesting another preparation', () => {
  const commitment = agreement();
  commitment.obligations = [commitment.obligations[0]];
  for (const [sourceStatus, deliveryStatus] of [
    ['scheduled', 'rejected'],
    ['rejected', 'rejected'],
    ['rejected', 'blocked'],
    ['rejected', null]
  ]) {
    const refused = publication(commitment.obligations[0], deliveryStatus, {
      status: sourceStatus
    });
    const workflow = project(commitment, [refused]);
    assert.equal(workflow.state, 'blocked');
    assert.equal(workflow.reason, 'publication_failed');
    assert.equal(workflow.responsibility, 'admin');
    assert.equal(workflow.obligations[0].deliveryId, refused.deliveryId);
  }
});

test('a legacy refusal blocks its destination without replacing active passages or assigning its date to ambiguous ordinals', () => {
  const commitment = agreement();
  const first = commitment.obligations[0];
  commitment.obligations.push({
    ...first,
    id: 'second-facebook',
    ordinal: 2
  });
  commitment.offer.benefits[0].quantity = 2;
  const refused = publication(first, 'rejected', {
    obligationId: null,
    status: 'rejected'
  });
  const blocked = project(commitment, [refused]);
  const facebook = blocked.obligations.filter(
    (item) => item.channel === 'facebook'
  );
  assert.ok(facebook.every((item) => item.state === 'blocked'));
  assert.ok(facebook.every((item) => item.reason === 'publication_failed'));
  assert.ok(facebook.every((item) => item.deliveryId === refused.deliveryId));
  assert.ok(facebook.every((item) => item.scheduledAt === null));
  assert.equal(
    blocked.obligations.find((item) => item.channel === 'linkedin').reason,
    'publication_preparation_required'
  );
  const active = publication(first, 'approved');
  for (const rows of [
    [refused, active],
    [active, refused]
  ]) {
    const current = project(commitment, rows);
    assert.equal(current.obligations[0].reason, 'publication_scheduled');
    assert.equal(current.obligations[0].deliveryId, active.deliveryId);
    assert.equal(current.obligations[0].scheduledAt, active.scheduledAt);
    assert.equal(current.obligations[2].state, 'blocked');
  }
  const otherDestination = project(commitment, [
    { ...refused, target: 'openg20' }
  ]);
  assert.equal(
    otherDestination.obligations[0].reason,
    'publication_preparation_required'
  );
  const boundRefusal = project(commitment, [
    { ...refused, obligationId: first.id }
  ]);
  assert.equal(boundRefusal.obligations[0].state, 'blocked');
  assert.equal(boundRefusal.obligations[2].reason, 'publication_pending');
  assert.equal(boundRefusal.obligations[2].deliveryId, null);
});

test('preparation keeps quantity, provenance and historical proof integrity gates with accurate reasons', () => {
  assert.deepEqual(
    preparationBalanceBlockers({
      unknown: 0,
      reasons: ['publication_pending']
    }),
    []
  );
  for (const [reason, blocker] of [
    ['offer_payment_mismatch', 'offer_unverified'],
    ['obligation_offer_mismatch', 'obligation_unverified'],
    ['promised_obligation_missing', 'obligation_unverified'],
    ['deadline_origin_unknown', 'obligation_unverified'],
    ['fulfilment_evidence_mismatch', 'fulfilment_unverified'],
    ['fulfilment_snapshot_unqualified', 'fulfilment_unverified'],
    ['orphan_fulfilment_evidence', 'fulfilment_unverified'],
    ['new_unknown_condition', 'offer_unverified']
  ])
    assert.deepEqual(
      preparationBalanceBlockers({ unknown: 1, reasons: [reason] }),
      [blocker]
    );
});
