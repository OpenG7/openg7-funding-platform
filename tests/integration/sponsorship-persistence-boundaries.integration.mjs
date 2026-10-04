import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  clearSponsorshipLogoUrl,
  getAdminSponsorshipById,
  getAdminSponsorshipLogoUrl,
  getSponsorshipFollowupByTokenHash,
  getSponsorshipRefundTarget,
  insertStripeEventRecord,
  isPublicApprovedSponsorshipLogoUrl,
  listAdminSponsorships,
  listPublicSponsorships,
  listSponsorshipsForAttention,
  lockSponsorshipContribution,
  markSponsorshipFollowupEmailResult,
  markStripeEventFailed,
  markStripeEventProcessed,
  recordSponsorshipDetails,
  recordSponsorshipDetailsForContribution,
  updateSponsorshipLogoUrl,
  updateSponsorshipPublication,
  updateSponsorshipRefundWorkflowStatus,
  updateSponsorshipRefundWorkflowStatusByPaymentIntent,
  updateSponsorshipReview
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'extracted sponsorship persistence preserves dossier decisions, privacy, refund recovery and caller transactions on PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const { pool } = db;
    const input = {
      stripeSessionId: 'cs_test_sponsorship_boundary',
      stripePaymentIntentId: 'pi_test_sponsorship_boundary',
      publicReference: 'OG7-SPONSORSHIP-BOUNDARY',
      amountCents: 100000,
      currency: 'CAD',
      publicDisplayConsent: true,
      displayAmountConsent: false,
      nonCharityAcknowledged: true,
      paidAtIso: '2026-09-01T12:00:00.000Z',
      companyName: 'Boundary Company',
      contactName: 'Boundary Contact',
      contactEmail: 'private-contact@example.invalid',
      websiteUrl: 'https://example.invalid/company',
      logoUrl: 'https://example.invalid/before.webp',
      message: 'PRIVATE FOLLOWUP MESSAGE'
    };
    assert.equal(await recordSponsorshipDetails(pool, input), true);
    const {
      rows: [seed]
    } = await pool.query(
      'SELECT id, updated_at::text AS version FROM fund_contributions WHERE stripe_session_id = $1',
      [input.stripeSessionId]
    );
    const id = seed.id;
    const tokenHash = createHash('sha256')
      .update('synthetic-followup-token')
      .digest('hex');
    await pool.query(
      `UPDATE fund_contributions SET sponsorship_followup_token_hash = $2,
        sponsorship_followup_token_created_at = '2026-09-01', email_private = $3
       WHERE id = $1`,
      [id, tokenHash, 'private-payer@example.invalid']
    );

    await t.test(
      'private follow-up lookup preserves expiry and normalized money without exposing it publicly',
      async () => {
        const lookup = await getSponsorshipFollowupByTokenHash(
          pool,
          tokenHash,
          '2026-08-01'
        );
        assert.equal(lookup.contributionId, id);
        assert.equal(lookup.contactEmail, input.contactEmail);
        assert.equal(lookup.emailPrivate, 'private-payer@example.invalid');
        assert.equal(lookup.message, input.message);
        assert.equal(lookup.amount, 1000);
        assert.equal(lookup.currency, 'CAD');
        assert.equal(lookup.reviewStatus, 'pending_review');
        assert.equal(lookup.detailsSubmitted, true);
        assert.equal(
          await getSponsorshipFollowupByTokenHash(
            pool,
            tokenHash,
            '2026-10-01'
          ),
          null
        );
        assert.equal(
          await getSponsorshipFollowupByTokenHash(
            pool,
            'unknown-hash',
            '2026-08-01'
          ),
          null
        );
        assert.deepEqual((await listPublicSponsorships(pool)).sponsorships, []);
        assert.equal(
          await markSponsorshipFollowupEmailResult(pool, {
            stripeSessionId: input.stripeSessionId,
            sentAtIso: '2026-09-02T12:00:00.000Z',
            error: null
          }),
          true
        );
        assert.equal(
          await markSponsorshipFollowupEmailResult(pool, {
            stripeSessionId: input.stripeSessionId,
            error: 'Synthetic delivery failure'
          }),
          true
        );
        const updated = await getSponsorshipFollowupByTokenHash(
          pool,
          tokenHash,
          '2026-08-01'
        );
        assert.equal(
          Date.parse(updated.emailSentAt),
          Date.parse('2026-09-02T12:00:00Z')
        );
        assert.equal(
          await markSponsorshipFollowupEmailResult(pool, {
            stripeSessionId: 'cs_test_missing',
            error: null
          }),
          false
        );
      }
    );

    await t.test(
      'dossier locking and follow-up writes stay in the caller transaction and roll back together',
      async () => {
        const owner = await pool.connect();
        const competitor = await pool.connect();
        try {
          await owner.query('BEGIN');
          assert.equal(await lockSponsorshipContribution(owner, id), true);
          await competitor.query('BEGIN');
          await competitor.query("SET LOCAL lock_timeout = '150ms'");
          await assert.rejects(
            competitor.query(
              'UPDATE fund_contributions SET sponsor_company_name = $2 WHERE id = $1',
              [id, 'Concurrent Fixture']
            ),
            (error) => error.code === '55P03'
          );
          await competitor.query('ROLLBACK');
          assert.equal(
            await recordSponsorshipDetailsForContribution(owner, {
              contributionId: id,
              companyName: 'Rolled Back Fixture',
              contactName: input.contactName,
              contactEmail: input.contactEmail,
              websiteUrl: input.websiteUrl,
              logoUrl: input.logoUrl,
              message: input.message
            }),
            true
          );
          await owner.query('ROLLBACK');
          assert.equal(
            (await getAdminSponsorshipById(pool, id)).sponsor_company_name,
            input.companyName
          );
          await competitor.query('BEGIN');
          assert.equal(await lockSponsorshipContribution(competitor, id), true);
          assert.equal(
            await lockSponsorshipContribution(
              competitor,
              '22222222-2222-4222-8222-222222222222'
            ),
            false
          );
          await competitor.query('ROLLBACK');
        } finally {
          await owner.query('ROLLBACK');
          await competitor.query('ROLLBACK');
          owner.release();
          competitor.release();
        }
      }
    );

    await t.test(
      'approval, publication metadata and website visibility remain distinct and versioned',
      async () => {
        const before = await getAdminSponsorshipById(pool, id);
        const request = {
          contributionId: id,
          expectedVersion: before.version,
          reviewStatus: 'approved',
          reviewNote: 'PRIVATE REVIEW NOTE'
        };
        assert.equal(
          (await updateSponsorshipReview(pool, request)).status,
          'media_required'
        );
        await pool.query(
          `INSERT INTO sponsor_media_assets
          (contribution_id, kind, review_status, original_filename, original_mime_type,
           original_size_bytes, original_storage_key, processed_size_bytes,
           processed_storage_key, public_storage_key, public_url, checksum_sha256, width, height)
         VALUES ($1, 'supporting_image', 'approved', 'fixture.png', 'image/png', 100,
           'private/boundary-photo', 80, 'processed/boundary-photo', 'public/boundary-photo',
           'https://example.invalid/photo.webp', repeat('a', 64), 100, 100)`,
          [id]
        );
        const approved = await updateSponsorshipReview(pool, request);
        assert.equal(approved.status, 'updated');
        assert.equal(
          (await updateSponsorshipReview(pool, request)).status,
          'conflict'
        );
        assert.deepEqual((await listPublicSponsorships(pool)).sponsorships, []);
        assert.equal(
          await isPublicApprovedSponsorshipLogoUrl(pool, input.logoUrl),
          false
        );
        const publication = {
          contributionId: id,
          expectedVersion: approved.currentVersion,
          publicSlug: ' boundary-company ',
          publicSummary: ' Public approved summary ',
          feedTarget: 'openg7',
          feedChannels: ['facebook'],
          feedStatus: 'published',
          feedPublicUrl: ' https://example.invalid/post ',
          feedNotes: ' PRIVATE FEED NOTE '
        };
        const published = await updateSponsorshipPublication(pool, publication);
        assert.equal(published.status, 'updated');
        assert.deepEqual(published.feedChannels, ['facebook', 'linkedin']);
        assert.equal(
          (await updateSponsorshipPublication(pool, publication)).status,
          'conflict'
        );
        assert.deepEqual((await listPublicSponsorships(pool)).sponsorships, []);
        const admin = await getAdminSponsorshipById(pool, id);
        assert.equal(admin.sponsor_review_status, 'approved');
        assert.equal(admin.sponsor_review_note, 'PRIVATE REVIEW NOTE');
        assert.equal(admin.sponsor_feed_notes, 'PRIVATE FEED NOTE');
        assert.equal(admin.sponsor_public_slug, 'boundary-company');
        const listed = await listAdminSponsorships(pool, {
          page: 1,
          pageSize: 12,
          search: id
        });
        assert.equal(listed.pagination.totalItems, 1);
        assert.equal(listed.items[0].id, id);
        assert.equal(listed.items[0].sponsor_contact_email, input.contactEmail);
        const attention = await listSponsorshipsForAttention(pool, null, id);
        assert.equal(attention.items.length, 1);
        assert.equal(attention.items[0].hasContactEmail, true);
        assert.equal(attention.items[0].hasSupportingImage, true);
        assert.equal(
          JSON.stringify(attention).includes(input.contactEmail),
          false
        );
        // Fixture a separately authorized website visibility decision.
        await pool.query(
          'UPDATE fund_contributions SET sponsor_site_visibility_held = FALSE WHERE id = $1',
          [id]
        );
        const publicList = await listPublicSponsorships(pool);
        assert.equal(publicList.pagination.total_count, 1);
        assert.equal(publicList.pagination.published_count, 1);
        assert.equal(
          publicList.sponsorships[0].public_id,
          createHash('sha256').update(`public-sponsor:${id}`).digest('hex')
        );
        assert.equal(publicList.sponsorships[0].amount, null);
        assert.equal(publicList.sponsorships[0].message, null);
        assert.equal(
          publicList.sponsorships[0].public_summary,
          'Public approved summary'
        );
        assert.equal(publicList.sponsorships[0].currency, 'CAD');
        for (const privateValue of [
          input.contactEmail,
          input.contactName,
          input.message,
          input.stripeSessionId,
          input.stripePaymentIntentId,
          'PRIVATE REVIEW NOTE',
          'PRIVATE FEED NOTE',
          'private-payer@example.invalid',
          tokenHash
        ]) {
          assert.equal(
            JSON.stringify(publicList).includes(privateValue),
            false,
            privateValue
          );
        }
        assert.equal(
          await isPublicApprovedSponsorshipLogoUrl(pool, input.logoUrl),
          true
        );
      }
    );

    await t.test(
      'logo writes retain historical results, persist changes and reject stale versions',
      async () => {
        const before = await getAdminSponsorshipById(pool, id);
        assert.equal(before.sponsor_logo_url, input.logoUrl);
        assert.equal(await getAdminSponsorshipLogoUrl(pool, id), input.logoUrl);
        const replacement = await updateSponsorshipLogoUrl(pool, {
          contributionId: id,
          expectedVersion: before.version,
          logoUrl: 'https://example.invalid/next.webp'
        });
        assert.equal(replacement.status, 'updated');
        // The historical CTE returns no previous URL after a successful write.
        assert.equal(replacement.previousLogoUrl, null);
        assert.equal(
          replacement.currentVersion,
          (await getAdminSponsorshipById(pool, id)).version
        );
        assert.equal(
          await getAdminSponsorshipLogoUrl(pool, id),
          'https://example.invalid/next.webp'
        );
        const stale = await clearSponsorshipLogoUrl(pool, {
          contributionId: id,
          expectedVersion: before.version
        });
        assert.equal(stale.status, 'conflict');
        assert.equal(stale.currentVersion, replacement.currentVersion);
        assert.equal(
          stale.previousLogoUrl,
          'https://example.invalid/next.webp'
        );
        const cleared = await clearSponsorshipLogoUrl(pool, {
          contributionId: id,
          expectedVersion: replacement.currentVersion
        });
        assert.equal(cleared.status, 'updated');
        assert.equal(cleared.previousLogoUrl, null);
        assert.equal(
          cleared.currentVersion,
          (await getAdminSponsorshipById(pool, id)).version
        );
        assert.equal(await getAdminSponsorshipLogoUrl(pool, id), null);
        assert.equal(
          await isPublicApprovedSponsorshipLogoUrl(pool, input.logoUrl),
          false
        );
        assert.equal(
          (
            await clearSponsorshipLogoUrl(pool, {
              contributionId: '22222222-2222-4222-8222-222222222222',
              expectedVersion: before.version
            })
          ).status,
          'not_found'
        );
      }
    );

    await t.test(
      'refund workflow keeps financial payment facts separate and preserves retry timestamps and references',
      async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          assert.equal(
            await updateSponsorshipRefundWorkflowStatus(client, {
              contributionId: id,
              refundStatus: 'requested',
              refundNote: 'Rolled back refund request'
            }),
            true
          );
          await client.query('ROLLBACK');
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
        assert.equal(
          (await getSponsorshipRefundTarget(pool, id)).refundWorkflowStatus,
          'not_requested'
        );
        for (const refundStatus of ['requested', 'processing', 'failed']) {
          assert.equal(
            await updateSponsorshipRefundWorkflowStatus(pool, {
              contributionId: id,
              refundStatus,
              refundAmountCents: 2345,
              refundReason: 'requested_by_customer',
              refundNote: 'PRIVATE REFUND NOTE',
              refundError:
                refundStatus === 'failed' ? 'Synthetic provider failure' : null
            }),
            true
          );
          const row = await getAdminSponsorshipById(pool, id);
          assert.equal(row.sponsorship_refund_status, refundStatus);
          assert.equal(row.sponsorship_refund_amount, 23.45);
          assert.ok(row.sponsorship_refund_requested_at);
          assert.equal(row.sponsorship_refund_completed_at, null);
          assert.equal(
            row.sponsorship_refund_error,
            refundStatus === 'failed' ? 'Synthetic provider failure' : null
          );
          if (refundStatus !== 'requested')
            assert.ok(row.sponsorship_refund_processed_at);
        }
        const before = await getAdminSponsorshipById(pool, id);
        assert.equal(
          await updateSponsorshipRefundWorkflowStatusByPaymentIntent(pool, {
            stripePaymentIntentId: input.stripePaymentIntentId,
            refundStatus: 'completed',
            refundId: 're_test_boundary'
          }),
          true
        );
        const complete = await getAdminSponsorshipById(pool, id);
        assert.equal(
          complete.sponsorship_refund_requested_at,
          before.sponsorship_refund_requested_at
        );
        assert.equal(
          complete.sponsorship_refund_processed_at,
          before.sponsorship_refund_processed_at
        );
        assert.ok(complete.sponsorship_refund_completed_at);
        assert.equal(complete.sponsorship_refund_error, null);
        assert.equal(complete.sponsorship_refund_note, 'PRIVATE REFUND NOTE');
        assert.equal(complete.sponsorship_refund_amount, 23.45);
        const target = await getSponsorshipRefundTarget(pool, id);
        assert.equal(target.refundWorkflowStatus, 'completed');
        assert.equal(target.refundId, 're_test_boundary');
        assert.equal(target.paymentStatus, 'paid');
        assert.equal(target.amountCents, 100000);
        assert.equal(target.amount, 1000);
        assert.equal(target.currency, 'CAD');
        assert.equal(
          await updateSponsorshipRefundWorkflowStatusByPaymentIntent(pool, {
            stripePaymentIntentId: 'pi_test_missing',
            refundStatus: 'failed'
          }),
          false
        );
      }
    );

    await t.test(
      'a new private dossier submission resets review without changing confirmed money or creating another contribution',
      async () => {
        assert.equal(
          await recordSponsorshipDetailsForContribution(pool, {
            contributionId: id,
            companyName: input.companyName,
            contactName: input.contactName,
            contactEmail: input.contactEmail,
            websiteUrl: input.websiteUrl,
            logoUrl: null,
            message: 'PRIVATE UPDATED MESSAGE'
          }),
          true
        );
        const resubmitted = await getAdminSponsorshipById(pool, id);
        assert.equal(resubmitted.sponsor_review_status, 'pending_review');
        assert.equal(resubmitted.sponsor_reviewed_at, null);
        assert.equal(resubmitted.payment_status, 'paid');
        assert.equal(resubmitted.amount, 1000);
        assert.deepEqual((await listPublicSponsorships(pool)).sponsorships, []);
        assert.equal(
          await recordSponsorshipDetails(pool, {
            ...input,
            amountCents: 25000,
            publicReference: 'OG7-IGNORED-DUPLICATE'
          }),
          true
        );
        const replayed = await getAdminSponsorshipById(pool, id);
        assert.equal(replayed.public_reference, input.publicReference);
        assert.equal(replayed.amount, 1000);
        assert.equal(replayed.sponsor_review_status, 'pending_review');
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM fund_contributions'
            )
          ).rows[0].count,
          1
        );
      }
    );

    await t.test(
      'simple Stripe records deduplicate processing and processed deliveries while recovering failed records',
      async () => {
        const event = {
          stripeEventId: 'evt_test_sponsorship_boundary',
          eventType: 'checkout.session.completed',
          payload: { fixture: 'original' }
        };
        assert.equal(await insertStripeEventRecord(pool, event), true);
        assert.equal(await insertStripeEventRecord(pool, event), false);
        await markStripeEventFailed(pool, event.stripeEventId);
        assert.equal(
          await insertStripeEventRecord(pool, {
            ...event,
            payload: { fixture: 'retry' }
          }),
          true
        );
        await markStripeEventProcessed(pool, event.stripeEventId);
        assert.equal(await insertStripeEventRecord(pool, event), false);
        const stored = (
          await pool.query(
            'SELECT processing_status, payload, processed_at FROM stripe_events WHERE stripe_event_id = $1',
            [event.stripeEventId]
          )
        ).rows[0];
        assert.equal(stored.processing_status, 'processed');
        assert.deepEqual(stored.payload, { fixture: 'retry' });
        assert.ok(stored.processed_at);
      }
    );
  }
);
