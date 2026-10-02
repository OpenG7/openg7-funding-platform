import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSponsorshipProgress,
  getSponsorshipProgress
} from '../dist/apps/funding-api/src/sponsorship-progress.service.js';

const source = (record = {}, rest = {}) => ({
  record: {
    contributionId: '10000000-0000-4000-8000-000000000401',
    publicReference: 'DEMO-401',
    amount: 500,
    currency: 'CAD',
    paymentStatus: 'paid',
    refundStatus: 'not_requested',
    reviewStatus: 'pending_review',
    feedStatus: 'not_planned',
    detailsSubmittedAt: '2026-09-01',
    hasCompanyName: true,
    hasContactEmail: true,
    ...record
  },
  media: [{ kind: 'supporting_image', reviewStatus: 'approved' }],
  consent: true,
  version: 'v1',
  ...rest
});
const invoice = {
  id: 'invoice',
  number: 'FAC-401',
  kind: 'invoice',
  amountMinor: 50000,
  currency: 'CAD',
  issuedAt: '2026-09-01'
};
const facts = (rest = {}) => ({
  websiteVisible: false,
  websiteHeld: true,
  websiteVersion: 'v1',
  companyName: 'Demo',
  amountMinor: 50000,
  refundId: null,
  refundAmountMinor: null,
  refundError: false,
  requiresInvoice: true,
  documents: [invoice],
  publications: [],
  refunds: [],
  charges: [],
  failedEmails: [],
  failedStripeEvents: [],
  ...rest
});
const step = (dossier, id) => dossier.milestones.find((s) => s.id === id);

test('identity distinguishes missing contact details from sponsor submission and remains independent of review', () => {
  for (const detailsSubmittedAt of [null, '2026-09-01']) {
    for (const [hasCompanyName, hasContactEmail] of [
      [false, true],
      [true, false],
      [false, false],
      [true, true]
    ]) {
      const result = buildSponsorshipProgress(
        source({ detailsSubmittedAt, hasCompanyName, hasContactEmail }),
        facts()
      );
      const completeCoordinates = hasCompanyName && hasContactEmail;
      const complete = completeCoordinates && Boolean(detailsSubmittedAt);
      assert.equal(
        step(result, 'identity').reason,
        complete
          ? 'identity_complete'
          : completeCoordinates
            ? 'identity_submission_pending'
            : 'identity_missing'
      );
      assert.equal(
        step(result, 'identity').state,
        complete ? 'complete' : completeCoordinates ? 'pending' : 'blocked'
      );
      assert.equal(
        result.next.reason,
        complete ? 'review_pending' : step(result, 'identity').reason
      );
      assert.equal(result.next.tab, complete ? 'overview' : 'identity');
      assert.equal(result.reviewStatus, 'pending_review');
      assert.equal(result.feedStatus, 'not_planned');
    }
  }
  const approved = buildSponsorshipProgress(
    source({ detailsSubmittedAt: null, reviewStatus: 'approved' }),
    facts()
  );
  assert.equal(
    step(approved, 'identity').reason,
    'identity_submission_pending'
  );
  assert.equal(step(approved, 'identity').state, 'pending');
});

test('disputed payment blocks new publication; non-Stripe sources do not request a Stripe invoice', () => {
  const disputed = buildSponsorshipProgress(
    source({ paymentStatus: 'disputed', reviewStatus: 'approved' }),
    facts()
  );
  assert.equal(step(disputed, 'publication').state, 'blocked');
  assert.equal(disputed.next.reason, 'payment_disputed');
  const external = buildSponsorshipProgress(
    source(),
    facts({ requiresInvoice: false, documents: [] })
  );
  assert.equal(step(external, 'billing').state, 'not_required');
});
const publication = (channel, rest = {}) => ({
  id: channel,
  channel,
  target: 'openg7',
  status: 'draft',
  batchStatus: null,
  slotStatus: null,
  deliveryStatus: null,
  deliveryMode: null,
  scheduledAt: null,
  publishedAt: null,
  ...rest
});

test('invoice issued before review remains complete; payment and invoice do not approve or publish', () => {
  const result = buildSponsorshipProgress(source(), facts());
  assert.equal(step(result, 'billing').state, 'complete');
  assert.equal(step(result, 'review').state, 'pending');
  assert.equal(step(result, 'publication').state, 'blocked');
  assert.equal(result.next.reason, 'review_pending');
  assert.equal(result.publicEligible, false);
  assert.match(result.next.adminUrl, /sponsorshipId=.*&tab=overview$/);
});

test('approved review, consent, media eligibility and publication stay independent', () => {
  const approved = source({ reviewStatus: 'approved' });
  assert.equal(
    buildSponsorshipProgress(approved, facts()).publicEligible,
    true
  );
  const result = buildSponsorshipProgress(
    { ...approved, consent: false },
    facts({
      publications: [
        publication('facebook', { status: 'published' }),
        publication('linkedin', { status: 'published' })
      ]
    })
  );
  assert.equal(result.publicEligible, false);
  assert.equal(
    step(result, 'publication').state,
    'blocked',
    'social history remains, but withdrawn website visibility leaves recognition incomplete'
  );
  assert.equal(
    buildSponsorshipProgress(source({ reviewStatus: 'rejected' }), facts())
      .refund.state,
    'not_required'
  );
});

test('duplicate refund facts and cumulative charge snapshots never double count partial refunds', () => {
  const a = { id: 're_a', amount: 12000, currency: 'cad' },
    b = { id: 're_b', amount: 8000, currency: 'CAD' };
  const result = buildSponsorshipProgress(
    source({ refundStatus: 'completed' }),
    facts({
      refundId: 're_b',
      refundAmountMinor: 8000,
      refunds: [a, a, b],
      charges: [
        { id: 'ch_1', amount: 12000, currency: 'cad' },
        { id: 'ch_1', amount: 20000, currency: 'cad' }
      ]
    })
  );
  assert.equal(result.refund.confirmedAmountMinor, 20000);
  assert.equal(result.refund.state, 'partial');
  assert.equal(result.refund.creditMissing, true);
  assert.equal(step(result, 'billing').reason, 'credit_missing');
  assert.equal(result.next.tab, 'billing');
});

test('a credit note issued for a pending refund is not a confirmed payment fact', () => {
  const result = buildSponsorshipProgress(
    source({ refundStatus: 'processing' }),
    facts({
      documents: [
        invoice,
        { ...invoice, kind: 'credit_note', refundId: 're_pending' }
      ]
    })
  );
  assert.equal(result.refund.confirmedAmountMinor, 0);
  assert.equal(result.refund.state, 'pending');
  assert.equal(result.next.tab, 'refund');
});

test('a missing credit note is detected by refund ID even if other credits cover the amount', () => {
  const result = buildSponsorshipProgress(
    source(),
    facts({
      refunds: [{ id: 're_missing', amount: 1000, currency: 'cad' }],
      documents: [
        invoice,
        { ...invoice, kind: 'credit_note', refundId: 're_unrelated' }
      ]
    })
  );
  assert.equal(result.refund.creditMissing, true);
});

test('refund failure preserves earlier confirmed amounts and never becomes a completed refund', () => {
  const result = buildSponsorshipProgress(
    source({ refundStatus: 'failed' }),
    facts({
      refundError: true,
      refunds: [{ id: 're_a', amount: 12000, currency: 'cad' }]
    })
  );
  assert.equal(result.refund.confirmedAmountMinor, 12000);
  assert.equal(result.refund.state, 'error');
  assert.equal(result.next.reason, 'refund_check');
});

test('publication cancellation and delivery failures override a merely approved draft', () => {
  for (const rest of [
    { status: 'cancelled' },
    { batchStatus: 'cancelled' },
    { slotStatus: 'cancelled' }
  ]) {
    const result = buildSponsorshipProgress(
      source({ reviewStatus: 'approved' }),
      facts({ publications: [publication('facebook', rest)] })
    );
    assert.equal(step(result, 'publication').state, 'cancelled');
  }
  const result = buildSponsorshipProgress(
    source({ reviewStatus: 'approved' }),
    facts({
      publications: [
        publication('facebook', {
          status: 'approved',
          deliveryStatus: 'failed'
        })
      ]
    })
  );
  assert.equal(step(result, 'publication').state, 'error');
});

test('one published social channel does not fulfil both promised channels', () => {
  const result = buildSponsorshipProgress(
    source({ reviewStatus: 'approved' }),
    facts({ publications: [publication('facebook', { status: 'published' })] })
  );
  assert.equal(step(result, 'publication').state, 'partial');
});

test('automatic delivery states distinguish authorization, simulation, uncertainty and actual publication', () => {
  for (const [deliveryStatus, deliveryMode, expected] of [
    ['draft', 'live', 'pending'],
    ['approved', 'live', 'pending'],
    ['publishing', 'live', 'pending'],
    ['published', 'mock', 'pending'],
    ['blocked', 'live', 'blocked'],
    ['uncertain', 'live', 'error'],
    ['rejected', 'live', 'cancelled'],
    ['cancelled', 'live', 'cancelled'],
    ['published', 'live', 'partial']
  ]) {
    const result = buildSponsorshipProgress(
      source({ reviewStatus: 'approved' }),
      facts({
        publications: ['facebook', 'linkedin'].map((channel) =>
          publication(channel, {
            deliveryId: channel,
            deliveryStatus,
            deliveryMode
          })
        )
      })
    );
    assert.equal(
      step(result, 'publication').state,
      expected,
      `${deliveryStatus}/${deliveryMode}`
    );
  }
  const simulated = buildSponsorshipProgress(
    source({ reviewStatus: 'approved' }),
    facts({
      publications: ['facebook', 'linkedin'].map((channel) =>
        publication(channel, {
          status: 'published',
          deliveryStatus: 'published',
          deliveryMode: 'mock'
        })
      )
    })
  );
  assert.notEqual(step(simulated, 'publication').state, 'complete');
});

test('publication blockers explain the missing prerequisites without approving a source', () => {
  const result = buildSponsorshipProgress(
    source(
      {
        paymentStatus: 'disputed',
        refundStatus: 'processing',
        hasCompanyName: false,
        feedStatus: 'hidden'
      },
      { consent: false, media: [] }
    ),
    facts()
  );
  assert.deepEqual(result.publicationBlockers, [
    'consent',
    'review',
    'media',
    'payment',
    'refund',
    'hidden'
  ]);
  assert.deepEqual(result.website.blockers, [
    'consent',
    'review',
    'identity',
    'media',
    'payment',
    'refund'
  ]);
  assert.equal(result.website.canPublish, false);
  assert.equal(result.reviewStatus, 'pending_review');
  assert.equal(result.feedStatus, 'hidden');
});

test('website identity and hidden social feed remain independent prerequisites', () => {
  const missingIdentity = buildSponsorshipProgress(
    source({ reviewStatus: 'approved', hasCompanyName: false }),
    facts()
  );
  assert.deepEqual(missingIdentity.website.blockers, ['identity']);
  assert.equal(missingIdentity.website.canPublish, false);
  assert.deepEqual(missingIdentity.publicationBlockers, []);

  const hidden = buildSponsorshipProgress(
    source({ reviewStatus: 'approved', feedStatus: 'hidden' }),
    facts()
  );
  assert.deepEqual(hidden.website.blockers, []);
  assert.equal(hidden.website.canPublish, true);
  assert.deepEqual(hidden.publicationBlockers, ['hidden']);
  assert.equal(step(hidden, 'publication').state, 'blocked');
});

test('recognition is blocked by an ongoing or full refund, while partial and failed workflows preserve confirmed facts', () => {
  for (const [workflow, confirmed, blocked, state] of [
    ['not_requested', 0, false, 'not_required'],
    ['requested', 0, true, 'pending'],
    ['processing', 0, true, 'pending'],
    ['completed', 12000, false, 'partial'],
    ['completed', 50000, true, 'complete'],
    ['failed', 0, false, 'error'],
    ['failed', 12000, false, 'error'],
    ['not_requested', 50000, true, 'complete']
  ]) {
    const result = buildSponsorshipProgress(
      source({ reviewStatus: 'approved', refundStatus: workflow }),
      facts({
        refunds: confirmed
          ? [{ id: 're_confirmed', amount: confirmed, currency: 'CAD' }]
          : []
      })
    );
    assert.deepEqual(result.publicationBlockers, blocked ? ['refund'] : []);
    assert.deepEqual(result.website.blockers, blocked ? ['refund'] : []);
    assert.equal(result.website.canPublish, !blocked);
    assert.equal(result.refund.confirmedAmountMinor, confirmed);
    assert.equal(result.refund.state, state);
    if (['requested', 'processing', 'failed'].includes(workflow))
      assert.equal(result.next.reason, 'refund_check');
  }
});

test('non-CAD dossiers follow their explicit social publications rather than CAD thresholds', () => {
  const result = buildSponsorshipProgress(
    source({ currency: 'USD', reviewStatus: 'approved' }),
    facts({
      publications: [
        publication('facebook', {
          deliveryStatus: 'published',
          deliveryMode: 'live'
        })
      ]
    })
  );
  assert.equal(step(result, 'publication').state, 'complete');
});

test('email and Stripe failures remain actionable independently of completed milestones', () => {
  const stripe = buildSponsorshipProgress(
    source(),
    facts({
      failedStripeEvents: [
        { id: 'evt_failed', type: 'payment_intent.succeeded' }
      ]
    })
  );
  assert.equal(stripe.next.reason, 'stripe_failed');
  const email = buildSponsorshipProgress(
    source(),
    facts({ failedEmails: [{ id: 'email', template: 'invoice' }] })
  );
  assert.equal(email.next.reason, 'email_failed');
  assert.equal(step(email, 'billing').state, 'complete');
});

test('unconfirmed payments and currency inconsistencies never get silently confirmed', async () => {
  const result = buildSponsorshipProgress(
    source({ paymentStatus: 'pending' }),
    facts({ documents: [] })
  );
  assert.equal(step(result, 'payment').state, 'pending');
  assert.equal(result.next.reason, 'payment_unconfirmed');
  assert.throws(() =>
    buildSponsorshipProgress(
      source(),
      facts({ refunds: [{ id: 're_bad', amount: 5.5, currency: 'CAD' }] })
    )
  );
  assert.throws(() =>
    buildSponsorshipProgress(
      source(),
      facts({ refunds: [{ id: 're_bad', amount: 500, currency: 'USD' }] })
    )
  );
  assert.equal((await getSponsorshipProgress(null)).status, 'unavailable');
});

test('all CAD tiers require actual website visibility and every promised live channel', () => {
  for (const amount of [50, 100, 249.99, 250, 333.33, 499.99, 500, 750]) {
    const channels =
      amount >= 500
        ? ['facebook', 'linkedin']
        : amount >= 250
          ? ['facebook']
          : [];
    for (const websiteVisible of [false, true]) {
      const result = buildSponsorshipProgress(
        source({
          amount,
          reviewStatus: 'approved',
          feedStatus: websiteVisible ? 'planned' : 'published'
        }),
        facts({
          amountMinor: Math.round(amount * 100),
          websiteVisible,
          websiteHeld: !websiteVisible,
          publications: channels.map((channel) =>
            publication(channel, {
              deliveryStatus: 'published',
              deliveryMode: 'live'
            })
          )
        })
      );
      assert.equal(
        step(result, 'publication').state === 'complete',
        websiteVisible,
        String(amount)
      );
      assert.deepEqual(result.publicationCompletion, {
        done: channels.length + Number(websiteVisible),
        total: channels.length + 1
      });
      assert.equal(result.website.visible, websiteVisible);
    }
  }
});

test('visible website is partial until both live social promises are met; duplicate and failed attempts do not overcount', () => {
  const rows = [
    publication('facebook', { status: 'published' }),
    publication('facebook', { deliveryStatus: 'failed' }),
    publication('linkedin', {
      deliveryStatus: 'published',
      deliveryMode: 'mock'
    })
  ];
  const partial = buildSponsorshipProgress(
    source({ reviewStatus: 'approved' }),
    facts({ websiteVisible: true, publications: rows })
  );
  assert.deepEqual(partial.publicationCompletion, { done: 2, total: 3 });
  assert.notEqual(step(partial, 'publication').state, 'complete');
  const complete = buildSponsorshipProgress(
    source({ reviewStatus: 'approved' }),
    facts({
      websiteVisible: true,
      publications: [
        ...rows,
        publication('linkedin', {
          deliveryStatus: 'published',
          deliveryMode: 'live'
        })
      ]
    })
  );
  assert.equal(step(complete, 'publication').state, 'complete');
  assert.deepEqual(complete.publicationCompletion, { done: 3, total: 3 });
});
