import assert from 'node:assert/strict';
import test from 'node:test';

import { createSponsorshipOfferSnapshot } from '../dist/packages/funding-core/src/index.js';
import { activateSponsorshipCommitments } from '../dist/apps/funding-api/src/sponsorship-commitments.repository.js';

const sessionId = 'cs_synthetic_activation';
const paymentIntentId = 'pi_synthetic_activation';
const reference = 'OG7-2026-ABCDEF12';
const operationId = '00000000-0000-4000-8000-000000000041';

const fixture = (accepts) => {
  let insert;
  let createdObligations = 0;
  let initializedTiming = 0;
  const offer = createSponsorshipOfferSnapshot(50000, 'CAD');
  return {
    db: {
      query: async (sql, values) => {
        if (sql.includes('FROM fund_contributions c LEFT JOIN'))
          return {
            rows: [
              {
                id: 'contribution',
                public_reference: reference,
                amount_cents: '50000',
                currency: 'cad',
                stripe_session_id: sessionId,
                stripe_payment_intent_id: paymentIntentId,
                metadata: { openg7CheckoutOperationId: operationId }
              }
            ]
          };
        if (sql.includes('SELECT id,snapshot FROM sponsorship_offers')) {
          assert.ok(
            accepts,
            'uncorrelated payment cannot qualify recorded terms'
          );
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
        if (sql.includes('INSERT INTO sponsorship_obligation_timing')) {
          assert.equal(createdObligations, 3);
          assert.deepEqual(values, ['commitment']);
          assert.match(sql, /ON CONFLICT\(obligation_id\) DO NOTHING/);
          assert.doesNotMatch(sql, /origin_at|due_at/);
          initializedTiming++;
          return { rows: [] };
        }
        assert.fail('unexpected query');
      }
    },
    assertResult: () => {
      assert.equal(
        insert[2],
        accepts ? 'accepted_offer' : 'historical_unverified'
      );
      assert.equal(insert[3], accepts ? 'active' : 'needs_confirmation');
      assert.equal(createdObligations, accepts ? 3 : 0);
      assert.equal(initializedTiming, accepts ? 1 : 0);
    }
  };
};

test('only exact authoritative monetary facts correlate an accepted offer', async () => {
  const accepted = {
    amountCents: 50000,
    currency: 'cad',
    publicReference: reference
  };
  for (const facts of [
    undefined,
    { amountCents: 0, currency: 'CAD' },
    { amountCents: 49999, currency: 'CAD' },
    { amountCents: 50000.5, currency: 'CAD' },
    { amountCents: Number.MAX_SAFE_INTEGER + 1, currency: 'CAD' },
    { amountCents: 50000, currency: 'USD' },
    { amountCents: 50000, currency: null },
    {
      amountCents: 50000,
      currency: 'CAD',
      publicReference: 'OG7-2026-ABCDEF34'
    },
    accepted
  ]) {
    const f = fixture(facts === accepted);
    await activateSponsorshipCommitments(f.db, {
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
      trustedPaymentFacts: facts
    });
    f.assertResult();
  }
});

test('provided Session and PI identifiers must refer to the same contribution', async () => {
  for (const mismatch of [
    { stripeSessionId: 'cs_synthetic_other' },
    { stripePaymentIntentId: 'pi_synthetic_other' }
  ]) {
    const f = fixture(false);
    await activateSponsorshipCommitments(f.db, {
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
      ...mismatch,
      trustedPaymentFacts: {
        amountCents: 50000,
        currency: 'CAD',
        publicReference: reference
      }
    });
    f.assertResult();
  }
});
