import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  createSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferSnapshot
} from '../dist/packages/funding-core/src/index.js';
import {
  quoteSponsorshipOffer,
  sponsorshipOfferFingerprint,
  validateSponsorshipOfferAcceptance
} from '../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import {
  activateSponsorshipCommitments,
  loadSponsorshipCommitment
} from '../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import { createSponsorshipCommitmentsHttpHandler } from '../dist/apps/funding-api/src/sponsorship-commitments/admin-http.js';
import { createPublicPaymentsHttpHandler } from '../dist/apps/funding-api/src/public-payments.http.js';
import {
  qualifySponsorshipCommitment,
  adjustSponsorshipObligation
} from '../dist/apps/funding-api/src/sponsorship-commitments/changes.js';

test('offered benefits use safe integer minor units, an explicit CAD currency and exact boundaries', () => {
  for (const [amount, ids] of [
    [5000, ['website_mention']],
    [24999, ['website_mention']],
    [25000, ['website_mention', 'facebook_batch']],
    [50000, ['website_mention', 'facebook_batch', 'linkedin_batch']]
  ]) {
    const offer = createSponsorshipOfferSnapshot(amount, 'CAD');
    assert.equal(offer.amountMinor, amount);
    assert.deepEqual(
      offer.benefits.map((b) => b.id),
      ids
    );
    assert.ok(
      offer.benefits.every(
        (b) =>
          b.quantity === 1 &&
          b.target === 'openg7' &&
          b.deadlineDays === null &&
          b.durationDays === null
      )
    );
    assert.ok(
      offer.benefits.every((b) =>
        b.requiredElements.includes('approved_presentation')
      )
    );
  }
  for (const amount of [
    4999,
    5000.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1
  ])
    assert.throws(() => createSponsorshipOfferSnapshot(amount, 'CAD'));
  for (const currency of ['USD', 'cad', ''])
    assert.throws(() => createSponsorshipOfferSnapshot(50000, currency));
});

test('a previously quoted snapshot retains terms when the current pricing changes', () => {
  const original = quoteSponsorshipOffer(50000, 'CAD');
  const altered = quoteSponsorshipOffer(50000, 'CAD', {
    minimumAmount: 50,
    presetAmounts: [50],
    benefits: {
      websiteMention: { minimumAmount: 50 },
      facebookBatch: { minimumAmount: 750 },
      linkedinBatch: { minimumAmount: 1000 }
    }
  });
  assert.notEqual(original.fingerprint, altered.fingerprint);
  assert.equal(original.benefits.length, 3);
  assert.equal(altered.benefits.length, 1);
  assert.equal(sponsorshipOfferFingerprint(original), original.fingerprint);
  const unordered = {
    currency: original.currency,
    benefits: original.benefits,
    amountMinor: original.amountMinor,
    version: original.version
  };
  assert.equal(sponsorshipOfferFingerprint(unordered), original.fingerprint);
});

test('offer acceptance is a strict reference and historical terms reject foreign channels or unsafe quantities', () => {
  const quote = quoteSponsorshipOffer(50000, 'CAD');
  const { fingerprint: _fingerprint, ...snapshot } = quote;
  assert.deepEqual(
    validateSponsorshipOfferAcceptance({
      version: quote.version,
      fingerprint: quote.fingerprint
    }),
    { version: quote.version, fingerprint: quote.fingerprint }
  );
  for (const bad of [
    null,
    [],
    { version: quote.version, fingerprint: ['a'.repeat(64)] },
    { version: quote.version, fingerprint: quote.fingerprint, benefits: [] }
  ])
    assert.throws(() => validateSponsorshipOfferAcceptance(bad), {
      code: 'SPONSORSHIP_OFFER_INVALID'
    });
  for (const change of [
    { channel: 'twitter' },
    { quantity: 1.5 },
    { target: ['openg7'] },
    { deadlineDays: 0 }
  ])
    assert.throws(() =>
      normalizeSponsorshipOfferSnapshot({
        ...snapshot,
        benefits: [{ ...quote.benefits[0], ...change }]
      })
    );
});

test('normalization rejects unrecognized promises and isolates every recorded requirement array', () => {
  const snapshot = createSponsorshipOfferSnapshot(50000, 'CAD');
  for (const unknown of [
    { ...snapshot, guaranteedReach: 1000 },
    { ...snapshot, fingerprint: 'a'.repeat(64) },
    {
      ...snapshot,
      benefits: [{ ...snapshot.benefits[0], individualPhoto: true }]
    }
  ])
    assert.throws(() => normalizeSponsorshipOfferSnapshot(unknown));
  assert.throws(() =>
    sponsorshipOfferFingerprint({ ...snapshot, guaranteedReach: 1000 })
  );
  const normalized = normalizeSponsorshipOfferSnapshot(snapshot);
  const hash = sponsorshipOfferFingerprint(normalized);
  snapshot.benefits[0].requiredElements.push('approved_logo');
  snapshot.benefits[0].quantity = 2;
  snapshot.benefits.push({ ...snapshot.benefits[0] });
  assert.equal(normalized.benefits.length, 3);
  assert.equal(normalized.benefits[0].quantity, 1);
  assert.deepEqual(normalized.benefits[0].requiredElements, [
    'company_name',
    'approved_presentation'
  ]);
  assert.equal(sponsorshipOfferFingerprint(normalized), hash);
});

test('unknown administrative terms are refused before database access', async () => {
  const id = '00000000-0000-4000-8000-000000000041';
  const db = { query: () => assert.fail('no database access') };
  const common = {
    requestId: id,
    expectedVersion: 1,
    confirmation: id,
    reason: 'Synthetic explicit agreement'
  };
  await assert.rejects(
    qualifySponsorshipCommitment(
      db,
      {
        ...common,
        contributionId: id,
        evidenceReference: 'synthetic://agreement',
        offer: createSponsorshipOfferSnapshot(50000, 'CAD'),
        guarantee: 'reach'
      },
      `admin:${id}`
    ),
    { code: 'COMMITMENT_INVALID' }
  );
  await assert.rejects(
    adjustSponsorshipObligation(
      db,
      { ...common, obligationId: id, kind: 'waiver', payment: 'refunded' },
      `admin:${id}`
    ),
    { code: 'COMMITMENT_INVALID' }
  );
});

test('only exact authoritative payment facts can correlate an accepted offer', async () => {
  const sessionId = 'cs_synthetic';
  const paymentIntentId = 'pi_synthetic';
  const operationId = '00000000-0000-4000-8000-000000000041';
  const offer = createSponsorshipOfferSnapshot(50000, 'CAD');
  for (const facts of [
    undefined,
    { amountCents: 49999, currency: 'CAD' },
    { amountCents: 50000.5, currency: 'CAD' },
    { amountCents: Number.MAX_SAFE_INTEGER + 1, currency: 'CAD' },
    { amountCents: 50000, currency: 'USD' },
    { amountCents: 50000, currency: null },
    { amountCents: 50000, currency: 'CAD', publicReference: 'SYNTHETIC-OTHER' },
    { amountCents: 50000, currency: 'cad', publicReference: 'SYNTHETIC' }
  ]) {
    const accepts = facts?.publicReference === 'SYNTHETIC';
    let insert;
    let createdObligations = 0;
    const db = {
      query: async (sql, values) => {
        if (sql.includes('FROM fund_contributions c LEFT JOIN'))
          return {
            rows: [
              {
                id: 'contribution',
                public_reference: 'SYNTHETIC',
                amount_cents: '50000',
                currency: 'cad',
                stripe_session_id: sessionId,
                stripe_payment_intent_id: paymentIntentId,
                metadata: { openg7CheckoutOperationId: operationId }
              }
            ]
          };
        if (sql.includes('SELECT id,snapshot FROM sponsorship_offers')) {
          assert.ok(accepts, 'uncorrelated payment must not select an offer');
          return { rows: [{ id: 'offer', snapshot: offer }] };
        }
        if (sql.includes('INSERT INTO sponsorship_commitments')) {
          insert = values;
          return {
            rows: [{ id: 'commitment', offer_id: accepts ? 'offer' : null }]
          };
        }
        if (sql.includes('INSERT INTO sponsorship_obligations')) {
          createdObligations++;
          return { rows: [] };
        }
        assert.fail('unexpected query');
      }
    };
    await activateSponsorshipCommitments(db, {
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
      trustedPaymentFacts: facts
    });
    assert.equal(
      insert[2],
      accepts ? 'accepted_offer' : 'historical_unverified'
    );
    assert.equal(insert[3], accepts ? 'active' : 'needs_confirmation');
    assert.equal(createdObligations, accepts ? 3 : 0);
  }
});

test('public quote exposes no private data and rejects non-CAD or fractional minor units', async () => {
  const handler = createPublicPaymentsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    businessSponsorshipEnabled: true,
    writeJson: (_r, response, status, payload) =>
      Object.assign(response, { status, payload })
  });
  for (const [query, status] of [
    ['amountMinor=25000&currency=CAD', 200],
    ['amountMinor=25000&currency=USD', 400],
    ['amountMinor=25000.5&currency=CAD', 400],
    ['amountMinor=25000&amountMinor=50000&currency=CAD', 400]
  ]) {
    const response = {};
    assert.equal(
      await handler(
        { method: 'GET', url: `/api/sponsorship-offer?${query}` },
        response
      ),
      true
    );
    assert.equal(response.status, status);
    if (status === 200)
      assert.deepEqual(Object.keys(response.payload).sort(), [
        'amountMinor',
        'benefits',
        'currency',
        'fingerprint',
        'version'
      ]);
  }
});

test('current blocking conditions do not erase qualified fulfilment or explicit adjustment history', async () => {
  const offer = createSponsorshipOfferSnapshot(50000, 'CAD');
  const db = {
    query: async (sql) =>
      sql.includes('FROM sponsorship_commitments m JOIN fund_contributions')
        ? {
            rows: [
              {
                id: 'commitment',
                contributionId: 'source',
                offerId: 'offer',
                provenance: 'accepted_offer',
                state: 'active',
                version: 1,
                offer,
                qualificationReason: null,
                blockedReason: 'payment_refunded'
              }
            ]
          }
        : {
            rows: ['pending', 'fulfilled', 'adjusted'].map((state, i) => ({
              id: `obligation-${i}`,
              commitmentId: 'commitment',
              contributionId: 'source',
              benefitId: offer.benefits[i].id,
              channel: offer.benefits[i].channel,
              target: 'openg7',
              ordinal: 1,
              state,
              blockedReason: null,
              version: 1,
              fulfilmentEvidenceId: state === 'fulfilled' ? 'proof' : null,
              requirementsMet: true
            }))
          }
  };
  const record = await loadSponsorshipCommitment(db, 'source');
  assert.deepEqual(
    record.obligations.map((o) => o.state),
    ['blocked', 'fulfilled', 'adjusted']
  );
  assert.equal(record.obligations[0].blockedReason, 'payment_refunded');
  assert.equal(record.obligations[1].fulfilmentEvidenceId, 'proof');
});

test('qualification and adjustment require server owner rights before body or database access', async () => {
  const handler = createSponsorshipCommitmentsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    pool: { connect: () => assert.fail('no database access') },
    readBody: () => assert.fail('no body access'),
    ensureAdminAccess: () => true,
    canOwn: () => false,
    getAdminAuditActor: () => assert.fail('no actor access'),
    writeJson: (_r, response, status, payload) =>
      Object.assign(response, { status, payload })
  });
  for (const operation of ['qualify', 'adjust']) {
    const request = Readable.from([]);
    Object.assign(request, {
      method: 'POST',
      url: `/api/admin/sponsorship-commitments/${operation}`,
      headers: { 'content-type': 'application/json' }
    });
    const response = { setHeader() {} };
    await handler(request, response);
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, 'COMMITMENT_OWNER_REQUIRED');
  }
});
