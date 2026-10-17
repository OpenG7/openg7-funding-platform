import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPaymentJourney,
  getPaymentJourney
} from '../dist/apps/funding-api/src/admin-payment-journey.service.js';
import { createAdminContributionsHttpHandler } from '../dist/apps/funding-api/src/admin-contributions.http.js';

const id = '00000000-0000-4000-8000-00000000000a';
const source = (changes = {}) => ({
  contributionId: id,
  reference: 'DEMO-001',
  contributionType: 'personal_support',
  amountMinor: 2500,
  currency: 'CAD',
  paymentStatus: 'paid',
  ...changes
});
const dossier = (changes = {}) => ({
  contributionId: id,
  milestones: [
    {
      id: 'payment',
      state: 'complete',
      reason: 'payment_confirmed',
      tab: 'overview'
    },
    {
      id: 'billing',
      state: 'not_required',
      reason: 'invoice_not_required',
      tab: 'billing'
    },
    {
      id: 'publication',
      state: 'complete',
      reason: 'publication_done',
      tab: 'publication'
    }
  ],
  next: {
    reason: 'complete',
    tab: 'overview',
    adminUrl: '/admin/fundraiser/sponsors'
  },
  ...changes
});

test('authorized publication work waits for the platform, while independent human actions remain actionable', () => {
  const sponsor = source({ contributionType: 'sponsorship_interest' });
  for (const reason of [
    'publication_scheduled',
    'publication_publishing',
    'publication_retry_pending'
  ]) {
    const active = dossier({
      milestones: [
        {
          id: 'publication',
          state: 'partial',
          reason: 'publication_pending',
          tab: 'publication'
        }
      ],
      publicationWorkflow: {
        state: 'waiting',
        responsibility: 'platform',
        reason,
        obligations: []
      },
      next: {
        reason: 'publication_pending',
        tab: 'publication',
        adminUrl: '/admin/fundraiser/sponsors'
      }
    });
    const journey = buildPaymentJourney(sponsor, active);
    assert.equal(journey.state, 'waiting');
    assert.equal(journey.next.reason, reason);
    assert.equal(journey.next.responsibility, 'platform');
    assert.equal(journey.completed, 0);
    const needsReview = buildPaymentJourney(sponsor, {
      ...active,
      milestones: [
        ...active.milestones,
        {
          id: 'review',
          state: 'blocked',
          reason: 'review_pending',
          tab: 'overview'
        }
      ]
    });
    assert.equal(needsReview.state, 'blocked');
    assert.equal(needsReview.next.reason, 'review_pending');
  }
});

test('certain publication failure and an uncertain remote result keep separate recovery reasons', () => {
  for (const [state, reason] of [
    ['error', 'publication_failed'],
    ['uncertain', 'publication_uncertain']
  ]) {
    const journey = buildPaymentJourney(
      source({ contributionType: 'sponsorship_interest' }),
      dossier({
        milestones: [
          {
            id: 'publication',
            state: 'error',
            reason: 'publication_failed',
            tab: 'publication'
          }
        ],
        publicationWorkflow: {
          state,
          responsibility: 'admin',
          reason,
          obligations: []
        },
        next: {
          reason: 'publication_failed',
          tab: 'publication',
          adminUrl: '/admin/fundraiser/sponsors'
        }
      })
    );
    assert.equal(journey.state, 'action_required');
    assert.equal(journey.next.reason, reason);
    assert.equal(journey.next.responsibility, 'admin');
    assert.equal(journey.steps.length, 1);
  }
});

test('personal confirmed payment finishes without inventing sponsorship work, pending and disputes do not', () => {
  const complete = buildPaymentJourney(source(), null);
  assert.equal(complete.state, 'complete');
  assert.equal(complete.next, null);
  assert.equal(complete.steps.length, 1);
  assert.equal(complete.steps[0].reason, 'personal_complete');
  assert.equal(
    buildPaymentJourney(source({ paymentStatus: 'pending' }), null).state,
    'waiting'
  );
  assert.equal(
    buildPaymentJourney(source({ paymentStatus: 'disputed' }), null).state,
    'blocked'
  );
  assert.equal(
    buildPaymentJourney(source({ paymentStatus: 'refunded' }), null).steps[0]
      .reason,
    'personal_refunded'
  );
});

test('non-applicable steps are settled but a missing qualification or delivery keeps a sponsorship open', () => {
  const sponsor = source({ contributionType: 'sponsorship_interest' });
  const complete = buildPaymentJourney(sponsor, dossier());
  assert.equal(complete.state, 'complete');
  assert.equal(complete.completed, complete.total);
  assert.equal(buildPaymentJourney(sponsor, null).state, 'blocked');
  const pending = dossier({
    milestones: [
      {
        id: 'publication',
        state: 'partial',
        reason: 'publication_pending',
        tab: 'publication'
      }
    ],
    next: {
      reason: 'publication_pending',
      tab: 'publication',
      adminUrl: '/admin/fundraiser/sponsors'
    }
  });
  const journey = buildPaymentJourney(sponsor, pending);
  assert.equal(journey.state, 'action_required');
  assert.equal(journey.next.reason, 'publication_pending');
  assert.equal(journey.completed, 0);
});

test('financial recovery and unsent communications prevent a false complete message', () => {
  for (const reason of [
    'refund_check',
    'credit_missing',
    'stripe_failed',
    'email_failed'
  ]) {
    const pending = buildPaymentJourney(
      source({ contributionType: 'sponsorship_interest' }),
      dossier({
        next: { reason, tab: 'billing', adminUrl: '/admin/fundraiser/sponsors' }
      })
    );
    assert.notEqual(pending.state, 'complete');
    assert.equal(pending.next.reason, reason);
  }
  const queued = buildPaymentJourney(
    source(),
    null,
    [],
    [{ id: 'synthetic-message', status: 'queued' }]
  );
  assert.equal(queued.state, 'waiting');
  assert.equal(queued.next.reason, 'email_pending');
  const failed = buildPaymentJourney(
    source(),
    null,
    [],
    [{ id: 'synthetic-message', status: 'failed' }]
  );
  assert.equal(failed.state, 'action_required');
  assert.equal(failed.next.reason, 'email_failed');
  assert.equal(
    buildPaymentJourney(
      source(),
      null,
      [],
      [{ id: 'synthetic-message', status: 'sent' }]
    ).state,
    'complete'
  );
});

test('uncertain delivery blocks personal and otherwise completed sponsorship journeys until reconciliation', () => {
  for (const d of [
    null,
    dossier({
      next: {
        reason: 'email_uncertain',
        tab: 'billing',
        adminUrl: '/admin/fundraiser/sponsors'
      }
    })
  ]) {
    const payment = source({
      contributionType: d ? 'sponsorship_interest' : 'personal_support'
    });
    const message = { id: 'synthetic-uncertain', status: 'uncertain' };
    const before = JSON.stringify([payment, d, message]);
    const result = buildPaymentJourney(payment, d, [], [message]);
    assert.equal(result.state, 'action_required');
    assert.equal(result.next.reason, 'email_uncertain');
    assert.equal(
      result.next.adminUrl,
      '/admin/fundraiser/email-queue?messageId=synthetic-uncertain'
    );
    assert.equal(result.next.target, 'email-delivery-evidence');
    assert.ok(result.completed < result.total);
    assert.equal(
      result.steps.filter((step) => step.reason === 'email_uncertain').length,
      1
    );
    assert.equal(
      result.steps.find((step) => step.id === 'communications').state,
      'error'
    );
    assert.equal(JSON.stringify([payment, d, message]), before);
  }
  const uncertain = { id: 'synthetic-uncertain', status: 'uncertain' };
  assert.equal(
    buildPaymentJourney(source(), null, [], [uncertain]).state,
    'action_required'
  );
  assert.equal(
    buildPaymentJourney(
      source(),
      null,
      [],
      [{ ...uncertain, status: 'failed' }]
    ).next.reason,
    'email_failed'
  );
  assert.equal(
    buildPaymentJourney(source(), null, [], [{ ...uncertain, status: 'sent' }])
      .state,
    'complete'
  );
});

test('failed and uncertain communications take priority over queued and sending messages regardless of order', () => {
  const queued = { id: 'queued', status: 'queued' };
  const sending = { id: 'sending', status: 'sending' };
  const sent = { id: 'sent', status: 'sent' };
  const uncertain = { id: 'uncertain', status: 'uncertain' };
  const failed = { id: 'failed', status: 'failed' };
  for (const messages of [
    [queued, sent, uncertain, sending],
    [uncertain, sending, queued],
    [sending, uncertain, queued]
  ]) {
    const result = buildPaymentJourney(source(), null, [], messages);
    assert.equal(result.next.reason, 'email_uncertain');
    assert.equal(
      new URL(result.next.adminUrl, 'https://example.invalid').searchParams.get(
        'messageId'
      ),
      uncertain.id
    );
  }
  for (const messages of [
    [uncertain, queued, failed],
    [failed, uncertain, sending]
  ]) {
    const result = buildPaymentJourney(source(), null, [], messages);
    assert.equal(result.next.reason, 'email_failed');
    assert.equal(
      new URL(result.next.adminUrl, 'https://example.invalid').searchParams.get(
        'messageId'
      ),
      failed.id
    );
  }
  for (const status of ['queued', 'sending']) {
    const result = buildPaymentJourney(
      source(),
      null,
      [],
      [{ id: status, status }]
    );
    assert.equal(result.state, 'waiting');
    assert.equal(result.next.reason, 'email_pending');
  }
});

test('only confirmed sent communications settle the step, including when an unknown future state is encountered', () => {
  assert.equal(
    buildPaymentJourney(source(), null, [], [{ id: 'sent', status: 'sent' }])
      .state,
    'complete'
  );
  const unknown = buildPaymentJourney(
    source(),
    null,
    [],
    [{ id: 'unknown', status: 'future-unconfirmed' }]
  );
  assert.notEqual(unknown.state, 'complete');
  assert.equal(unknown.next.reason, 'email_uncertain');
});

test('only incidents attached to this payment block completion', () => {
  const incident = {
    id: 'synthetic-incident',
    type: 'publication_reliability_incident',
    severity: 'today',
    contributionId: id,
    adminUrl: '/admin/fundraiser/publications/automation'
  };
  assert.equal(
    buildPaymentJourney(source(), null, [incident]).state,
    'blocked'
  );
  assert.equal(
    buildPaymentJourney(source(), null, [
      { ...incident, contributionId: 'another-id' }
    ]).state,
    'complete'
  );
  assert.equal(
    buildPaymentJourney(source(), null, [
      { ...incident, severity: 'informational' }
    ]).state,
    'complete'
  );
});

test('Stripe incidents lead to their exact inspectable work item for personal support and sponsorships', () => {
  for (const type of ['stripe_event_failed', 'stripe_event_stalled']) {
    const incident = { id: 'evt_synthetic_recovery', type };
    for (const d of [
      null,
      dossier({
        next: {
          reason: 'stripe_failed',
          tab: 'overview',
          adminUrl: '/admin/fundraiser/sponsors'
        }
      })
    ]) {
      const journey = buildPaymentJourney(
        source({
          contributionType: d ? 'sponsorship_interest' : 'personal_support'
        }),
        d,
        [],
        [],
        incident
      );
      const url = new URL(
        journey.next.adminUrl,
        'https://funding.example.test'
      );
      assert.equal(url.pathname, '/admin/fundraiser/attention');
      assert.equal(url.searchParams.get('itemId'), `${type}:${incident.id}`);
      assert.equal(journey.next.target, 'attention-items');
      assert.notEqual(journey.state, 'complete');
    }
  }
});

test('invalid monetary or mismatched dossier facts are refused and absent database never means completed', async () => {
  assert.throws(() => buildPaymentJourney(source({ amountMinor: 25.5 }), null));
  assert.throws(() =>
    buildPaymentJourney(source(), dossier({ contributionId: 'another-id' }))
  );
  assert.deepEqual(
    await getPaymentJourney(null, id, new Date('2026-10-15T12:00:00Z')),
    {
      status: 'unavailable',
      journey: null,
      generatedAt: '2026-10-15T12:00:00.000Z'
    }
  );
});

function httpFixture(denied = false, failure = false) {
  const reads = [];
  const handler = createAdminContributionsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: (_req, response) => {
      if (denied) response.status = 401;
      return !denied;
    },
    getPaymentJourney: async (value) => {
      reads.push(value);
      if (failure) throw new Error('private synthetic failure');
      return { status: 'ok', journey: buildPaymentJourney(source(), null) };
    },
    writeJson: (_req, response, status, payload) =>
      Object.assign(response, { status, payload }),
    reportFailure() {}
  });
  return {
    reads,
    async run(url, method = 'GET') {
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      const handled = await handler({ method, url, headers: {} }, response);
      return { ...response, handled };
    }
  };
}

test('payment journey HTTP authorizes before parsing and sends private no-store on denials', async () => {
  const f = httpFixture(true);
  const result = await f.run(
    '/api/admin/payment-journey?contributionId=invalid'
  );
  assert.equal(result.status, 401);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(f.reads, []);
});

test('payment journey HTTP validates a single explicit UUID and allows no writes', async () => {
  for (const query of [
    '',
    '?contributionId=invalid',
    `?contributionId=${id}&contributionId=${id}`,
    `?contributionId=${id}&token=synthetic`
  ]) {
    const f = httpFixture();
    assert.equal(
      (await f.run('/api/admin/payment-journey' + query)).status,
      400
    );
    assert.deepEqual(f.reads, []);
  }
  const f = httpFixture();
  assert.equal(
    (await f.run('/admin/payment-journey?contributionId=' + id, 'POST')).status,
    405
  );
  assert.deepEqual(f.reads, []);
  const response = await f.run(
    '/api/admin/payment-journey?contributionId=' + id.toUpperCase()
  );
  assert.equal(response.status, 200);
  assert.deepEqual(f.reads, [id]);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
});

test('an unavailable dependency returns a safe failure without any private diagnostics', async () => {
  const result = await httpFixture(false, true).run(
    '/admin/payment-journey?contributionId=' + id
  );
  assert.equal(result.status, 503);
  assert.equal(
    JSON.stringify(result).includes('private synthetic failure'),
    false
  );
});
