import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDurableCheckoutService } from '../../dist/apps/funding-api/src/checkout-operations.service.js';
import { upsertCheckoutSessionFromWebhook } from '../../dist/apps/funding-api/src/contributions-write.repository.js';
import {
  quoteSponsorshipOffer,
  recordCheckoutSponsorshipOffer,
  sponsorshipOfferFingerprint
} from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import { loadSponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import { adjustSponsorshipObligation } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

// Only Checkout's provider response is synthetic. Commercial history, schema,
// payment activation, constraints and replay use the real persistence paths.
async function checkout(pool, quote) {
  const suffix = randomUUID().replaceAll('-', '');
  const reference = `OG7-2026-${suffix.slice(0, 8).toUpperCase()}`;
  const sessionId = `cs_test_v4_${suffix}`;
  const intentId = `pi_test_v4_${suffix}`;
  let metadata;
  let providerCalls = 0;
  const run = createDurableCheckoutService(pool, {
    checkout: {
      sessions: {
        create: async () => {
          providerCalls++;
          return {
            id: sessionId,
            payment_intent: intentId,
            url: `https://checkout.example.invalid/${suffix}`
          };
        }
      }
    }
  });
  const key = `synthetic-v4-${suffix}`;
  const attempt = {
    key,
    requestHash: createHash('sha256').update(key).digest('hex'),
    prepare(operationId) {
      metadata = {
        project: 'openg7',
        contributionType: 'sponsorship_interest',
        publicReference: reference,
        openg7CheckoutOperationId: operationId
      };
      return {
        params: { mode: 'payment', metadata },
        record: {
          publicReference: reference,
          contributionType: 'sponsorship_interest',
          amountCents: quote.amountMinor,
          currency: 'cad',
          metadata,
          publicDisplayConsent: true,
          publicName: 'Synthetic v4 sponsor',
          displayAmountConsent: false,
          nonCharityAcknowledged: true,
          sponsorshipFollowupTokenHash: null
        }
      };
    },
    afterPrepare: (db, operationId) =>
      recordCheckoutSponsorshipOffer(db, operationId, {
        publicReference: reference,
        quote
      })
  };
  await run(attempt);
  const id = (
    await pool.query(
      'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
      [sessionId]
    )
  ).rows[0].id;
  const payment = {
    stripeSessionId: sessionId,
    stripePaymentIntentId: intentId,
    publicReference: reference,
    contributionType: 'sponsorship_interest',
    amountCents: quote.amountMinor,
    currency: 'cad',
    metadata,
    publicDisplayConsent: true,
    publicName: 'Synthetic v4 sponsor',
    displayAmountConsent: false,
    nonCharityAcknowledged: true,
    sponsorshipFollowupTokenHash: null,
    status: 'paid',
    paidAtIso: '2026-11-20T12:00:00Z',
    emailPrivate: null,
    notifyAdmin: false,
    trustedPaymentFacts: {
      amountCents: quote.amountMinor,
      currency: 'cad',
      publicReference: reference
    }
  };
  return {
    id,
    pay: () => upsertCheckoutSessionFromWebhook(pool, payment),
    replay: () => run(attempt),
    providerCalls: () => providerCalls
  };
}

test(
  'v4 adds independent services while migration and payment replays preserve accepted v3 terms',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    try {
      const migrations = (await readdir('apps/funding-api/migrations'))
        .filter((file) => file.endsWith('.sql'))
        .sort();
      for (const file of migrations.filter(
        (file) => Number(file.slice(0, 3)) < 72
      ))
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );

      const legacyTerms = {
        version: 'sponsorship-v3',
        amountMinor: 50000,
        currency: 'CAD',
        benefits: ['website', 'facebook', 'linkedin'].map((channel) => ({
          id: channel === 'website' ? 'website_mention' : `${channel}_batch`,
          channel,
          target: 'openg7',
          quantity: 1,
          requiredElements: ['company_name'],
          deadlineDays: null,
          durationDays: null,
          ...(channel === 'website' ? {} : { format: 'collective_text' })
        }))
      };
      const legacy = await checkout(pool, {
        ...legacyTerms,
        fingerprint: sponsorshipOfferFingerprint(legacyTerms)
      });
      const before = (
        await pool.query(
          'SELECT snapshot::text AS snapshot,fingerprint FROM sponsorship_offers'
        )
      ).rows[0];
      for (const file of migrations.filter(
        (file) => Number(file.slice(0, 3)) >= 72
      ))
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );

      const read = (id) =>
        withPostgresTransaction(
          pool,
          (db) => loadSponsorshipCommitment(db, id),
          { readOnlySnapshot: true }
        );
      await t.test(
        'migration and later confirmation leave the historical offer and its three services intact',
        async () => {
          assert.deepEqual(
            (
              await pool.query(
                'SELECT snapshot::text AS snapshot,fingerprint FROM sponsorship_offers'
              )
            ).rows[0],
            before
          );
          await Promise.all([legacy.pay(), legacy.pay()]);
          const commitment = await read(legacy.id);
          assert.deepEqual(commitment.offer, legacyTerms);
          assert.equal(commitment.obligations.length, 3);
          assert.ok(
            commitment.obligations.every(
              (obligation) => !Object.hasOwn(obligation, 'minimumParticipants')
            )
          );
          assert.equal(
            sponsorshipOfferFingerprint(commitment.offer),
            before.fingerprint
          );
          await legacy.replay();
          assert.equal(legacy.providerCalls(), 1);
        }
      );

      for (const [amountMinor, count] of [
        [500, 3],
        [1000, 4],
        [1500, 5]
      ]) {
        await t.test(
          `${amountMinor} minor units activate exactly ${count} distinct recorded services`,
          async () => {
            const quote = quoteSponsorshipOffer(amountMinor, 'CAD');
            const current = await checkout(pool, quote);
            await Promise.all([current.pay(), current.pay()]);
            await current.replay();
            assert.equal(current.providerCalls(), 1);
            const commitment = await read(current.id);
            assert.equal(commitment.offer.version, 'sponsorship-v4');
            assert.equal(commitment.obligations.length, count);
            assert.equal(
              new Set(commitment.obligations.map((obligation) => obligation.id))
                .size,
              count
            );
            const collective = commitment.obligations.filter((obligation) =>
              obligation.benefitId.endsWith('_batch')
            );
            const individual = commitment.obligations.filter((obligation) =>
              obligation.benefitId.endsWith('_individual')
            );
            assert.equal(collective.length, 2);
            assert.ok(
              collective.every(
                (obligation) => obligation.minimumParticipants === 2
              )
            );
            assert.equal(individual.length, count - 3);
            assert.ok(
              individual.every(
                (obligation) => obligation.format === 'individual_text'
              )
            );
            const participantFacts = (
              await pool.query(
                'SELECT minimum_participants FROM sponsorship_obligations WHERE contribution_id=$1',
                [current.id]
              )
            ).rows;
            assert.deepEqual(
              participantFacts.map((row) => row.minimum_participants).sort(),
              [1, 2, 2, ...Array(count - 3).fill(1)].sort()
            );
            if (individual.length) {
              const obligation = individual[0];
              await assert.rejects(
                withPostgresTransaction(pool, (db) =>
                  adjustSponsorshipObligation(
                    db,
                    {
                      requestId: randomUUID(),
                      obligationId: obligation.id,
                      expectedVersion: obligation.version,
                      confirmation: obligation.id,
                      kind: 'format',
                      format: 'collective_text',
                      reason: 'Synthetic incompatible format request'
                    },
                    'synthetic-owner'
                  )
                ),
                { code: 'FORMAT_UNAVAILABLE' }
              );
              assert.equal(
                (await read(current.id)).obligations.find(
                  (row) => row.id === obligation.id
                ).format,
                'individual_text'
              );
            }
          }
        );
      }
    } finally {
      await stop();
    }
  }
);
