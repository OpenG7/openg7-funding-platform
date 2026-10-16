import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResponsibilityBalance,
  loadResponsibilityBalance
} from '../dist/apps/funding-api/src/admin-responsibility-balance.service.js';
import { sponsorshipOfferFingerprint } from '../dist/apps/funding-api/src/sponsorship-commitments/offers.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-15T12:00:00Z');
const facts = () => {
  const offer = {
    version: 'sponsorship-v2',
    amountMinor: 50000,
    currency: 'CAD',
    benefits: [
      {
        id: 'website_mention',
        channel: 'website',
        target: 'openg7',
        quantity: 1,
        requiredElements: ['company_name'],
        deadlineDays: null,
        durationDays: null
      }
    ]
  };
  return {
    journey: {
      contributionId: uuid(1),
      reference: 'SYNTHETIC-BALANCE',
      contributionType: 'sponsorship_interest',
      amountMinor: 50000,
      currency: 'CAD',
      paymentStatus: 'paid',
      state: 'complete',
      completed: 2,
      total: 2,
      steps: [
        { id: 'payment', state: 'complete', reason: 'payment_recorded' },
        { id: 'publication', state: 'complete', reason: 'publication_done' }
      ],
      next: null
    },
    paidAt: '2026-10-01T12:00:00Z',
    contributionVersion: '2026-10-02T12:00:00Z',
    offerFingerprint: sponsorshipOfferFingerprint(offer),
    commitment: {
      id: uuid(2),
      contributionId: uuid(1),
      offerId: uuid(3),
      provenance: 'accepted_offer',
      state: 'active',
      qualificationReason: null,
      version: 1,
      offer,
      obligations: [
        {
          id: uuid(4),
          commitmentId: uuid(2),
          contributionId: uuid(1),
          benefitId: 'website_mention',
          channel: 'website',
          target: 'openg7',
          format: null,
          ordinal: 1,
          state: 'fulfilled',
          blockedReason: null,
          version: 2,
          fulfilmentEvidenceId: uuid(5),
          timing: {
            version: 1,
            deadlineDays: null,
            durationDays: null,
            originAt: null,
            originProvenance: null,
            dueAt: null,
            overdue: false,
            durationState: 'not_required',
            startObservation: null
          }
        }
      ]
    },
    evidence: [
      {
        id: uuid(5),
        obligationId: uuid(4),
        contributionId: uuid(1),
        obligationVersion: 1,
        channel: 'website',
        target: 'openg7',
        mode: 'live',
        qualifiedSnapshot: true,
        provenance: 'website_verified',
        deliveredAt: '2026-10-02T12:00:00Z',
        externalPostUrl: null
      }
    ],
    changes: []
  };
};
const pending = () => {
  const value = facts();
  Object.assign(value.commitment.obligations[0], {
    state: 'pending',
    version: 1,
    fulfilmentEvidenceId: null
  });
  value.evidence = [];
  return value;
};
const project = (value) => buildResponsibilityBalance(value, now);

test('one exact immutable proof balances one recorded promise without changing inputs', () => {
  const value = facts();
  const copy = structuredClone(value);
  const balance = project(value);
  assert.equal(balance.status, 'balanced');
  assert.equal(balance.expected, 1);
  assert.equal(balance.fulfilled, 1);
  assert.equal(balance.waived, 0);
  assert.equal(balance.outstanding, 0);
  assert.equal(balance.unknown, 0);
  assert.equal(balance.next, null);
  assert.deepEqual(balance.promisedBenefits, value.commitment.offer.benefits);
  assert.notEqual(balance.promisedBenefits, value.commitment.offer.benefits);
  assert.notEqual(
    balance.promisedBenefits[0].requiredElements,
    value.commitment.offer.benefits[0].requiredElements
  );
  assert.equal(balance.obligations[0].evidence.id, uuid(5));
  assert.equal('mode' in balance.obligations[0].evidence, false);
  assert.match(balance.version, /^[a-f0-9]{64}$/);
  assert.deepEqual(value, copy);
  assert.deepEqual(project(value), balance);
});

test('a historical published/complete journey never replaces the missing commercial terms', () => {
  for (const commitment of [
    null,
    { ...facts().commitment, state: 'needs_confirmation', offer: null }
  ]) {
    const balance = project({ ...facts(), commitment });
    assert.equal(balance.status, 'unknown');
    assert.equal(balance.fulfilled, 0);
    assert.deepEqual(balance.promisedBenefits, []);
    assert.ok(balance.reasons.includes('commitment_needs_confirmation'));
  }
});

test('a journey complete flag cannot hide pending obligations', () => {
  const balance = project(pending());
  assert.equal(balance.status, 'action_required');
  assert.equal(balance.expected, 1);
  assert.equal(balance.outstanding, 1);
  assert.equal(balance.fulfilled, 0);
  assert.equal(balance.next.reason, 'publication_pending');
});

for (const [label, alter] of [
  ['foreign dossier', (e) => (e.contributionId = uuid(9))],
  ['foreign obligation', (e) => (e.obligationId = uuid(9))],
  ['wrong proof ID', (e) => (e.id = uuid(9))],
  ['stale proof version', (e) => (e.obligationVersion = 2)],
  ['wrong channel', (e) => (e.channel = 'linkedin')],
  ['wrong destination', (e) => (e.target = 'openg20')],
  ['simulation', (e) => (e.mode = 'mock')],
  ['incomplete recorded source', (e) => (e.qualifiedSnapshot = false)],
  ['invalid delivery date', (e) => (e.deliveredAt = 'unknown')],
  ['wrong provider provenance', (e) => (e.provenance = 'provider_acknowledged')]
]) {
  test(`a ${label} never qualifies a claimed fulfilment`, () => {
    const value = facts();
    alter(value.evidence[0]);
    const balance = project(value);
    assert.equal(balance.status, 'unknown');
    assert.equal(balance.fulfilled, 0);
    assert.equal(balance.outstanding, 1);
    assert.equal(balance.obligations[0].evidence, undefined);
    assert.ok(
      balance.reasons.includes(
        label === 'incomplete recorded source'
          ? 'fulfilment_snapshot_unqualified'
          : 'fulfilment_evidence_mismatch'
      )
    );
  });
}

for (const [label, alter] of [
  ['amount mismatch', (v) => v.journey.amountMinor++],
  ['currency mismatch', (v) => (v.journey.currency = 'USD')],
  ['missing fingerprint', (v) => (v.offerFingerprint = null)],
  ['changed offer', (v) => v.commitment.offer.benefits[0].quantity++],
  ['invalid offer', (v) => (v.commitment.offer.benefits[0].quantity = 0)]
]) {
  test(`${label} keeps the balance unknown`, () => {
    const value = facts();
    alter(value);
    assert.equal(project(value).status, 'unknown');
  });
}

test('missing promised ordinals remain counted even when existing publications are complete', () => {
  const value = facts();
  value.commitment.offer.benefits[0].quantity = 3;
  value.offerFingerprint = sponsorshipOfferFingerprint(value.commitment.offer);
  const balance = project(value);
  assert.equal(balance.expected, 3);
  assert.equal(balance.fulfilled, 1);
  assert.equal(balance.outstanding, 2);
  assert.equal(balance.status, 'unknown');
  assert.deepEqual(balance.promisedBenefits, value.commitment.offer.benefits);
  assert.equal(balance.promisedBenefits[0].quantity, 3);
  assert.ok(balance.reasons.includes('promised_obligation_missing'));
});

test('the report preserves every public frozen promise even without its obligation rows', () => {
  const value = facts();
  value.commitment.offer.benefits.push({
    id: 'linkedin_batch',
    channel: 'linkedin',
    target: 'openg20',
    quantity: 2,
    format: 'collective_composite',
    requiredElements: [
      'company_name',
      'approved_logo',
      'approved_presentation'
    ],
    deadlineDays: 14,
    durationDays: null
  });
  value.offerFingerprint = sponsorshipOfferFingerprint(value.commitment.offer);
  const original = structuredClone(value);
  const balance = project(value);
  assert.equal(balance.status, 'unknown');
  assert.equal(balance.expected, 3);
  assert.equal(balance.outstanding, 2);
  assert.deepEqual(
    balance.promisedBenefits,
    original.commitment.offer.benefits
  );
  balance.promisedBenefits[1].requiredElements.pop();
  assert.deepEqual(
    value,
    original,
    'report consumers cannot rewrite accepted terms'
  );
  assert.deepEqual(
    project(value).promisedBenefits,
    original.commitment.offer.benefits
  );
});

test('unknown, tampered or private offer fields never leak through promised benefits', () => {
  for (const alter of [
    (v) => (v.offerFingerprint = null),
    (v) => (v.commitment.offer.benefits[0].quantity = 0),
    (v) =>
      (v.commitment.offer.benefits[0].privateContact =
        'private@example.invalid'),
    (v) => (v.commitment.offer.privateReason = 'synthetic private note')
  ]) {
    const value = facts();
    alter(value);
    const balance = project(value);
    assert.equal(balance.status, 'unknown');
    assert.deepEqual(balance.promisedBenefits, []);
    assert.equal(
      JSON.stringify(balance).includes('private@example.invalid'),
      false
    );
    assert.equal(
      JSON.stringify(balance).includes('synthetic private note'),
      false
    );
  }
});

test('qualified delivery after its recorded deadline is reported without changing fulfilment', () => {
  const value = facts();
  value.commitment.offer.benefits[0].deadlineDays = 1;
  value.offerFingerprint = sponsorshipOfferFingerprint(value.commitment.offer);
  Object.assign(value.commitment.obligations[0].timing, {
    deadlineDays: 1,
    originAt: '2026-10-01T12:00:00Z',
    originProvenance: 'owner_recorded',
    dueAt: '2026-10-02T12:00:00Z'
  });
  const onTime = project(value);
  assert.equal(onTime.status, 'balanced');
  assert.equal(onTime.reasons.includes('delivery_late'), false);
  value.evidence[0].deliveredAt = '2026-10-02T12:00:00.001Z';
  const late = project(value);
  assert.equal(late.status, onTime.status);
  assert.equal(late.fulfilled, 1);
  assert.equal(late.outstanding, 0);
  assert.ok(late.reasons.includes('delivery_late'));
  assert.equal(
    late.obligations[0].evidence.deliveredAt,
    value.evidence[0].deliveredAt
  );
  value.evidence[0].qualifiedSnapshot = false;
  assert.equal(project(value).reasons.includes('delivery_late'), false);
});

for (const [label, alter] of [
  ['foreign owner', (o) => (o.contributionId = uuid(9))],
  ['foreign commitment', (o) => (o.commitmentId = uuid(9))],
  ['wrong benefit channel', (o) => (o.channel = 'facebook')],
  ['invalid ordinal', (o) => (o.ordinal = 0)],
  ['extra ordinal', (o) => (o.ordinal = 2)],
  ['unreviewed destination', (o) => (o.target = 'openg20')],
  ['unreviewed version', (o) => o.version++],
  ['missing timing', (o) => delete o.timing]
]) {
  test(`${label} cannot extinguish an accepted promise`, () => {
    const value = facts();
    alter(value.commitment.obligations[0]);
    assert.equal(project(value).status, 'unknown');
  });
}

test('duplicated obligations and orphan proof are reported rather than counted twice', () => {
  const duplicated = facts();
  duplicated.commitment.obligations.push(
    structuredClone(duplicated.commitment.obligations[0])
  );
  assert.equal(project(duplicated).status, 'unknown');
  const orphan = pending();
  orphan.evidence = facts().evidence;
  const balance = project(orphan);
  assert.equal(balance.status, 'unknown');
  assert.equal(balance.fulfilled, 0);
  assert.ok(balance.reasons.includes('orphan_fulfilment_evidence'));
});

test('a recorded, audited waiver is separate from a delivered benefit', () => {
  const value = pending();
  Object.assign(value.commitment.obligations[0], {
    state: 'adjusted',
    version: 2
  });
  const before = {
    state: 'pending',
    target: 'openg7',
    format: null,
    version: 1
  };
  value.changes = [
    {
      id: uuid(6),
      obligationId: uuid(4),
      commitmentId: uuid(2),
      kind: 'waiver',
      previousValue: before,
      resultingValue: { ...before, state: 'adjusted', version: 2 },
      audited: true
    }
  ];
  const balance = project(value);
  assert.equal(balance.status, 'balanced');
  assert.equal(balance.fulfilled, 0);
  assert.equal(balance.waived, 1);
  assert.equal(balance.obligations[0].evidence, undefined);
  for (const alter of [
    (v) => (v.changes = []),
    (v) => (v.changes[0].audited = false),
    (v) => v.changes[0].resultingValue.version++,
    (v) => (v.changes[0].commitmentId = uuid(9)),
    (v) => (v.changes[0].obligationId = uuid(9))
  ]) {
    const invalid = structuredClone(value);
    alter(invalid);
    assert.equal(project(invalid).status, 'unknown');
    assert.equal(project(invalid).waived, 0);
  }
});

test('an exact audited destination change updates current work without replacing the accepted offer', () => {
  const value = pending();
  const obligation = value.commitment.obligations[0];
  Object.assign(obligation, { target: 'openg20', version: 2 });
  const before = {
    state: 'pending',
    target: 'openg7',
    format: null,
    version: 1
  };
  value.changes = [
    {
      id: uuid(6),
      obligationId: uuid(4),
      commitmentId: uuid(2),
      kind: 'destination',
      previousValue: before,
      resultingValue: { ...before, target: 'openg20', version: 2 },
      audited: true
    }
  ];
  assert.equal(project(value).status, 'action_required');
  assert.equal(project(value).obligations[0].target, 'openg20');
  assert.equal(value.commitment.offer.benefits[0].target, 'openg7');
  value.changes[0].audited = false;
  assert.equal(project(value).status, 'unknown');
});

test('a duration clock waits but does not prove continuity or completion', () => {
  const value = pending();
  const benefit = value.commitment.offer.benefits[0];
  benefit.durationDays = 30;
  value.offerFingerprint = sponsorshipOfferFingerprint(value.commitment.offer);
  const timing = value.commitment.obligations[0].timing;
  Object.assign(timing, {
    durationDays: 30,
    durationState: 'awaiting_review',
    startObservation: {
      id: uuid(7),
      observedAt: '2026-10-01T12:00:00Z',
      earliestCompletionAt: '2026-10-31T12:00:00Z'
    }
  });
  assert.equal(project(value).status, 'waiting');
  assert.equal(project(value).fulfilled, 0);
  assert.equal(
    buildResponsibilityBalance(value, new Date('2026-11-01T12:00:00Z')).status,
    'action_required'
  );
  timing.durationState = 'restart_required';
  assert.equal(project(value).status, 'blocked');
  Object.assign(value.commitment.obligations[0], {
    state: 'fulfilled',
    version: 2,
    fulfilmentEvidenceId: uuid(5)
  });
  value.evidence = facts().evidence;
  assert.equal(project(value).status, 'unknown');
  timing.durationState = 'attested';
  assert.equal(project(value).status, 'balanced');
});

test('a promised deadline needs the recorded origin; current prices supply no missing terms', () => {
  const value = pending();
  value.commitment.offer.benefits[0].deadlineDays = 14;
  value.offerFingerprint = sponsorshipOfferFingerprint(value.commitment.offer);
  value.commitment.obligations[0].timing.deadlineDays = 14;
  const balance = project(value);
  assert.equal(balance.status, 'unknown');
  assert.ok(balance.reasons.includes('deadline_origin_unknown'));
});

test('refused, disputed and missing confirmations remain unresolved', () => {
  const disputed = facts();
  disputed.journey.paymentStatus = 'disputed';
  assert.equal(project(disputed).status, 'blocked');
  assert.equal(project(disputed).fulfilled, 1, 'delivery history is preserved');
  const refused = pending();
  Object.assign(refused.commitment.obligations[0], {
    state: 'blocked',
    blockedReason: 'review_rejected'
  });
  assert.equal(project(refused).status, 'blocked');
  const unconfirmed = facts();
  unconfirmed.paidAt = null;
  assert.equal(project(unconfirmed).status, 'unknown');
});

test('a confirmed refunded personal payment with no remaining responsibility is balanced', () => {
  const value = facts();
  value.journey.contributionType = 'personal_support';
  value.journey.paymentStatus = 'refunded';
  value.commitment = null;
  value.evidence = [];
  const balance = project(value);
  assert.equal(balance.status, 'balanced');
  assert.equal(balance.expected, 0);
  assert.ok(balance.reasons.includes('payment_refunded'));
});

test('a refunded sponsorship can balance fulfilled or explicitly waived promises', () => {
  const fulfilled = facts();
  fulfilled.journey.paymentStatus = 'refunded';
  assert.equal(project(fulfilled).status, 'balanced');
  assert.equal(project(fulfilled).fulfilled, 1);
  const waived = pending();
  waived.journey.paymentStatus = 'refunded';
  Object.assign(waived.commitment.obligations[0], {
    state: 'adjusted',
    version: 2
  });
  const before = {
    state: 'pending',
    target: 'openg7',
    format: null,
    version: 1
  };
  waived.changes = [
    {
      id: uuid(6),
      obligationId: uuid(4),
      commitmentId: uuid(2),
      kind: 'waiver',
      previousValue: before,
      resultingValue: { ...before, state: 'adjusted', version: 2 },
      audited: true
    }
  ];
  const balance = project(waived);
  assert.equal(balance.status, 'balanced');
  assert.equal(balance.fulfilled, 0);
  assert.equal(balance.waived, 1);
  assert.equal(balance.outstanding, 0);
});

test('a refund alone cannot waive pending promises even when the journey falsely claims completion', () => {
  const value = pending();
  value.journey.paymentStatus = 'refunded';
  const original = structuredClone(value);
  const balance = project(value);
  assert.equal(balance.status, 'blocked');
  assert.equal(balance.outstanding, 1);
  assert.equal(balance.fulfilled, 0);
  assert.equal(balance.waived, 0);
  assert.deepEqual(value, original);
});

test('refund documents, uncertain communications and unfinished refund workflows still prevent balance', () => {
  for (const [state, reason] of [
    ['blocked', 'credit_missing'],
    ['error', 'email_uncertain'],
    ['pending', 'refund_check']
  ]) {
    const value = facts();
    value.journey.paymentStatus = 'refunded';
    value.journey.steps.push({ id: 'incident', state, reason });
    assert.notEqual(project(value).status, 'balanced');
    assert.equal(project(value).fulfilled, 1);
  }
});

test('a disputed personal payment remains blocked even with no promised benefits', () => {
  const value = facts();
  value.journey.contributionType = 'personal_support';
  value.journey.paymentStatus = 'disputed';
  value.commitment = null;
  value.evidence = [];
  assert.equal(project(value).status, 'blocked');
});

test('document and communication failures prevent a balanced dossier after delivery', () => {
  for (const [state, status] of [
    ['error', 'action_required'],
    ['blocked', 'blocked'],
    ['pending', 'action_required']
  ]) {
    const value = facts();
    value.journey.steps.push({
      id: 'billing',
      state,
      reason: 'invoice_missing'
    });
    assert.equal(project(value).status, status);
    assert.equal(project(value).fulfilled, 1);
  }
  const value = facts();
  value.journey.state = 'waiting';
  value.journey.steps.push({
    id: 'communications',
    state: 'pending',
    reason: 'email_pending'
  });
  assert.equal(project(value).status, 'waiting');
});

test('personal payments have no invented benefits, and currencies remain separate facts', () => {
  for (const currency of ['CAD', 'USD']) {
    const value = facts();
    value.journey.contributionType = 'personal_support';
    value.journey.currency = currency;
    value.commitment = null;
    value.evidence = [];
    const balance = project(value);
    assert.equal(balance.status, 'balanced');
    assert.equal(balance.expected, 0);
    assert.equal(balance.currency, currency);
    assert.equal(balance.amountMinor, 50000);
  }
  const mixed = facts();
  mixed.journey.contributionType = 'personal_support';
  assert.equal(project(mixed).status, 'unknown');
});

test('the version includes evidence, amendments, contribution, timing and communication changes', () => {
  const initial = project(facts()).version;
  for (const alter of [
    (v) => (v.contributionVersion = '2026-10-03T12:00:00Z'),
    (v) => (v.evidence[0].deliveredAt = '2026-10-04T12:00:00Z'),
    (v) => v.commitment.obligations[0].timing.version++,
    (v) =>
      v.journey.steps.push({
        id: 'communications',
        state: 'error',
        reason: 'email_failed'
      })
  ]) {
    const value = facts();
    alter(value);
    assert.notEqual(project(value).version, initial);
  }
});

test('missing database, malformed IDs and unknown records fail explicitly', async () => {
  await assert.rejects(loadResponsibilityBalance(null, uuid(1)), {
    code: 'BALANCE_UNAVAILABLE',
    status: 503
  });
  await assert.rejects(loadResponsibilityBalance(null, 'invalid'), {
    code: 'INVALID_CONTRIBUTION_ID',
    status: 400
  });
  const events = [];
  const client = {
    async query(sql) {
      events.push(sql);
      return { rows: [] };
    },
    release() {
      events.push('release');
    }
  };
  await assert.rejects(
    loadResponsibilityBalance({ connect: async () => client }, uuid(1)),
    { code: 'CONTRIBUTION_NOT_FOUND', status: 404 }
  );
  assert.equal(events[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(events.slice(-2), ['ROLLBACK', 'release']);
});

test('unsafe money values and malformed currencies are never returned as a valid balance', () => {
  for (const amountMinor of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    const value = facts();
    value.journey.amountMinor = amountMinor;
    assert.throws(() => project(value), { code: 'BALANCE_FACTS_INVALID' });
  }
  const value = facts();
  value.journey.currency = 'CAD+USD';
  assert.throws(() => project(value), { code: 'BALANCE_FACTS_INVALID' });
});
