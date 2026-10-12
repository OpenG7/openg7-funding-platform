import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createDurableCheckoutService,
  CheckoutOperationError
} from '../../dist/apps/funding-api/src/checkout-operations.service.js';
import {
  upsertCheckoutSessionFromWebhook,
  updateContributionStatusByPaymentIntent
} from '../../dist/apps/funding-api/src/contributions-write.repository.js';
import {
  recordCheckoutSponsorshipOffer,
  quoteSponsorshipOffer
} from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import { loadSponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import {
  qualifySponsorshipCommitment,
  adjustSponsorshipObligation
} from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { previewSponsorshipCommitmentAdoption } from '../../dist/apps/funding-api/src/sponsorship-commitments/adoption.js';
import { enqueueSponsorshipObligationNotification } from '../../dist/apps/funding-api/src/sponsorship-commitments.repository.js';
import { getSponsorshipFollowupByTokenHash } from '../../dist/apps/funding-api/src/sponsorship-followup.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'durable sponsorship offers, confirmed obligations and explicit historical qualification',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    try {
      const files = (await readdir('apps/funding-api/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files.filter((f) => Number(f.slice(0, 3)) < 41))
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );
      const historical = (
        await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,public_reference)
      VALUES('sponsorship_interest',50000,'cad','paid',NOW(),'SYNTHETIC-HISTORICAL') RETURNING id`)
      ).rows[0].id;
      for (const file of files.filter((f) => Number(f.slice(0, 3)) >= 41))
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
        'migration preserves historical facts and invents neither accepted offers nor obligations',
        async () => {
          const m = await read(historical);
          assert.equal(m.provenance, 'historical_unverified');
          assert.equal(m.state, 'needs_confirmation');
          assert.equal(m.offer, null);
          assert.deepEqual(m.obligations, []);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM sponsorship_offers'
              )
            ).rows[0].n,
            0
          );
        }
      );

      let currentQuote = quoteSponsorshipOffer(50000, 'CAD');
      const original = currentQuote;
      let preparations = 0,
        providerCalls = 0,
        loseResponse = true,
        prepared;
      const run = createDurableCheckoutService(pool, {
        checkout: {
          sessions: {
            create: async (params) => {
              providerCalls++;
              const offers = (
                await pool.query(
                  'SELECT snapshot FROM sponsorship_offers WHERE checkout_operation_id=$1',
                  [params.metadata.openg7CheckoutOperationId]
                )
              ).rows;
              assert.deepEqual(
                offers[0].snapshot,
                {
                  version: original.version,
                  amountMinor: original.amountMinor,
                  currency: original.currency,
                  benefits: original.benefits
                },
                'the offer must commit before Stripe is called'
              );
              assert.equal(
                (
                  await pool.query(
                    'SELECT count(*)::integer n FROM sponsorship_obligations'
                  )
                ).rows[0].n,
                0
              );
              if (loseResponse) {
                loseResponse = false;
                throw new Error('Synthetic uncertain provider response');
              }
              return {
                id: 'cs_commitment_fixture',
                url: 'https://checkout.example.invalid/fixture',
                payment_intent: 'pi_commitment_fixture'
              };
            }
          }
        }
      });
      const key = `synthetic-offer-${randomUUID()}`;
      const attempt = {
        key,
        requestHash: createHash('sha256').update(key).digest('hex'),
        prepare: (operationId) => {
          preparations++;
          if (currentQuote.fingerprint !== original.fingerprint)
            throw new CheckoutOperationError('SPONSORSHIP_OFFER_CHANGED', 409);
          const publicReference = `SYNTHETIC-${operationId}`;
          const metadata = {
            openg7CheckoutOperationId: operationId,
            publicReference,
            contributionType: 'sponsorship_interest'
          };
          prepared = { publicReference, quote: currentQuote };
          return {
            params: { mode: 'payment', metadata },
            record: {
              publicReference,
              contributionType: 'sponsorship_interest',
              amountCents: 50000,
              currency: 'cad',
              metadata,
              publicDisplayConsent: true,
              publicName: 'Synthetic business',
              displayAmountConsent: true,
              nonCharityAcknowledged: true,
              sponsorshipFollowupTokenHash: null
            }
          };
        },
        afterPrepare: (db, id) =>
          recordCheckoutSponsorshipOffer(db, id, prepared)
      };
      await t.test(
        'uncertain Checkout retains its accepted offer despite a later price change and creates no obligation before payment',
        async () => {
          await assert.rejects(run(attempt), {
            code: 'CHECKOUT_PROVIDER_UNAVAILABLE'
          });
          currentQuote = quoteSponsorshipOffer(50000, 'CAD', {
            minimumAmount: 50,
            presetAmounts: [50],
            benefits: {
              websiteMention: { minimumAmount: 50 },
              facebookBatch: { minimumAmount: 750 },
              linkedinBatch: { minimumAmount: 1000 }
            }
          });
          const outcomes = await Promise.allSettled([
            run(attempt),
            run(attempt)
          ]);
          const successful = outcomes.filter((r) => r.status === 'fulfilled');
          assert.ok(successful.length >= 1);
          for (const outcome of outcomes) {
            if (outcome.status === 'rejected')
              assert.equal(outcome.reason.code, 'CHECKOUT_IN_PROGRESS');
            else assert.deepEqual(outcome.value, successful[0].value);
          }
          assert.deepEqual(await run(attempt), successful[0].value);
          assert.equal(preparations, 1);
          assert.equal(providerCalls, 2);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM sponsorship_offers'
              )
            ).rows[0].n,
            1
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM sponsorship_commitments WHERE offer_id IS NOT NULL'
              )
            ).rows[0].n,
            0
          );
        }
      );
      const contributionId = (
        await pool.query(
          "SELECT id FROM fund_contributions WHERE stripe_session_id='cs_commitment_fixture'"
        )
      ).rows[0].id;
      await t.test(
        'PaymentIntent and Checkout confirmations, including concurrent replays, activate exactly one set from the original terms',
        async () => {
          await updateContributionStatusByPaymentIntent(pool, {
            stripePaymentIntentId: 'pi_commitment_fixture',
            status: 'paid',
            paidAtIso: '2026-10-11T12:00:00Z',
            notifyAdmin: true
          });
          const awaitingFacts = await read(contributionId);
          assert.equal(awaitingFacts.state, 'needs_confirmation');
          assert.equal(awaitingFacts.offer, null);
          assert.deepEqual(awaitingFacts.obligations, []);
          const sessionInput = {
            stripeSessionId: 'cs_commitment_fixture',
            stripePaymentIntentId: 'pi_commitment_fixture',
            publicReference: prepared.publicReference,
            contributionType: 'sponsorship_interest',
            amountCents: 50000,
            currency: 'cad',
            trustedPaymentFacts: {
              amountCents: 50000,
              currency: 'cad',
              publicReference: prepared.publicReference
            },
            metadata: {
              openg7CheckoutOperationId: (
                await pool.query(
                  'SELECT checkout_operation_id FROM sponsorship_offers WHERE public_reference=$1',
                  [prepared.publicReference]
                )
              ).rows[0].checkout_operation_id
            },
            publicDisplayConsent: true,
            publicName: 'Synthetic business',
            displayAmountConsent: true,
            nonCharityAcknowledged: true,
            sponsorshipFollowupTokenHash: null,
            status: 'paid',
            paidAtIso: '2026-10-11T12:00:00Z',
            emailPrivate: 'synthetic@example.invalid',
            notifyAdmin: true
          };
          await Promise.all([
            upsertCheckoutSessionFromWebhook(pool, sessionInput),
            upsertCheckoutSessionFromWebhook(pool, sessionInput),
            updateContributionStatusByPaymentIntent(pool, {
              stripePaymentIntentId: 'pi_commitment_fixture',
              status: 'paid',
              paidAtIso: sessionInput.paidAtIso,
              notifyAdmin: true
            })
          ]);
          const m = await read(contributionId);
          assert.equal(m.provenance, 'accepted_offer');
          assert.equal(m.offer.amountMinor, 50000);
          assert.equal(m.offer.benefits.length, 3);
          assert.equal(m.obligations.length, 3);
          assert.equal(
            m.obligations.find((o) => o.channel === 'website').format,
            null
          );
          assert.equal(
            m.obligations.find((o) => o.channel === 'facebook').format,
            'collective_text'
          );
          assert.ok(
            m.obligations.every(
              (o) => o.state === 'blocked' && o.fulfilmentEvidenceId === null
            )
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM sponsorship_commitments WHERE contribution_id=$1',
                [contributionId]
              )
            ).rows[0].n,
            1
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM contribution_activity WHERE contribution_id=$1',
                [contributionId]
              )
            ).rows[0].n,
            1
          );
        }
      );
      await t.test(
        'missing, malformed or foreign offer references never create promises or discard a confirmed payment',
        async () => {
          const operationId = (
            await pool.query(
              'SELECT checkout_operation_id FROM sponsorship_offers WHERE public_reference=$1',
              [prepared.publicReference]
            )
          ).rows[0].checkout_operation_id;
          for (const [label, metadata] of [
            ['legacy', {}],
            [
              'malformed',
              {
                openg7CheckoutOperationId:
                  '------------------------------------'
              }
            ],
            ['foreign', { openg7CheckoutOperationId: operationId }]
          ]) {
            const sessionId = `cs_commitment_${label}`;
            await upsertCheckoutSessionFromWebhook(pool, {
              stripeSessionId: sessionId,
              stripePaymentIntentId: `pi_commitment_${label}`,
              publicReference: `SYNTHETIC-${label}`,
              contributionType: 'sponsorship_interest',
              amountCents: 50000,
              currency: 'cad',
              trustedPaymentFacts: {
                amountCents: 50000,
                currency: 'cad',
                publicReference: `SYNTHETIC-${label}`
              },
              metadata,
              publicDisplayConsent: false,
              publicName: null,
              displayAmountConsent: false,
              nonCharityAcknowledged: true,
              sponsorshipFollowupTokenHash: null,
              status: 'paid',
              paidAtIso: '2026-10-11T12:00:00Z',
              emailPrivate: null
            });
            const row = (
              await pool.query(
                'SELECT id,status FROM fund_contributions WHERE stripe_session_id=$1',
                [sessionId]
              )
            ).rows[0];
            assert.equal(row.status, 'paid');
            const m = await read(row.id);
            assert.equal(m.state, 'needs_confirmation');
            assert.equal(m.offer, null);
            assert.deepEqual(m.obligations, []);
          }
        }
      );
      await t.test(
        'offer and adjustment history are immutable, and fulfilment cannot be claimed without evidence',
        async () => {
          await assert.rejects(
            pool.query("UPDATE sponsorship_offers SET version='rewritten'"),
            { code: '23514' }
          );
          await assert.rejects(pool.query('DELETE FROM sponsorship_offers'), {
            code: '23514'
          });
          await assert.rejects(
            pool.query(
              "UPDATE sponsorship_obligations SET state='fulfilled' WHERE contribution_id=$1",
              [contributionId]
            ),
            { code: '23514' }
          );
        }
      );
      await t.test(
        'historical qualification is explicit, atomic and idempotent without changing the financial fact',
        async () => {
          const request = {
            requestId: randomUUID(),
            contributionId: historical,
            expectedVersion: 1,
            confirmation: historical,
            reason: 'Synthetic historical agreement verified',
            evidenceReference: 'synthetic://agreement/qualified',
            offer: {
              ...original,
              version: 'historical-qualification-v1',
              benefits: [{ ...original.benefits[0], quantity: 2 }]
            }
          };
          const perform = () =>
            withPostgresTransaction(pool, (db) =>
              qualifySponsorshipCommitment(
                db,
                request,
                'admin:00000000-0000-4000-8000-000000000041'
              )
            );
          const [a, b] = await Promise.all([perform(), perform()]);
          assert.equal(a.id, b.id);
          assert.equal(a.provenance, 'qualified_historical');
          assert.equal(a.obligations.length, 2);
          assert.ok(a.obligations.every((o) => o.format === null));
          assert.equal(a.version, 2);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM sponsorship_commitment_changes WHERE request_id=$1',
                [request.requestId]
              )
            ).rows[0].n,
            1
          );
          await assert.rejects(
            withPostgresTransaction(pool, (db) =>
              qualifySponsorshipCommitment(
                db,
                { ...request, reason: 'Different agreement' },
                'admin:00000000-0000-4000-8000-000000000041'
              )
            ),
            { code: 'COMMITMENT_REQUEST_CONFLICT' }
          );
          assert.deepEqual(
            (
              await pool.query(
                'SELECT amount_cents,currency,status FROM fund_contributions WHERE id=$1',
                [historical]
              )
            ).rows[0],
            { amount_cents: 50000, currency: 'cad', status: 'paid' }
          );
        }
      );
      await t.test(
        'destination adjustments and refunds preserve original promises and never fulfil an obligation',
        async () => {
          const before = await read(contributionId);
          const o = before.obligations.find((o) => o.channel === 'facebook');
          const request = {
            requestId: randomUUID(),
            obligationId: o.id,
            expectedVersion: o.version,
            confirmation: o.id,
            reason: 'Synthetic explicit destination agreement',
            kind: 'destination',
            target: 'openg20'
          };
          const perform = () =>
            withPostgresTransaction(pool, (db) =>
              adjustSponsorshipObligation(
                db,
                request,
                'admin:00000000-0000-4000-8000-000000000041'
              )
            );
          await Promise.all([perform(), perform()]);
          const adjusted = await read(contributionId);
          assert.equal(
            adjusted.obligations.find((x) => x.id === o.id).target,
            'openg20'
          );
          assert.equal(
            adjusted.offer.benefits.find((b) => b.id === o.benefitId).target,
            'openg7'
          );
          await updateContributionStatusByPaymentIntent(pool, {
            stripePaymentIntentId: 'pi_commitment_fixture',
            status: 'refunded'
          });
          const refunded = await read(contributionId);
          assert.equal(refunded.offer.amountMinor, 50000);
          assert.equal(refunded.obligations.length, 3);
          assert.ok(
            refunded.obligations.every(
              (o) =>
                o.state === 'blocked' && o.blockedReason === 'payment_refunded'
            )
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM sponsorship_commitment_changes WHERE request_id=$1',
                [request.requestId]
              )
            ).rows[0].n,
            1
          );
          await assert.rejects(
            pool.query(
              "UPDATE sponsorship_commitment_changes SET reason='rewritten'"
            ),
            { code: '23514' }
          );
          const notice = (
            await pool.query(
              "SELECT id,text_body,status FROM email_messages WHERE template_key='sponsorship_obligation' AND metadata->>'eventId'=$1",
              [request.requestId]
            )
          ).rows;
          assert.equal(notice.length, 1);
          assert.equal(notice[0].status, 'queued');
          assert.doesNotMatch(
            notice[0].text_body,
            /Synthetic explicit destination agreement|admin:/
          );
          const current = adjusted.obligations.find((x) => x.id === o.id);
          const falseNotice = await withPostgresTransaction(pool, (db) =>
            enqueueSponsorshipObligationNotification(db, {
              event: 'terms_changed',
              eventId: randomUUID(),
              obligationId: o.id,
              obligationVersion: current.version
            })
          );
          assert.equal(
            falseNotice,
            null,
            'a caller cannot invent a commercial event'
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer n FROM email_messages WHERE template_key='sponsorship_obligation'"
              )
            ).rows[0].n,
            1
          );
        }
      );
      await t.test(
        'an explicit format adjustment is idempotent, versioned and leaves the accepted offer untouched',
        async () => {
          const before = await read(contributionId);
          const o = before.obligations.find((o) => o.channel === 'facebook');
          const request = {
            requestId: randomUUID(),
            obligationId: o.id,
            expectedVersion: o.version,
            confirmation: o.id,
            reason: 'Synthetic explicit portrait agreement',
            kind: 'format',
            format: 'individual_portrait'
          };
          const perform = (input = request) =>
            withPostgresTransaction(pool, (db) =>
              adjustSponsorshipObligation(
                db,
                input,
                'admin:00000000-0000-4000-8000-000000000041'
              )
            );
          const [a, b] = await Promise.all([perform(), perform()]);
          assert.deepEqual(a, b);
          const changed = a.obligations.find((x) => x.id === o.id);
          assert.equal(changed.format, 'individual_portrait');
          assert.equal(changed.version, o.version + 1);
          assert.equal(changed.state, 'blocked');
          assert.equal(changed.blockedReason, 'payment_refunded');
          assert.equal(
            a.offer.benefits.find((x) => x.id === o.benefitId).format,
            'collective_text'
          );
          const history = (
            await pool.query(
              'SELECT kind,previous_value,resulting_value FROM sponsorship_commitment_changes WHERE request_id=$1',
              [request.requestId]
            )
          ).rows;
          assert.equal(history.length, 1);
          assert.equal(history[0].kind, 'format');
          assert.equal(history[0].previous_value.format, 'collective_text');
          assert.equal(
            history[0].resulting_value.format,
            'individual_portrait'
          );
          const noticeCount = (
            await pool.query(
              "SELECT count(*)::integer n FROM email_messages WHERE template_key='sponsorship_obligation' AND metadata->>'eventId'=$1",
              [request.requestId]
            )
          ).rows[0].n;
          assert.equal(noticeCount, 1);
          const dbBefore = (
            await pool.query(
              'SELECT version,publication_format FROM sponsorship_obligations WHERE id=$1',
              [o.id]
            )
          ).rows[0];
          await assert.rejects(
            perform({
              ...request,
              requestId: randomUUID(),
              expectedVersion: changed.version,
              format: 'image_collection'
            }),
            { code: 'FORMAT_UNAVAILABLE' }
          );
          assert.deepEqual(
            (
              await pool.query(
                'SELECT version,publication_format FROM sponsorship_obligations WHERE id=$1',
                [o.id]
              )
            ).rows[0],
            dbBefore
          );
          await assert.rejects(
            perform({ ...request, format: 'collective_composite' }),
            { code: 'COMMITMENT_REQUEST_CONFLICT' }
          );
        }
      );
      await t.test(
        'private tokens expose only their current obligations and never reinterpret the accepted offer',
        async () => {
          const tokenHash = createHash('sha256')
            .update('synthetic-private-commitment-token')
            .digest('hex');
          await pool.query(
            'UPDATE fund_contributions SET sponsorship_followup_token_hash=$2,sponsorship_followup_token_created_at=NOW() WHERE id=$1',
            [contributionId, tokenHash]
          );
          const followup = await getSponsorshipFollowupByTokenHash(
            pool,
            tokenHash,
            '2020-01-01T00:00:00Z'
          );
          assert.equal(followup.contributionId, contributionId);
          const current = followup.commitment.obligations.find(
            (o) => o.channel === 'facebook'
          );
          assert.equal(current.target, 'openg20');
          assert.equal(current.format, 'individual_portrait');
          assert.equal(current.blockedReason, 'payment_refunded');
          assert.equal(
            followup.commitment.offer.benefits.find(
              (b) => b.channel === 'facebook'
            ).target,
            'openg7'
          );
          assert.equal(
            followup.commitment.offer.benefits.find(
              (b) => b.channel === 'facebook'
            ).format,
            'collective_text'
          );
          assert.equal(
            await getSponsorshipFollowupByTokenHash(
              pool,
              'foreign-synthetic-token',
              '2020-01-01T00:00:00Z'
            ),
            null
          );
          assert.doesNotMatch(
            JSON.stringify(followup.commitment),
            /admin:|Synthetic explicit|qualification_reason|evidenceReference|contributionId|commitmentId/
          );
          assert.deepEqual(followup.fulfilmentEvidence, []);
        }
      );
      await t.test(
        'historical owner inventory reports observations without changing commercial or moderation history',
        async () => {
          const legacyId = (
            await pool.query(
              "SELECT id FROM fund_contributions WHERE stripe_session_id='cs_commitment_legacy'"
            )
          ).rows[0].id;
          const batchId = (
            await pool.query(
              "INSERT INTO sponsor_publication_batches(channel,capacity,status) VALUES('facebook',1,'published') RETURNING id"
            )
          ).rows[0].id;
          // A synthetic historical declaration, not a provider result or qualified fulfilment.
          await pool.query(
            "INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,source_snapshot,account_id,mode,status) VALUES('openg7:facebook','sponsorship',$1,'Synthetic historical declaration',NOW(),$2::jsonb,'synthetic-account','mock','published')",
            [
              batchId,
              JSON.stringify([
                {
                  id: randomUUID(),
                  contribution_id: legacyId,
                  title: 'Synthetic legacy source',
                  body: 'Synthetic historical text',
                  disclosure_text: 'Synthetic sponsorship',
                  feed_target: 'openg7',
                  channel: 'facebook'
                }
              ])
            ]
          );
          const before = (
            await pool.query(`SELECT (SELECT count(*) FROM sponsorship_offers)::integer offers,
        (SELECT count(*) FROM sponsorship_commitment_changes)::integer changes,(SELECT count(*) FROM moderation_decisions)::integer decisions`)
          ).rows[0];
          const preview = await withPostgresTransaction(
            pool,
            (db) => previewSponsorshipCommitmentAdoption(db),
            { readOnlySnapshot: true }
          );
          assert.equal(
            preview.items.find((r) => r.contributionId === historical)
              .classification,
            'qualified_historical'
          );
          assert.equal(
            preview.items.find((r) => r.contributionId === contributionId)
              .classification,
            'accepted_snapshot'
          );
          assert.ok(
            preview.items.some((r) => r.classification === 'unqualified')
          );
          const declaration = preview.items.find(
            (r) => r.contributionId === legacyId
          );
          assert.equal(declaration.classification, 'legacy_declarations');
          assert.equal(declaration.historicalDeclarationCount, 1);
          assert.equal(declaration.obligationCount, 0);
          assert.equal(declaration.fulfilledWithEvidenceCount, 0);
          assert.ok(
            preview.items.every((r) => r.fulfilledWithEvidenceCount === 0)
          );
          assert.doesNotMatch(
            JSON.stringify(preview),
            /email|synthetic@example|synthetic:\/\/|agreement|internal_reason|sponsor_message/
          );
          assert.deepEqual(
            (
              await pool.query(`SELECT (SELECT count(*) FROM sponsorship_offers)::integer offers,
        (SELECT count(*) FROM sponsorship_commitment_changes)::integer changes,(SELECT count(*) FROM moderation_decisions)::integer decisions`)
            ).rows[0],
            before
          );
        }
      );
      await t.test(
        'a failed transaction before Stripe leaves neither a prepared operation nor an orphan offer',
        async () => {
          const failedKey = `synthetic-rollback-${randomUUID()}`;
          const priorCalls = providerCalls;
          await assert.rejects(
            run({
              ...attempt,
              key: failedKey,
              requestHash: createHash('sha256').update(failedKey).digest('hex'),
              prepare: (id) => {
                const record = {
                  publicReference: `SYNTHETIC-ROLLBACK-${id}`,
                  contributionType: 'sponsorship_interest',
                  amountCents: 50000,
                  currency: 'cad',
                  metadata: { openg7CheckoutOperationId: id },
                  publicDisplayConsent: false,
                  publicName: null,
                  displayAmountConsent: false,
                  nonCharityAcknowledged: true,
                  sponsorshipFollowupTokenHash: null
                };
                return {
                  params: { mode: 'payment', metadata: record.metadata },
                  record
                };
              },
              afterPrepare: async (db, id) => {
                await recordCheckoutSponsorshipOffer(db, id, {
                  publicReference: `SYNTHETIC-ROLLBACK-${id}`,
                  quote: original
                });
                throw new Error('Synthetic acceptance storage failure');
              }
            }),
            { code: 'CHECKOUT_STORAGE_UNAVAILABLE' }
          );
          assert.equal(providerCalls, priorCalls);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer n FROM sponsorship_offers WHERE public_reference LIKE 'SYNTHETIC-ROLLBACK-%'"
              )
            ).rows[0].n,
            0
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM checkout_operations WHERE key_hash=$1',
                [createHash('sha256').update(failedKey).digest('hex')]
              )
            ).rows[0].n,
            0
          );
        }
      );
    } finally {
      await stop();
    }
  }
);
