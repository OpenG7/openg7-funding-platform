import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  DEFAULT_SPONSORSHIP_PRICING_CONFIG,
  createSponsorshipOfferSnapshot
} from '../../dist/packages/funding-core/src/index.js';
import {
  getSponsorshipFollowupByTokenHash,
  listSponsorshipsForAttention,
  updateSponsorshipPublication
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { detectPublicationPreparationItems } from '../../dist/apps/funding-api/src/admin-assistant/attention.service.js';
import { formatRecordedSponsorshipBenefits } from '../../dist/apps/funding-api/src/sponsorship-benefits.js';
import { qualifySponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import {
  quoteSponsorshipOffer,
  recordCheckoutSponsorshipOffer
} from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import { createSponsorshipObligations } from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'follow-up, publication settings, email descriptions and admin attention use recorded sponsorship terms',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const seed = async (
      amountMinor,
      paymentStatus = 'paid',
      recordOffer = true,
      historicalOffer = null
    ) => {
      const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
      const {
        rows: [row]
      } = await pool.query(
        `
      INSERT INTO fund_contributions
        (contribution_type, amount_cents, currency, status, paid_at,
         sponsor_review_status, sponsorship_followup_token_hash,
         sponsorship_followup_token_created_at)
      VALUES ('sponsorship_interest', $1, 'cad', $2, NOW(), 'approved', $3, NOW())
      RETURNING id, updated_at::text AS version
    `,
        [amountMinor, paymentStatus, tokenHash]
      );
      await pool.query(
        `INSERT INTO sponsorship_commitments(contribution_id,provenance,state,qualification_reason)
         VALUES($1,'historical_unverified','needs_confirmation','synthetic agreement pending review')`,
        [row.id]
      );
      if (recordOffer) {
        if (historicalOffer) {
          await withPostgresTransaction(pool, (db) =>
            qualifySponsorshipCommitment(
              db,
              {
                requestId: randomUUID(),
                contributionId: row.id,
                expectedVersion: 1,
                confirmation: row.id,
                reason:
                  'The explicit synthetic historical agreement was verified',
                evidenceReference: 'synthetic://benefit-policy-agreement',
                offer: historicalOffer
              },
              'admin:00000000-0000-4000-8000-000000000004'
            )
          );
        } else {
          // This fixture records an explicit accepted quote, not a historical
          // agreement inferred during a read. Payment activation has its own suite.
          const quote = quoteSponsorshipOffer(amountMinor, 'CAD');
          await withPostgresTransaction(pool, async (db) => {
            const operationId = randomUUID();
            await db.query(
              `INSERT INTO checkout_operations(id,key_hash,request_hash,state,params,contribution_input)
               VALUES($1,$2,$2,'prepared','{}','{}')`,
              [
                operationId,
                createHash('sha256').update(operationId).digest('hex')
              ]
            );
            await recordCheckoutSponsorshipOffer(db, operationId, {
              publicReference: row.id,
              quote
            });
            const commitment = (
              await db.query(
                `UPDATE sponsorship_commitments SET offer_id=(SELECT id FROM sponsorship_offers WHERE checkout_operation_id=$2),
                  provenance='accepted_offer',state='active',qualification_reason=NULL,activated_at=NOW()
                 WHERE contribution_id=$1 RETURNING id`,
                [row.id, operationId]
              )
            ).rows[0];
            await createSponsorshipObligations(
              db,
              commitment.id,
              row.id,
              quote
            );
          });
        }
      }
      return { ...row, tokenHash };
    };
    const followup = (row) =>
      getSponsorshipFollowupByTokenHash(
        pool,
        row.tokenHash,
        '2000-01-01T00:00:00.000Z'
      );
    const save = (row, feedChannels = []) =>
      updateSponsorshipPublication(pool, {
        contributionId: row.id,
        expectedVersion: row.version,
        publicSlug: null,
        publicSummary: null,
        feedTarget: null,
        feedStatus: 'not_planned',
        feedChannels
      });
    const attention = async (id, drafts = []) => {
      const records = await listSponsorshipsForAttention(pool, null, id);
      return detectPublicationPreparationItems({
        now: new Date(),
        sponsorships: records.items,
        drafts
      });
    };

    await t.test(
      'explicit quoted agreements retain the same minor-unit boundaries across consumers',
      async () => {
        for (const [amountMinor, tier, benefits, channels] of [
          [499, null, [], []],
          [
            500,
            'collective',
            ['website_mention', 'facebook_batch', 'linkedin_batch'],
            ['facebook', 'linkedin']
          ],
          [
            999,
            'collective',
            ['website_mention', 'facebook_batch', 'linkedin_batch'],
            ['facebook', 'linkedin']
          ],
          [
            1000,
            'facebook_individual',
            [
              'website_mention',
              'facebook_batch',
              'linkedin_batch',
              'facebook_individual'
            ],
            ['facebook', 'linkedin']
          ],
          [
            1499,
            'facebook_individual',
            [
              'website_mention',
              'facebook_batch',
              'linkedin_batch',
              'facebook_individual'
            ],
            ['facebook', 'linkedin']
          ],
          [
            1500,
            'facebook_linkedin_individual',
            [
              'website_mention',
              'facebook_batch',
              'linkedin_batch',
              'facebook_individual',
              'linkedin_individual'
            ],
            ['facebook', 'linkedin']
          ]
        ]) {
          if (tier === null) {
            assert.throws(
              () => createSponsorshipOfferSnapshot(amountMinor, 'CAD'),
              /below the minimum/
            );
          }
          const row = await seed(amountMinor, 'paid', tier !== null);
          const data = await followup(row);
          assert.equal(data.sponsorshipTier, tier);
          assert.deepEqual(data.sponsorshipBenefits, benefits);
          assert.equal(data.commitment.obligations.length, benefits.length);
          const saved = await save(row);
          assert.equal(saved.updated, true);
          assert.deepEqual(saved.feedChannels, channels);
          const items = await attention(row.id);
          assert.equal(items.length, channels.length ? 1 : 0);
          if (items.length) {
            assert.equal(items[0].facts.promisedChannels, channels.join(', '));
            assert.equal(items[0].facts.missingChannels, channels.join(', '));
          }
          const descriptions = formatRecordedSponsorshipBenefits(
            data.commitment.offer
          );
          assert.equal(
            descriptions.some((text) => text.includes('Facebook')),
            channels.includes('facebook')
          );
          assert.equal(
            descriptions.some((text) => text.includes('LinkedIn')),
            channels.includes('linkedin')
          );
          const state = (
            await pool.query(
              'SELECT status, sponsor_review_status, sponsor_feed_status FROM fund_contributions WHERE id=$1',
              [row.id]
            )
          ).rows[0];
          assert.equal(state.status, 'paid');
          assert.equal(state.sponsor_review_status, 'approved');
          assert.equal(state.sponsor_feed_status, 'not_planned');
        }
      }
    );

    await t.test(
      'manual channels and active drafts retain their separate meaning',
      async () => {
        const row = await seed(50000);
        const saved = await save(row, ['linkedin', 'linkedin']);
        assert.deepEqual(saved.feedChannels, ['linkedin', 'facebook']);
        const covered = await attention(row.id, [
          {
            contribution_id: row.id,
            feed_target: 'openg7',
            channel: 'facebook',
            status: 'draft'
          }
        ]);
        assert.equal(covered[0].facts.missingChannels, 'facebook, linkedin');
        const facebookObligations = (
          await followup(row)
        ).commitment.obligations.filter(
          (obligation) => obligation.channel === 'facebook'
        );
        assert.equal(facebookObligations.length, 2);
        const fullyPreparedFacebook = await attention(
          row.id,
          facebookObligations.map((obligation) => ({
            id: `synthetic-draft-${obligation.id}`,
            contribution_id: row.id,
            obligation_id: obligation.id,
            feed_target: 'openg7',
            channel: 'facebook',
            status: 'draft'
          }))
        );
        assert.equal(
          fullyPreparedFacebook[0].facts.missingChannels,
          'linkedin'
        );
        const rejected = await attention(row.id, [
          {
            contribution_id: row.id,
            feed_target: 'openg7',
            channel: 'facebook',
            status: 'rejected'
          }
        ]);
        assert.equal(rejected[0].facts.missingChannels, 'facebook, linkedin');
        for (const status of ['refunded', 'disputed']) {
          const ineligible = await seed(50000, status);
          const result = await save(ineligible, ['linkedin']);
          assert.equal(result.updated, false);
          assert.equal(result.status, 'payment_not_eligible');
          assert.deepEqual(result.feedChannels, ['linkedin']);
          const persisted = (
            await pool.query(
              'SELECT sponsor_feed_channels FROM fund_contributions WHERE id=$1',
              [ineligible.id]
            )
          ).rows[0];
          assert.deepEqual(persisted.sponsor_feed_channels, []);
          assert.deepEqual(await attention(ineligible.id), []);
        }
      }
    );

    await t.test(
      'changing active pricing affects new agreements and preserves already recorded terms',
      async () => {
        const facebook =
          DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits.facebookIndividual;
        const originalMinimum = facebook.minimumAmount;
        const existing = await seed(500);
        const recorded = await followup(existing);
        assert.equal(recorded.sponsorshipTier, 'collective');
        try {
          facebook.minimumAmount = 5;
          const unchanged = await followup(existing);
          assert.deepEqual(
            unchanged.commitment.offer,
            recorded.commitment.offer
          );
          assert.equal(unchanged.sponsorshipTier, 'collective');
          assert.deepEqual((await save(existing)).feedChannels, [
            'facebook',
            'linkedin'
          ]);
          assert.equal(
            (await attention(existing.id))[0].facts.promisedChannels,
            'facebook, linkedin'
          );
          assert.equal(
            formatRecordedSponsorshipBenefits(unchanged.commitment.offer).some(
              (text) => text.includes('individuelle')
            ),
            false
          );
          const row = await seed(500);
          const data = await followup(row);
          assert.equal(data.sponsorshipTier, 'facebook_individual');
          assert.deepEqual(data.sponsorshipBenefits, [
            'website_mention',
            'facebook_batch',
            'linkedin_batch',
            'facebook_individual'
          ]);
          assert.deepEqual((await save(row)).feedChannels, [
            'facebook',
            'linkedin'
          ]);
          assert.equal(
            (await attention(row.id))[0].facts.promisedChannels,
            'facebook, linkedin'
          );
          assert.ok(
            formatRecordedSponsorshipBenefits(data.commitment.offer).some(
              (text) =>
                text.includes('individuelle') && text.includes('Facebook')
            )
          );
        } finally {
          facebook.minimumAmount = originalMinimum;
        }
      }
    );
    await t.test(
      'explicit historical agreements retain their old tier and one collective passage per channel',
      async () => {
        const historicalOffer = {
          version: 'historical-qualification-v1',
          amountMinor: 50000,
          currency: 'CAD',
          benefits: [
            ['website_mention', 'website'],
            ['facebook_batch', 'facebook'],
            ['linkedin_batch', 'linkedin']
          ].map(([id, channel]) => ({
            id,
            channel,
            target: 'openg7',
            quantity: 1,
            requiredElements: ['company_name'],
            deadlineDays: null,
            durationDays: null,
            ...(channel === 'website' ? {} : { format: 'collective_text' })
          }))
        };
        const row = await seed(50000, 'paid', true, historicalOffer);
        const data = await followup(row);
        assert.equal(data.sponsorshipTier, 'website_facebook_linkedin');
        assert.deepEqual(data.commitment.offer, historicalOffer);
        assert.equal(data.commitment.obligations.length, 3);
        assert.ok(
          data.commitment.obligations.every(
            (obligation) => !Object.hasOwn(obligation, 'minimumParticipants')
          )
        );
      }
    );
    await t.test(
      'unqualified historical records acquire no promises from current pricing',
      async () => {
        const row = await seed(50000, 'paid', false);
        const data = await followup(row);
        assert.equal(data.sponsorshipTier, null);
        assert.deepEqual(data.sponsorshipBenefits, []);
        assert.equal(data.commitment.state, 'needs_confirmation');
        assert.equal(data.commitment.offer, null);
        assert.deepEqual(data.commitment.obligations, []);
        assert.deepEqual((await save(row)).feedChannels, []);
        assert.deepEqual(await attention(row.id), []);
        assert.deepEqual(
          formatRecordedSponsorshipBenefits(data.commitment.offer),
          [
            'Engagements à qualifier : aucune offre enregistrée pour ce dossier.'
          ]
        );
      }
    );
  }
);
