import assert from 'node:assert/strict';
import test from 'node:test';

import { projectSponsorOverview } from '../dist/apps/funding-web/src/app/features/funding/models/admin-sponsor-overview.projection.js';

const milestone = (id, state = 'complete', reason = `${id}_complete`) => ({
  id,
  state,
  reason,
  tab:
    id === 'identity' || id === 'media' || id === 'publication'
      ? id
      : id === 'billing'
        ? 'billing'
        : 'overview'
});

const dossier = (overrides = {}) => ({
  contributionId: 'synthetic-dossier',
  version: 'version-1',
  paymentStatus: 'paid',
  reviewStatus: 'approved',
  publicConsent: true,
  website: { visible: false, held: false, blockers: [] },
  publicationBlockers: [],
  milestones: [
    'payment',
    'identity',
    'media',
    'review',
    'billing',
    'publication'
  ].map((id) => milestone(id)),
  next: {
    reason: 'complete',
    tab: 'overview',
    adminUrl: '/admin/fundraiser/sponsors?sponsorshipId=synthetic-dossier'
  },
  commitment: { state: 'active', offer: { benefits: [] }, obligations: [] },
  publications: [],
  fulfilmentEvidence: [],
  qualifiedFulfilmentEvidenceIds: [],
  publicationWorkflow: {
    state: 'complete',
    reason: 'publication_done',
    responsibility: 'none',
    obligations: []
  },
  failedEmails: [],
  failedStripeEvents: [],
  refund: {
    workflow: 'none',
    state: 'not_required',
    hasError: false,
    creditMissing: false
  },
  ...overrides
});

const input = (snapshot = dossier(), overrides = {}) => ({
  dossier: snapshot,
  media: null,
  canManage: true,
  canUseOwnerActions: true,
  ...overrides
});

test('unavailable sources remain unknown instead of zero or complete', () => {
  const view = projectSponsorOverview(input(null));
  assert.deepEqual(view.stats, {
    steps: null,
    services: null,
    blockers: null,
    visibility: 'unknown',
    media: null,
    proposals: null
  });
  assert.equal(view.priority.state, 'unknown');
  assert.equal(view.priority.destination, null);
  assert.equal(view.domains.length, 5);
  assert.ok(view.domains.every((item) => item.stateKey.endsWith('.unknown')));
});

test('known empty collections are zero and finished or unnecessary steps are settled', () => {
  const snapshot = dossier({
    milestones: [
      milestone('payment'),
      milestone('identity', 'not_required'),
      milestone('media', 'cancelled', 'media_review')
    ]
  });
  const view = projectSponsorOverview(input(snapshot, { media: [] }));
  assert.deepEqual(view.stats.steps, { done: 2, total: 3 });
  assert.deepEqual(view.stats.services, { done: 0, total: 0 });
  assert.deepEqual(view.stats.media, { done: 0, total: 0 });
  assert.equal(view.stats.proposals, null);
  assert.equal(projectSponsorOverview(input(dossier())).stats.blockers, 0);
});

test('unknown or unconfirmed agreements never expose presumed service totals', () => {
  for (const commitment of [
    undefined,
    null,
    { state: 'needs_confirmation', offer: {}, obligations: [] },
    { state: 'active', offer: null, obligations: [] }
  ])
    assert.equal(
      projectSponsorOverview(input(dossier({ commitment }))).stats.services,
      null
    );
});

test('delivered services require exact qualified evidence; waivers and historic claims stay separate', () => {
  const obligations = [
    {
      id: 'proof-bound',
      state: 'fulfilled',
      channel: 'facebook',
      target: 'openg7',
      fulfilmentEvidenceId: 'proof-1'
    },
    {
      id: 'unverified',
      state: 'fulfilled',
      channel: 'facebook',
      target: 'openg7',
      fulfilmentEvidenceId: 'proof-2'
    },
    { id: 'waived', state: 'adjusted' }
  ];
  const snapshot = dossier({
    commitment: { state: 'active', offer: { benefits: [] }, obligations },
    fulfilmentEvidence: [
      {
        id: 'proof-1',
        obligationId: 'proof-bound',
        channel: 'facebook',
        target: 'openg7'
      }
    ],
    qualifiedFulfilmentEvidenceIds: ['proof-1'],
    publicationCompletion: { done: 99, total: 99 }
  });
  assert.deepEqual(projectSponsorOverview(input(snapshot)).stats.services, {
    done: 1,
    total: 3
  });
  snapshot.qualifiedFulfilmentEvidenceIds = [];
  assert.deepEqual(projectSponsorOverview(input(snapshot)).stats.services, {
    done: 0,
    total: 3
  });
});

test('the same missing prerequisites across panels count once, without their aggregate publication block', () => {
  const snapshot = dossier({
    milestones: [
      milestone('identity', 'blocked', 'identity_missing'),
      milestone('media', 'pending', 'media_review'),
      milestone('review', 'pending', 'review_pending'),
      milestone('publication', 'blocked', 'publication_blocked')
    ],
    publicationBlockers: ['identity', 'media', 'review', 'media'],
    website: {
      visible: false,
      held: false,
      blockers: ['identity', 'media', 'review']
    },
    publicationWorkflow: {
      state: 'blocked',
      reason: 'publication_blocked',
      responsibility: 'admin',
      obligations: [
        {
          obligationId: 'promise-1',
          state: 'blocked',
          reason: 'publication_blocked'
        }
      ]
    }
  });
  assert.equal(projectSponsorOverview(input(snapshot)).stats.blockers, 3);
  snapshot.publicationBlockers.push('consent');
  assert.equal(projectSponsorOverview(input(snapshot)).stats.blockers, 4);
});

test('different incidents within one finance domain remain distinct and duplicate ids consolidate', () => {
  const snapshot = dossier({
    milestones: [milestone('billing', 'blocked', 'credit_missing')],
    failedEmails: [
      { id: 'email-1' },
      { id: 'email-1' },
      { id: 'email-2', status: 'uncertain' }
    ],
    failedStripeEvents: [
      { id: 'event-1' },
      { id: 'event-1' },
      { id: 'event-2' }
    ],
    refund: {
      workflow: 'requested',
      state: 'pending',
      hasError: true,
      creditMissing: true
    },
    publicationBlockers: ['refund']
  });
  assert.equal(projectSponsorOverview(input(snapshot)).stats.blockers, 6);
});

test('failed deliveries count as distinct incidents rather than one family or an extra aggregate', () => {
  const snapshot = dossier({
    milestones: [milestone('publication', 'error', 'publication_failed')],
    publicationWorkflow: {
      state: 'error',
      reason: 'publication_failed',
      responsibility: 'admin',
      obligations: [
        {
          obligationId: 'promise-1',
          deliveryId: 'delivery-1',
          state: 'error',
          reason: 'publication_failed'
        },
        {
          obligationId: 'promise-2',
          deliveryId: 'delivery-1',
          state: 'error',
          reason: 'publication_failed'
        },
        {
          obligationId: 'promise-3',
          deliveryId: 'delivery-2',
          state: 'error',
          reason: 'publication_failed'
        }
      ]
    }
  });
  assert.equal(projectSponsorOverview(input(snapshot)).stats.blockers, 2);
  assert.equal(
    projectSponsorOverview(
      input(
        dossier({
          milestones: [
            milestone('publication', 'blocked', 'publication_blocked')
          ],
          publicationWorkflow: undefined
        })
      )
    ).stats.blockers,
    null
  );
});

test('partial older blocker sources remain unknown without hiding other available statistics', () => {
  for (const overrides of [
    { publicationBlockers: undefined },
    { publicationWorkflow: undefined },
    { website: undefined },
    { website: { visible: true, held: false } }
  ]) {
    const view = projectSponsorOverview(
      input(dossier(overrides), { media: [] })
    );
    assert.equal(view.stats.blockers, null);
    assert.deepEqual(view.stats.steps, { done: 6, total: 6 });
    assert.deepEqual(view.stats.services, { done: 0, total: 0 });
    assert.deepEqual(view.stats.media, { done: 0, total: 0 });
    assert.equal(view.priority.state, 'unknown');
    if (overrides.website?.visible === true)
      assert.equal(view.stats.visibility, 'visible');
  }
});

test('public visibility uses its actual fact independently of payment, review and published claims', () => {
  for (const [website, expected] of [
    [undefined, 'unknown'],
    [{ visible: false, held: false, blockers: [] }, 'hidden'],
    [{ visible: false, held: true, blockers: [] }, 'held'],
    [{ visible: true, held: false, blockers: [] }, 'visible']
  ])
    assert.equal(
      projectSponsorOverview(
        input(dossier({ website, feedStatus: 'published' }))
      ).stats.visibility,
      expected
    );
});

test('media totals use recorded decisions for distinct assets of the selected dossier', () => {
  const asset = (id, reviewStatus, contributionId = 'synthetic-dossier') => ({
    id,
    reviewStatus,
    contributionId
  });
  const media = [
    asset('approved', 'approved'),
    asset('approved', 'approved'),
    asset('pending', 'pending_review'),
    asset('rejected', 'rejected'),
    asset('foreign', 'approved', 'another-dossier')
  ];
  assert.deepEqual(
    projectSponsorOverview(input(dossier(), { media })).stats.media,
    { done: 1, total: 3 }
  );
});

test('loaded media remain known when the separate progress source is unavailable', () => {
  const view = projectSponsorOverview(
    input(null, {
      media: [
        {
          id: 'known-media',
          contributionId: 'synthetic-dossier',
          reviewStatus: 'approved'
        }
      ]
    })
  );
  assert.deepEqual(view.stats.media, { done: 1, total: 1 });
  assert.equal(view.stats.steps, null);
  assert.equal(view.priority.state, 'unknown');
});

test('shared feed incidents replace the aggregate block but different destination incidents stay distinct', () => {
  const snapshot = dossier({
    milestones: [milestone('publication', 'blocked', 'publication_blocked')],
    publicationWorkflow: {
      state: 'blocked',
      reason: 'publication_paused',
      responsibility: 'admin',
      obligations: [
        {
          obligationId: 'promise-1',
          deliveryId: 'delivery-1',
          channel: 'facebook',
          target: 'openg7',
          state: 'blocked',
          reason: 'publication_paused'
        },
        {
          obligationId: 'promise-2',
          deliveryId: 'delivery-2',
          channel: 'facebook',
          target: 'openg7',
          state: 'blocked',
          reason: 'publication_paused'
        },
        {
          obligationId: 'promise-3',
          deliveryId: 'delivery-3',
          channel: 'linkedin',
          target: 'openg7',
          state: 'blocked',
          reason: 'publication_worker_disabled'
        }
      ]
    }
  });
  assert.equal(projectSponsorOverview(input(snapshot)).stats.blockers, 2);
});

test('incoherent complete hints do not hide current incidents or unresolved milestones', () => {
  for (const overrides of [
    { failedEmails: [{ id: 'current-email-incident' }] },
    {
      milestones: [
        milestone('identity', 'pending', 'identity_submission_pending')
      ]
    },
    {
      website: { visible: false, held: false, blockers: ['media'] },
      publicationWorkflow: {
        state: 'blocked',
        responsibility: 'admin',
        reason: 'publication_blocked',
        obligations: []
      }
    },
    { milestones: [] }
  ]) {
    const view = projectSponsorOverview(input(dossier(overrides)));
    assert.equal(view.priority.state, 'unknown');
    assert.equal(view.priority.destination, null);
  }
});

test('the server chooses one priority and platform waiting does not solicit an administrative action', () => {
  const snapshot = dossier({
    next: { reason: 'identity_missing', tab: 'identity' }
  });
  assert.deepEqual(projectSponsorOverview(input(snapshot)).priority, {
    state: 'action',
    labelKey: 'admin.dossier.overviewDashboard.actions.identity_missing',
    actionKey: 'admin.dossier.overviewDashboard.open.identity',
    destination: { kind: 'tab', tab: 'identity' }
  });
  snapshot.next = { reason: 'publication_scheduled', tab: 'publication' };
  snapshot.publicationWorkflow = {
    state: 'waiting',
    responsibility: 'platform',
    reason: 'publication_scheduled',
    obligations: []
  };
  const view = projectSponsorOverview(input(snapshot));
  assert.equal(view.priority.state, 'waiting');
  assert.equal(view.priority.destination, null);
  assert.equal(view.stats.blockers, 0);
});

test('the sponsor submission prerequisite remains waiting without suggesting an admin can submit it', () => {
  const view = projectSponsorOverview(
    input(
      dossier({
        next: { reason: 'identity_submission_pending', tab: 'identity' }
      })
    )
  );
  assert.equal(view.priority.state, 'waiting');
  assert.equal(
    view.priority.labelKey,
    'admin.dossier.overviewDashboard.priority.sponsorWaiting'
  );
  assert.equal(view.priority.destination, null);
});

test('review, agreement, consent and finance priorities navigate to their responsible existing section', () => {
  for (const [reason, nextTab, destination] of [
    [
      'review_pending',
      'overview',
      { kind: 'tab', tab: 'publication', section: 'review' }
    ],
    [
      'review_rejected',
      'overview',
      { kind: 'tab', tab: 'publication', section: 'review' }
    ],
    [
      'commitment_needs_confirmation',
      'publication',
      { kind: 'tab', tab: 'publication', section: 'agreement' }
    ],
    ['consent_missing', 'publication', { kind: 'tab', tab: 'identity' }],
    [
      'stripe_failed',
      'overview',
      { kind: 'tab', tab: 'billing', section: 'stripe' }
    ],
    ['refund_check', 'refund', { kind: 'tab', tab: 'billing' }]
  ])
    assert.deepEqual(
      projectSponsorOverview(input(dossier({ next: { reason, tab: nextTab } })))
        .priority.destination,
      destination
    );
});

test('readers and staff without owner rights are not asked to perform forbidden work', () => {
  const snapshot = dossier({
    next: { reason: 'identity_missing', tab: 'identity' }
  });
  assert.equal(
    projectSponsorOverview(input(snapshot, { canManage: false })).priority
      .state,
    'readonly'
  );
  for (const reason of [
    'refund_check',
    'credit_missing',
    'invoice_missing',
    'stripe_failed',
    'email_failed',
    'email_uncertain'
  ]) {
    snapshot.next = { reason, tab: 'billing' };
    const result = projectSponsorOverview(
      input(snapshot, { canUseOwnerActions: false })
    );
    assert.equal(result.priority.state, 'readonly');
    assert.equal(result.priority.destination, null);
  }
});

test('a completed dossier has a discreet confirmation and five navigable domains without another priority', () => {
  const snapshot = dossier();
  const before = structuredClone(snapshot);
  const view = projectSponsorOverview(input(snapshot, { canManage: false }));
  assert.equal(view.priority.state, 'complete');
  assert.equal(view.priority.destination, null);
  assert.deepEqual(view.stats.steps, { done: 6, total: 6 });
  assert.equal(view.stats.blockers, 0);
  assert.deepEqual(
    view.domains.map(({ id, destination }) => [id, destination]),
    [
      ['identity', { kind: 'tab', tab: 'identity' }],
      ['media', { kind: 'tab', tab: 'media' }],
      ['publication', { kind: 'tab', tab: 'publication' }],
      ['review', { kind: 'tab', tab: 'publication', section: 'review' }],
      ['finance', { kind: 'tab', tab: 'billing' }]
    ]
  );
  assert.deepEqual(snapshot, before);
});

test('completed passages do not turn an intentional mask or confirmed refund into new publication work', () => {
  for (const reason of ['hidden', 'refund']) {
    const snapshot = dossier({
      feedStatus: 'hidden',
      publicationBlockers:
        reason === 'hidden' ? ['hidden'] : ['payment', 'refund'],
      website: {
        visible: false,
        held: true,
        blockers: reason === 'hidden' ? [] : ['payment', 'refund']
      },
      ...(reason === 'refund'
        ? {
            paymentStatus: 'refunded',
            refund: {
              workflow: 'refunded',
              state: 'complete',
              hasError: false,
              creditMissing: false
            }
          }
        : {})
    });
    const view = projectSponsorOverview(input(snapshot));
    assert.equal(view.stats.blockers, 0);
    assert.equal(view.priority.state, 'complete');
    assert.equal(view.stats.visibility, 'held');
    snapshot.website.held = false;
    assert.equal(
      projectSponsorOverview(input(snapshot)).stats.visibility,
      'hidden'
    );
    snapshot.failedEmails = [{ id: 'current-incident' }];
    assert.equal(projectSponsorOverview(input(snapshot)).stats.blockers, 1);
    assert.equal(
      projectSponsorOverview(input(snapshot)).priority.state,
      'unknown'
    );
  }
});
