import assert from 'node:assert/strict';
import test from 'node:test';

import { publicationMonitor } from '../dist/apps/funding-web/src/app/features/funding/models/admin-sponsorship-publication-monitor.js';

const obligation = (id = 'web', channel = 'website', ordinal = 1) => ({
  id,
  channel,
  ordinal,
  target: 'openg7',
  commitmentId: 'agreement',
  contributionId: 'dossier',
  benefitId: channel === 'website' ? 'website_presence' : 'facebook_batch',
  version: 1,
  state: 'pending',
  blockedReason: null,
  fulfilmentEvidenceId: null
});
const base = () => ({
  contributionId: 'dossier',
  commitment: {
    id: 'agreement',
    state: 'active',
    version: 1,
    offer: { benefits: [] },
    obligations: [obligation(), obligation('facebook', 'facebook')]
  },
  publications: [],
  qualifiedFulfilmentEvidenceIds: [],
  fulfilmentEvidence: [],
  publicationWorkflow: {
    state: 'action_required',
    reason: 'publication_preparation_required',
    responsibility: 'admin',
    obligations: ['web', 'facebook'].map((id, index) => ({
      obligationId: id,
      channel: index ? 'facebook' : 'website',
      target: 'openg7',
      ordinal: 1,
      deliveryId: null,
      scheduledAt: null,
      state: 'action_required',
      reason: index
        ? 'publication_preparation_required'
        : 'website_publication_required',
      responsibility: 'admin'
    }))
  }
});
const prepared = () => ({
  contributionId: 'dossier',
  enabled: true,
  sourceVersion: 4,
  sourceSnapshotDigest: 'digest',
  mission: {
    id: 'mission',
    status: 'review_ready',
    delivery: 'acknowledged',
    updatedAt: '2026-11-08T12:00:00Z',
    errorCode: null
  },
  history: [],
  proposal: {
    id: 'proposal',
    sourceVersion: 4,
    version: 2,
    obsolete: false,
    adoptedAt: null,
    provenance: { simulated: false },
    editorialPreparation: {
      sourceVersion: 4,
      sourceSnapshotDigest: 'digest',
      sourceCommitmentId: 'agreement',
      commitmentVersion: 1,
      state: 'ready_for_review',
      common: { missingInformation: [] },
      variants: ['web', 'facebook'].map((id, index) => ({
        obligationId: id,
        obligationVersion: 1,
        destination: index ? 'facebook' : 'website',
        summary: 'Ready for review',
        version: 3
      }))
    }
  }
});
const desk = (changes = {}) => ({
  id: 'facebook',
  contributionId: 'dossier',
  channel: 'facebook',
  target: 'openg7',
  ordinal: 1,
  obligationState: 'pending',
  stage: 'to_review',
  blocked: false,
  blockers: [],
  preparation: { serviceDecision: null },
  ...changes
});
const socialPublication = (changes = {}) => ({
  id: 'draft',
  obligationId: 'facebook',
  channel: 'facebook',
  target: 'openg7',
  status: 'draft',
  deliveryId: 'delivery',
  deliveryStatus: 'draft',
  deliveryMode: 'live',
  ...changes
});
const automation = (changes = {}) => ({
  feeds: [],
  deliveries: [
    {
      id: 'delivery',
      feedId: 'openg7:facebook',
      sponsors: [{ id: 'dossier' }],
      status: 'approved',
      mode: 'live',
      errorCode: null,
      ...changes
    }
  ]
});

test('monitor distinguishes preparation, disabled, waiting and unavailable without invented progress', () => {
  const dossier = base();
  const workshop = prepared();
  workshop.proposal = null;
  workshop.mission.status = 'running';
  const result = publicationMonitor(dossier, workshop, null);
  assert.equal(result.state, 'preparing');
  assert.equal(result.next.action, 'refresh');
  assert.equal(result.checkedAt, workshop.mission.updatedAt);
  assert.equal(result.delivered, 0);
  assert.equal(
    publicationMonitor(dossier, { ...workshop, enabled: false }, null).state,
    'disabled'
  );
  assert.equal(publicationMonitor(dossier, null, null).state, 'waiting');
  delete dossier.publicationWorkflow;
  assert.equal(publicationMonitor(dossier, null, null).state, 'unavailable');
});

test('proposals stay private review opportunities until exact recorded queue membership exists', () => {
  const result = publicationMonitor(base(), prepared(), null);
  assert.equal(result.proposalCount, 2);
  assert.equal(result.delivered, 0);
  assert.deepEqual(
    result.rows.map((row) => [row.status, row.action]),
    [
      ['proposal', 'review'],
      ['proposal', 'review']
    ]
  );
  const queued = publicationMonitor(base(), prepared(), null, [desk()]);
  assert.equal(queued.rows[1].status, 'collective_review');
  assert.equal(queued.next.action, 'queue');
  assert.equal(queued.rows[0].status, 'proposal');
});

test('dossier, agreement, source, channel and obligation versions fence all proposal joins', () => {
  for (const mutate of [
    (workshop) => {
      workshop.contributionId = 'other';
    },
    (workshop) => {
      workshop.proposal.sourceVersion = 3;
    },
    (workshop) => {
      workshop.proposal.obsolete = true;
    },
    (workshop) => {
      workshop.proposal.editorialPreparation.sourceVersion = 3;
    },
    (workshop) => {
      workshop.proposal.editorialPreparation.sourceSnapshotDigest = 'other';
    },
    (workshop) => {
      workshop.proposal.editorialPreparation.sourceCommitmentId = 'other';
    },
    (workshop) => {
      workshop.proposal.editorialPreparation.commitmentVersion = 2;
    },
    (workshop) => {
      for (const variant of workshop.proposal.editorialPreparation.variants)
        variant.obligationVersion = 2;
    },
    (workshop) => {
      for (const variant of workshop.proposal.editorialPreparation.variants)
        variant.destination = 'linkedin';
    }
  ]) {
    const workshop = prepared();
    mutate(workshop);
    const result = publicationMonitor(base(), workshop, null);
    assert.equal(result.proposalCount, 0);
    assert.ok(result.rows.every((row) => !row.proposal && !row.variant));
  }
  for (const changes of [
    { contributionId: 'other' },
    { id: 'other' },
    { channel: 'linkedin' },
    { ordinal: 2 }
  ])
    assert.notEqual(
      publicationMonitor(base(), prepared(), null, [desk(changes)]).rows[1]
        .status,
      'collective_review'
    );
});

test('partial, obsolete, adopted and simulated preparations remain distinguishable', () => {
  const workshop = prepared();
  workshop.proposal.editorialPreparation.state = 'partial';
  workshop.proposal.editorialPreparation.common.missingInformation = [
    'contact_email'
  ];
  workshop.proposal.provenance.simulated = true;
  let row = publicationMonitor(base(), workshop, null).rows[0];
  assert.equal(row.status, 'partial');
  assert.deepEqual(row.warnings, ['contact_email', 'preparation_simulated']);
  workshop.proposal.editorialPreparation.state = 'ready_for_review';
  workshop.proposal.adoptedAt = '2026-11-08T12:00:00Z';
  let result = publicationMonitor(base(), workshop, null);
  assert.equal(result.rows[0].status, 'adopted');
  assert.equal(result.delivered, 0);
  assert.equal(result.proposalCount, 0);
  workshop.history = [{ ...workshop.proposal, obsolete: true }];
  workshop.proposal = null;
  row = publicationMonitor(base(), workshop, null).rows[0];
  assert.equal(row.status, 'obsolete');
  assert.deepEqual(row.warnings, ['proposal_obsolete']);
});

test('confirmed source blockers override ready proposals and queue membership', () => {
  const dossier = base();
  dossier.publicationBlockers = ['consent_missing'];
  dossier.publicationWorkflow.obligations[1].state = 'blocked';
  dossier.publicationWorkflow.obligations[1].reason = 'publication_blocked';
  const result = publicationMonitor(dossier, prepared(), null, [desk()]);
  assert.equal(result.state, 'exception');
  assert.equal(result.rows[1].status, 'exception');
  assert.equal(result.next.action, 'resolve');
  assert.ok(result.next.warnings.includes('consent_missing'));
});

test('approved review, scheduled delivery and publishing are distinct and never delivered', () => {
  let result = publicationMonitor(base(), prepared(), null, [
    desk({
      stage: 'to_deliver',
      preparation: {
        serviceDecision: {
          decision: 'approved',
          createdAt: '2026-11-08T12:00:00Z',
          contentVersion: 'current'
        }
      }
    })
  ]);
  assert.equal(result.rows[1].status, 'approved');
  const dossier = base();
  dossier.publications = [socialPublication()];
  result = publicationMonitor(dossier, prepared(), automation());
  assert.equal(result.rows[1].status, 'scheduled');
  assert.equal(result.rows[1].action, 'schedule');
  result = publicationMonitor(
    dossier,
    prepared(),
    automation({ status: 'publishing' })
  );
  assert.equal(result.rows[1].status, 'publishing');
  assert.equal(result.delivered, 0);
});

test('unrelated automation deliveries cannot influence the selected dossier or passage', () => {
  const dossier = base();
  dossier.publications = [socialPublication()];
  for (const changes of [
    { sponsors: [{ id: 'other' }] },
    { feedId: 'openg20:facebook' },
    { id: 'other' }
  ]) {
    const row = publicationMonitor(dossier, null, automation(changes)).rows[1];
    assert.equal(row.delivery, null);
    assert.notEqual(row.status, 'scheduled');
  }
  dossier.publications[0].obligationId = 'other';
  assert.equal(
    publicationMonitor(dossier, null, automation()).rows[1].delivery,
    null
  );
});

test('published and mock declarations without qualified proofs do not fulfil obligations', () => {
  const dossier = base();
  dossier.publications = [
    socialPublication({ status: 'published', deliveryStatus: 'published' })
  ];
  let result = publicationMonitor(
    dossier,
    null,
    automation({ status: 'published' })
  );
  assert.equal(result.rows[1].status, 'exception');
  assert.equal(result.delivered, 0);
  result = publicationMonitor(
    dossier,
    null,
    automation({ status: 'published', mode: 'mock' })
  );
  assert.equal(result.rows[1].status, 'simulated');
  assert.equal(result.delivered, 0);
});

test('proofs qualify exact obligations and repeated passages retain their own states and totals', () => {
  const dossier = base();
  dossier.commitment.obligations.push(obligation('facebook-2', 'facebook', 2), {
    ...obligation('facebook-adjusted', 'facebook', 3),
    state: 'adjusted'
  });
  dossier.commitment.obligations[1] = {
    ...dossier.commitment.obligations[1],
    state: 'fulfilled',
    fulfilmentEvidenceId: 'proof'
  };
  dossier.fulfilmentEvidence = [
    {
      id: 'proof',
      obligationId: 'facebook',
      channel: 'facebook',
      target: 'openg7',
      deliveredAt: '2026-11-08T12:00:00Z'
    }
  ];
  dossier.qualifiedFulfilmentEvidenceIds = ['proof'];
  const result = publicationMonitor(dossier, prepared(), null);
  assert.equal(result.total, 3);
  assert.equal(result.delivered, 1);
  assert.equal(result.remaining, 2);
  assert.equal(result.adjusted, 1);
  assert.equal(result.rows[1].status, 'delivered');
  assert.equal(result.rows[1].action, 'proof');
  assert.equal(result.rows[2].proposal, null);
  assert.notEqual(result.rows[2].status, 'delivered');
  dossier.qualifiedFulfilmentEvidenceIds = [];
  assert.equal(publicationMonitor(dossier, prepared(), null).delivered, 0);
});

test('uncertain receipt outranks an older proof while retaining confirmed delivery facts', () => {
  const dossier = base();
  dossier.commitment.obligations[1] = {
    ...dossier.commitment.obligations[1],
    state: 'fulfilled',
    fulfilmentEvidenceId: 'proof'
  };
  dossier.fulfilmentEvidence = [
    {
      id: 'proof',
      obligationId: 'facebook',
      channel: 'facebook',
      target: 'openg7'
    }
  ];
  dossier.qualifiedFulfilmentEvidenceIds = ['proof'];
  dossier.publicationWorkflow.obligations[1].state = 'uncertain';
  dossier.publicationWorkflow.obligations[1].reason = 'publication_uncertain';
  const result = publicationMonitor(dossier, prepared(), null);
  assert.equal(result.rows[1].status, 'exception');
  assert.equal(result.rows[1].evidence.id, 'proof');
  assert.equal(result.complete, false);
  assert.equal(result.delivered, 1);
});

test('fully delivered dossiers offer proof consultation without a further administrative step', () => {
  const dossier = base();
  for (const row of dossier.commitment.obligations) {
    row.state = 'fulfilled';
    row.fulfilmentEvidenceId = `${row.id}-proof`;
    dossier.qualifiedFulfilmentEvidenceIds.push(row.fulfilmentEvidenceId);
    dossier.fulfilmentEvidence.push({
      id: row.fulfilmentEvidenceId,
      obligationId: row.id,
      channel: row.channel,
      target: row.target
    });
  }
  const result = publicationMonitor(dossier, prepared(), null);
  assert.equal(result.complete, true);
  assert.equal(result.next, null);
  assert.equal(result.state, 'delivered');
  assert.equal(result.delivered, 2);
});

test('missing, unconfirmed and empty agreements are separate from tracking outages', () => {
  const dossier = base();
  assert.equal(
    publicationMonitor({ ...dossier, commitment: null }, null, null).state,
    'agreement_unknown'
  );
  dossier.commitment.state = 'needs_confirmation';
  assert.equal(
    publicationMonitor(dossier, null, null).state,
    'agreement_unconfirmed'
  );
  dossier.commitment.state = 'active';
  dossier.commitment.obligations = [];
  const result = publicationMonitor(dossier, null, null);
  assert.equal(result.state, 'empty');
  assert.equal(result.total, 0);
  assert.equal(result.complete, false);
});

test('observed consent and destination incidents stay visible even when other projections are older', () => {
  const dossier = base();
  dossier.publicConsent = false;
  assert.equal(
    publicationMonitor(dossier, prepared(), null).next.status,
    'exception'
  );
  dossier.publicConsent = true;
  dossier.publications = [socialPublication()];
  for (const changes of [
    { workerEnabled: false },
    { feeds: [{ id: 'openg7:facebook', paused: true }] },
    { feeds: [{ id: 'openg7:facebook', configured: false }] },
    { feeds: [{ id: 'openg7:facebook', connection: 'expired' }] }
  ]) {
    const result = publicationMonitor(dossier, prepared(), {
      ...automation(),
      ...changes
    });
    assert.equal(result.rows[1].status, 'exception');
    assert.ok(result.rows[1].warnings.length > 0);
  }
});

test('mission preparation does not imply work on unsupported channels or future passages', () => {
  const dossier = base();
  dossier.commitment.obligations.push(
    obligation('linkedin', 'linkedin'),
    obligation('facebook-2', 'facebook', 2)
  );
  dossier.publicationWorkflow.obligations.push(
    {
      ...dossier.publicationWorkflow.obligations[1],
      obligationId: 'linkedin',
      channel: 'linkedin'
    },
    {
      ...dossier.publicationWorkflow.obligations[1],
      obligationId: 'facebook-2',
      ordinal: 2
    }
  );
  const workshop = prepared();
  workshop.proposal = null;
  workshop.mission.status = 'running';
  const result = publicationMonitor(dossier, workshop, null);
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ['preparing', 'preparing', 'waiting', 'waiting']
  );
});

test('failed or uncertain preparation has a real exception without an automatic retry', () => {
  for (const changes of [
    { delivery: 'uncertain' },
    { delivery: 'failed' },
    { status: 'failed' },
    { errorCode: 'REMOTE_UNAVAILABLE' }
  ]) {
    const workshop = prepared();
    workshop.proposal = null;
    Object.assign(workshop.mission, changes);
    const result = publicationMonitor(base(), workshop, null);
    assert.equal(result.state, 'exception');
    assert.equal(result.next.action, 'resolve');
    assert.equal(result.delivered, 0);
  }
});

test('every active mission state observed in the real Preflight contract remains in preparation', () => {
  for (const status of [
    'received',
    'planning',
    'ready',
    'running',
    'waiting_dependency',
    'pending',
    'processing'
  ]) {
    const state = prepared();
    state.proposal = null;
    state.mission.status = status;
    assert.equal(
      publicationMonitor(base(), state, null).state,
      'preparing',
      status
    );
  }
  const state = prepared();
  state.proposal = null;
  state.mission.status = 'waiting_input';
  const monitor = publicationMonitor(base(), state, null);
  assert.equal(monitor.state, 'exception');
  assert.ok(monitor.next.warnings.includes('preparation_input_required'));
});

test('native Funding drafts remain reviewable while Preflight preparation is disabled', () => {
  const dossier = base();
  dossier.publications = [socialPublication()];
  const state = prepared();
  state.enabled = false;
  state.proposal = null;
  const row = publicationMonitor(dossier, state, null).rows[1];
  assert.equal(row.status, 'waiting');
  assert.equal(row.action, 'review');
});
