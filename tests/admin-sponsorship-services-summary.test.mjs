import assert from 'node:assert/strict';
import test from 'node:test';

import { dossierServiceSummary } from '../dist/apps/funding-web/src/app/features/funding/models/admin-sponsorship-services-summary.js';

const obligation = (overrides = {}) => ({
  id: 'obligation-demo',
  commitmentId: 'commitment-demo',
  contributionId: 'dossier-demo',
  benefitId: 'facebook_batch',
  channel: 'facebook',
  target: 'openg7',
  ordinal: 1,
  state: 'pending',
  blockedReason: null,
  version: 1,
  fulfilmentEvidenceId: null,
  ...overrides
});

const workflow = (overrides = {}) => ({
  obligationId: 'obligation-demo',
  channel: 'facebook',
  target: 'openg7',
  ordinal: 1,
  state: 'action_required',
  responsibility: 'admin',
  reason: 'publication_authorization_required',
  deliveryId: 'delivery-demo',
  scheduledAt: '2026-10-26T14:00:00Z',
  ...overrides
});

const proof = (overrides = {}) => ({
  id: 'evidence-demo',
  obligationId: 'obligation-demo',
  deliveryId: 'delivery-demo',
  channel: 'facebook',
  target: 'openg7',
  provenance: 'provider_verified',
  deliveredAt: '2026-10-22T14:00:00Z',
  externalPostUrl: 'https://example.invalid/publication-demo',
  visibility: 'visible',
  visibilityObservedAt: '2026-10-22T14:00:00Z',
  ...overrides
});

const dossier = (overrides = {}) => ({
  contributionId: 'dossier-demo',
  commitment: {
    id: 'commitment-demo',
    state: 'active',
    version: 1,
    offer: { version: 'recorded-offer-demo', benefits: [] },
    obligations: [obligation()]
  },
  publicationWorkflow: {
    state: 'action_required',
    responsibility: 'admin',
    reason: 'publication_authorization_required',
    obligations: [workflow()]
  },
  qualifiedFulfilmentEvidenceIds: [],
  fulfilmentEvidence: [],
  publications: [],
  ...overrides
});

const fulfilledDossier = () => {
  const snapshot = dossier();
  return {
    ...snapshot,
    commitment: {
      ...snapshot.commitment,
      obligations: [
        obligation({
          state: 'fulfilled',
          fulfilmentEvidenceId: 'evidence-demo'
        })
      ]
    },
    qualifiedFulfilmentEvidenceIds: ['evidence-demo'],
    fulfilmentEvidence: [proof()]
  };
};

test('missing or unconfirmed agreements never expose presumed promises or totals', () => {
  const snapshot = fulfilledDossier();
  for (const [commitment, state] of [
    [undefined, 'agreement_unknown'],
    [null, 'agreement_unknown'],
    [{ ...snapshot.commitment, offer: null }, 'agreement_unknown'],
    [
      { ...snapshot.commitment, state: 'needs_confirmation' },
      'agreement_unconfirmed'
    ],
    [
      { ...snapshot.commitment, state: 'needs_confirmation', offer: null },
      'agreement_unconfirmed'
    ]
  ]) {
    assert.deepEqual(dossierServiceSummary({ ...snapshot, commitment }), {
      state,
      total: 0,
      fulfilled: 0,
      adjusted: 0,
      remaining: 0,
      rows: []
    });
  }
});

test('an active empty agreement stays empty despite offer quantities and publications', () => {
  const snapshot = dossier();
  assert.deepEqual(
    dossierServiceSummary({
      ...snapshot,
      commitment: {
        ...snapshot.commitment,
        offer: {
          benefits: [{ id: 'facebook_batch', quantity: 3 }]
        },
        obligations: []
      },
      publications: [{ status: 'published', deliveryStatus: 'published' }]
    }),
    {
      state: 'empty',
      total: 0,
      fulfilled: 0,
      adjusted: 0,
      remaining: 0,
      rows: []
    }
  );
});

test('only exact qualified evidence establishes fulfilment and preserves its source', () => {
  const snapshot = fulfilledDossier();
  const before = structuredClone(snapshot);
  const summary = dossierServiceSummary(snapshot);
  assert.equal(summary.state, 'ready');
  assert.equal(summary.total, 1);
  assert.equal(summary.fulfilled, 1);
  assert.equal(summary.adjusted, 0);
  assert.equal(summary.remaining, 0);
  assert.equal(summary.rows[0].status, 'fulfilled');
  assert.equal(summary.rows[0].evidence, snapshot.fulfilmentEvidence[0]);
  assert.equal(summary.rows[0].obligation, snapshot.commitment.obligations[0]);
  assert.equal(
    summary.rows[0].workflow,
    snapshot.publicationWorkflow.obligations[0]
  );
  assert.deepEqual(snapshot, before);
});

test('incomplete or mismatched evidence never counts an asserted fulfilment', () => {
  const snapshot = fulfilledDossier();
  const invalid = [
    { qualifiedFulfilmentEvidenceIds: undefined },
    { qualifiedFulfilmentEvidenceIds: [] },
    { fulfilmentEvidence: undefined },
    { fulfilmentEvidence: [] }
  ];
  for (const overrides of [
    { id: 'another-evidence' },
    { obligationId: 'another-obligation' },
    { channel: 'linkedin' },
    { target: 'openg20' }
  ])
    invalid.push({ fulfilmentEvidence: [proof(overrides)] });
  for (const overrides of invalid) {
    const summary = dossierServiceSummary({ ...snapshot, ...overrides });
    assert.equal(summary.fulfilled, 0);
    assert.equal(summary.remaining, 1);
    assert.equal(summary.rows[0].status, 'unverified');
    assert.equal(summary.rows[0].evidence, undefined);
  }
});

test('evidence cannot fulfil a promise that remains pending or blocked', () => {
  const snapshot = fulfilledDossier();
  for (const state of ['pending', 'blocked']) {
    const summary = dossierServiceSummary({
      ...snapshot,
      commitment: {
        ...snapshot.commitment,
        obligations: [{ ...snapshot.commitment.obligations[0], state }]
      }
    });
    assert.equal(summary.fulfilled, 0);
    assert.equal(summary.remaining, 1);
    assert.equal(summary.rows[0].evidence, undefined);
    assert.equal(summary.rows[0].status, 'action_required');
  }
});

test('a recorded waiver is adjusted separately from confirmed fulfilment', () => {
  const snapshot = fulfilledDossier();
  const summary = dossierServiceSummary({
    ...snapshot,
    commitment: {
      ...snapshot.commitment,
      obligations: [
        { ...snapshot.commitment.obligations[0], state: 'adjusted' }
      ]
    }
  });
  assert.equal(summary.rows[0].status, 'adjusted');
  assert.equal(summary.rows[0].evidence, undefined);
  assert.equal(summary.fulfilled, 0);
  assert.equal(summary.adjusted, 1);
  assert.equal(summary.remaining, 0);
});

test('a complete workflow without qualified evidence remains unverified', () => {
  const snapshot = dossier();
  const summary = dossierServiceSummary({
    ...snapshot,
    publicationWorkflow: {
      ...snapshot.publicationWorkflow,
      state: 'complete',
      obligations: [workflow({ state: 'complete', reason: 'publication_done' })]
    }
  });
  assert.equal(summary.rows[0].status, 'unverified');
  assert.equal(summary.fulfilled, 0);
  assert.equal(summary.remaining, 1);
});

test('each operational state and responsibility remain those of the exact server row', () => {
  const snapshot = dossier();
  for (const state of [
    'waiting',
    'action_required',
    'blocked',
    'error',
    'uncertain'
  ]) {
    const row = workflow({ state, responsibility: 'platform' });
    const summary = dossierServiceSummary({
      ...snapshot,
      publicationWorkflow: {
        ...snapshot.publicationWorkflow,
        obligations: [row]
      }
    });
    assert.equal(summary.rows[0].status, state);
    assert.equal(summary.rows[0].workflow, row);
    assert.equal(summary.remaining, 1);
  }
});

test('workflow joins reject a different promise, channel, target or occurrence', () => {
  const snapshot = dossier();
  for (const overrides of [
    { obligationId: 'another-obligation' },
    { channel: 'linkedin' },
    { target: 'openg20' },
    { ordinal: 2 }
  ]) {
    const summary = dossierServiceSummary({
      ...snapshot,
      publicationWorkflow: {
        ...snapshot.publicationWorkflow,
        obligations: [workflow(overrides)]
      }
    });
    assert.equal(summary.rows[0].workflow, null);
    assert.equal(summary.rows[0].status, 'unavailable');
  }
});

test('a missing workflow is unavailable and dates or published declarations grant no progress', () => {
  const summary = dossierServiceSummary(
    dossier({
      publicationWorkflow: undefined,
      website: { visible: true, canPublish: true },
      feedStatus: 'published',
      publicationCompletion: { done: 7, total: 7 },
      publications: [
        {
          obligationId: 'obligation-demo',
          channel: 'facebook',
          target: 'openg7',
          status: 'published',
          deliveryStatus: 'published',
          deliveryMode: 'live',
          publishedAt: '2026-10-22T14:00:00Z'
        }
      ]
    })
  );
  assert.equal(summary.rows[0].workflow, null);
  assert.equal(summary.rows[0].status, 'unavailable');
  assert.equal(summary.fulfilled, 0);
  assert.equal(summary.remaining, 1);
});

test('a simulated published delivery remains unresolved', () => {
  const snapshot = dossier();
  const row = workflow({ reason: 'publication_simulation' });
  const summary = dossierServiceSummary({
    ...snapshot,
    publicationWorkflow: {
      ...snapshot.publicationWorkflow,
      obligations: [row]
    },
    publications: [
      {
        deliveryId: row.deliveryId,
        deliveryStatus: 'published',
        deliveryMode: 'mock'
      }
    ]
  });
  assert.equal(summary.rows[0].status, 'action_required');
  assert.equal(summary.fulfilled, 0);
  assert.equal(summary.remaining, 1);
});

test('display duration preserves server waiting state without reading the local clock', () => {
  for (const earliestCompletionAt of [
    '2000-01-01T00:00:00Z',
    '2099-01-01T00:00:00Z'
  ]) {
    const snapshot = dossier();
    const summary = dossierServiceSummary({
      ...snapshot,
      commitment: {
        ...snapshot.commitment,
        obligations: [
          obligation({
            benefitId: 'website_mention',
            channel: 'website',
            timing: {
              durationState: 'awaiting_review',
              startObservation: { earliestCompletionAt }
            }
          })
        ]
      },
      website: { visible: true },
      publicationWorkflow: {
        ...snapshot.publicationWorkflow,
        obligations: [
          workflow({
            channel: 'website',
            state: 'waiting',
            responsibility: 'platform',
            reason: 'duration_in_progress'
          })
        ]
      }
    });
    assert.equal(summary.rows[0].status, 'waiting');
    assert.equal(summary.rows[0].workflow.reason, 'duration_in_progress');
    assert.equal(summary.fulfilled, 0);
    assert.equal(summary.remaining, 1);
  }
});

test('current visibility does not erase a qualified historical fulfilment', () => {
  const snapshot = fulfilledDossier();
  const summary = dossierServiceSummary({
    ...snapshot,
    website: { visible: false },
    fulfilmentEvidence: [proof({ visibility: 'missing' })]
  });
  assert.equal(summary.rows[0].status, 'fulfilled');
  assert.equal(summary.rows[0].evidence.visibility, 'missing');
  assert.equal(summary.fulfilled, 1);
});

test('repeated promises retain their ordinals and share their benefit count after destination changes', () => {
  const snapshot = dossier();
  const obligations = [
    obligation({ id: 'facebook-3', ordinal: 3, target: 'openg20' }),
    obligation({
      id: 'website-1',
      benefitId: 'website_mention',
      channel: 'website'
    }),
    obligation({ id: 'facebook-1', ordinal: 1 }),
    obligation({ id: 'facebook-2', ordinal: 2 }),
    obligation({
      id: 'linkedin-1',
      benefitId: 'linkedin_batch',
      channel: 'linkedin'
    })
  ];
  const summary = dossierServiceSummary({
    ...snapshot,
    commitment: { ...snapshot.commitment, obligations },
    publicationWorkflow: undefined,
    publications: Array.from({ length: 15 }, (_, index) => ({
      id: `draft-${index}`
    }))
  });
  assert.equal(summary.total, 5);
  assert.equal(summary.remaining, 5);
  assert.deepEqual(
    summary.rows.map((row) => row.obligation),
    obligations
  );
  assert.deepEqual(
    summary.rows.map((row) => row.occurrenceCount),
    [3, 1, 3, 3, 1]
  );
  assert.deepEqual(
    summary.rows.map((row) => row.obligation.ordinal),
    [3, 1, 1, 2, 1]
  );
});

test('partial completion counts proof, waiver and remaining work independently', () => {
  const snapshot = fulfilledDossier();
  const summary = dossierServiceSummary({
    ...snapshot,
    commitment: {
      ...snapshot.commitment,
      obligations: [
        snapshot.commitment.obligations[0],
        obligation({ id: 'waived-demo', state: 'adjusted', ordinal: 2 }),
        obligation({ id: 'pending-demo', ordinal: 3 }),
        obligation({ id: 'claimed-demo', state: 'fulfilled', ordinal: 4 })
      ]
    }
  });
  assert.equal(summary.total, 4);
  assert.equal(summary.fulfilled, 1);
  assert.equal(summary.adjusted, 1);
  assert.equal(summary.remaining, 2);
  assert.deepEqual(
    summary.rows.map((row) => row.status),
    ['fulfilled', 'adjusted', 'unavailable', 'unverified']
  );
});
