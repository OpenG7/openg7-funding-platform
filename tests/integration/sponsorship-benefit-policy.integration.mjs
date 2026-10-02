import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { DEFAULT_SPONSORSHIP_PRICING_CONFIG } from '../../dist/packages/funding-core/src/index.js';
import {
  getSponsorshipFollowupByTokenHash,
  listSponsorshipsForAttention,
  updateSponsorshipPublication
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { detectPublicationPreparationItems } from '../../dist/apps/funding-api/src/admin-assistant/attention.service.js';
import { formatSponsorshipBenefitList } from '../../dist/apps/funding-api/src/sponsorship-benefits.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'follow-up, publication settings, email descriptions and admin attention use the shared sponsorship policy',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const seed = async (amountMinor, paymentStatus = 'paid') => {
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
      'minor-unit boundaries retain the same tiers, benefits and social channels across consumers',
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
          const row = await seed(amountMinor);
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
          const descriptions = formatSponsorshipBenefitList(
            data.amount,
            data.currency
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
          { contribution_id: row.id, channel: 'facebook', status: 'draft' }
        ]);
        assert.equal(covered[0].facts.missingChannels, 'linkedin');
        const rejected = await attention(row.id, [
          { contribution_id: row.id, channel: 'facebook', status: 'rejected' }
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
      'changing the active shared threshold reaches every API consumer without a copied barème',
      async () => {
        const facebook =
          DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits.facebookBatch;
        const originalMinimum = facebook.minimumAmount;
        try {
          facebook.minimumAmount = 200;
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
            formatSponsorshipBenefitList(data.amount, data.currency).some(
              (text) => text.includes('Facebook')
            )
          );
        } finally {
          facebook.minimumAmount = originalMinimum;
        }
      }
    );
  }
);
