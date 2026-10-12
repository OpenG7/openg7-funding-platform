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
      recordOffer = true
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
        // These quoted terms are explicit synthetic agreement input. Existing
        // records never derive an agreement from their amount on a later read.
        const offer = {
          ...createSponsorshipOfferSnapshot(amountMinor, 'CAD'),
          version: 'historical-qualification-v1'
        };
        await withPostgresTransaction(pool, (db) =>
          qualifySponsorshipCommitment(
            db,
            {
              requestId: randomUUID(),
              contributionId: row.id,
              expectedVersion: 1,
              confirmation: row.id,
              reason:
                'The synthetic agreement explicitly records the supplied quote',
              evidenceReference: 'synthetic://benefit-policy-agreement',
              offer
            },
            'admin:00000000-0000-4000-8000-000000000004'
          )
        );
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
          [4999, null, [], []],
          [5000, 'website_only', ['website_mention'], []],
          [24999, 'website_only', ['website_mention'], []],
          [
            25000,
            'website_facebook',
            ['website_mention', 'facebook_batch'],
            ['facebook']
          ],
          [
            49999,
            'website_facebook',
            ['website_mention', 'facebook_batch'],
            ['facebook']
          ],
          [
            50000,
            'website_facebook_linkedin',
            ['website_mention', 'facebook_batch', 'linkedin_batch'],
            ['facebook', 'linkedin']
          ],
          [
            75000,
            'website_facebook_linkedin',
            ['website_mention', 'facebook_batch', 'linkedin_batch'],
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
        assert.equal(covered[0].facts.missingChannels, 'linkedin');
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
          DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits.facebookBatch;
        const originalMinimum = facebook.minimumAmount;
        const existing = await seed(20000);
        const recorded = await followup(existing);
        assert.equal(recorded.sponsorshipTier, 'website_only');
        try {
          facebook.minimumAmount = 200;
          const unchanged = await followup(existing);
          assert.deepEqual(
            unchanged.commitment.offer,
            recorded.commitment.offer
          );
          assert.equal(unchanged.sponsorshipTier, 'website_only');
          assert.deepEqual((await save(existing)).feedChannels, []);
          assert.deepEqual(await attention(existing.id), []);
          assert.equal(
            formatRecordedSponsorshipBenefits(unchanged.commitment.offer).some(
              (text) => text.includes('Facebook')
            ),
            false
          );
          const row = await seed(20000);
          const data = await followup(row);
          assert.equal(data.sponsorshipTier, 'website_facebook');
          assert.deepEqual(data.sponsorshipBenefits, [
            'website_mention',
            'facebook_batch'
          ]);
          assert.deepEqual((await save(row)).feedChannels, ['facebook']);
          assert.equal(
            (await attention(row.id))[0].facts.promisedChannels,
            'facebook'
          );
          assert.ok(
            formatRecordedSponsorshipBenefits(data.commitment.offer).some(
              (text) => text.includes('Facebook')
            )
          );
        } finally {
          facebook.minimumAmount = originalMinimum;
        }
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
