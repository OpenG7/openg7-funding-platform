import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { getSponsorMediaUsageTerms } from '../../dist/packages/funding-core/src/index.js';
import { getAdminWorkQueue } from '../../dist/apps/funding-api/src/admin-work-queue.service.js';
import {
  createSponsorMediaAsset,
  getSponsorMediaStorageRecord,
  reviewSponsorMediaAsset,
  updateSponsorMediaMetadata
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { updateSponsorMediaUsage } from '../../dist/apps/funding-api/src/sponsor-media-usage.repository.js';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { fixtureModerationDecision } from './support/moderation-fixture.mjs';

const rights = {
  state: 'confirmed',
  channels: ['website'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: null,
  restrictions: null
};

test(
  'media rights return one durable dossier to the queue until review, with fresh rights and source boundaries',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(() => database.stop());
    const pool = database.pool;
    const terms = getSponsorMediaUsageTerms('fr-CA');
    const termsAcceptance = {
      version: terms.version,
      fingerprint: terms.fingerprint,
      locale: terms.locale,
      accepted: true
    };
    const contributionId = (
      await pool.query(`INSERT INTO fund_contributions
    (contribution_type,amount_cents,currency,status,sponsor_review_status,sponsor_company_name,public_display_consent)
    VALUES('sponsorship_interest',50000,'cad','paid','approved','Synthetic media follow-up',FALSE) RETURNING id`)
    ).rows[0].id;
    const actor = 'admin:00000000-0000-4000-8000-000000000004';
    const itemId = `sponsorship_media_review:${contributionId}`;
    async function upload(overrides = {}) {
      const id = randomUUID();
      const created = await createSponsorMediaAsset(pool, {
        id,
        requestId: randomUUID(),
        requestFingerprint: '1'.repeat(64),
        contributionId,
        kind: 'supporting_image',
        uploadedBy: 'admin',
        auditActor: actor,
        storageDriver: 'local',
        originalFilename: 'synthetic-media.webp',
        originalMimeType: 'image/webp',
        originalSizeBytes: 100,
        originalStorageKey: `${id}/original.webp`,
        originalChecksumSha256: '2'.repeat(64),
        processedSizeBytes: 100,
        processedStorageKey: `${id}/processed.webp`,
        checksumSha256: '3'.repeat(64),
        width: 32,
        height: 24,
        altText: null,
        maxSupportingImages: 100,
        ...overrides
      });
      assert.equal(created.status, 'created');
      return created.asset;
    }
    const asset = await upload();
    const second = await upload();
    const read = (when = new Date()) =>
      getAdminWorkQueue(
        pool,
        { type: 'sponsorship_media_review', overview: true },
        when
      );
    let queue = await read();
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].id, itemId);
    assert.equal(queue.items[0].facts.phase, 'waiting');
    assert.equal(queue.items[0].facts.authorizationRequiredCount, 2);
    assert.equal(queue.items[0].severity, 'informational');
    assert.equal(queue.actionCounts.sponsorship_media_review, 0);
    assert.ok(
      queue.overview.recommendations.every(
        (item) => item.type !== 'sponsorship_media_review'
      )
    );

    const confirmed = await updateSponsorMediaUsage(pool, {
      contributionId,
      assetId: asset.id,
      expectedVersion: asset.version,
      requestId: randomUUID(),
      actor: 'sponsor-followup',
      usage: rights,
      termsAcceptance
    });
    queue = await read();
    const current = queue.items[0];
    assert.equal(queue.items.length, 1);
    assert.equal(current.id, itemId);
    assert.equal(current.facts.phase, 'review');
    assert.equal(current.facts.reviewCount, 1);
    assert.equal(current.facts.missingAltCount, 1);
    assert.equal(current.facts.authorizationRequiredCount, 1);
    assert.equal(current.severity, 'today');
    assert.equal(
      current.adminUrl,
      `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}&tab=media`
    );
    assert.equal(queue.actionCounts.sponsorship_media_review, 1);
    const today = await getAdminWorkQueue(pool, {
      type: 'sponsorship_media_review',
      due: 'today'
    });
    assert.equal(today.items[0].id, itemId);
    assert.ok(
      queue.overview.recommendations.some((item) => item.id === itemId)
    );
    assert.equal(
      (await read()).items[0].facts.changedAt,
      current.facts.changedAt
    );
    const later = await read(
      new Date(Date.parse(current.facts.changedAt) + 8 * 86400000)
    );
    assert.equal(later.items[0].detectedAt, current.detectedAt);
    assert.equal(later.items[0].severity, 'urgent');
    assert.equal(later.items[0].dueAt, undefined);

    // Editing a description changes the pending version, without changing rights or approving it.
    const description = await updateSponsorMediaMetadata(pool, {
      assetId: asset.id,
      expectedVersion: confirmed.asset.version,
      confirmation: asset.id,
      altText: 'Synthetic workshop participants',
      actor
    });
    assert.equal(description.status, 'updated');
    queue = await read();
    assert.equal(queue.items[0].facts.reviewCount, 1);
    assert.equal(queue.items[0].facts.missingAltCount, 0);

    // Historical rights without a platform acceptance receipt remain legitimate review facts.
    await pool.query(
      'UPDATE sponsor_media_assets SET usage_rights=$2::jsonb WHERE id=$1',
      [second.id, JSON.stringify(rights)]
    );
    queue = await read();
    assert.equal(queue.items[0].facts.reviewCount, 2);
    assert.equal(queue.items[0].facts.authorizationRequiredCount, 0);
    await pool.query(
      'UPDATE sponsor_media_assets SET deleted_at=clock_timestamp() WHERE id=$1',
      [second.id]
    );
    queue = await read();
    assert.equal(queue.items[0].facts.reviewCount, 1);
    await pool.query(
      "UPDATE sponsor_media_assets SET review_status='rejected' WHERE id=$1",
      [asset.id]
    );
    assert.equal((await read()).items.length, 0);
    await pool.query(
      "UPDATE sponsor_media_assets SET review_status='pending_review',usage_rights=$2::jsonb WHERE id=$1",
      [asset.id, JSON.stringify({ ...rights, state: 'withdrawn' })]
    );
    assert.equal((await read()).items.length, 0);
    await pool.query(
      'UPDATE sponsor_media_assets SET usage_rights=$2::jsonb WHERE id=$1',
      [asset.id, JSON.stringify(rights)]
    );
    assert.equal((await read()).items.length, 1);
    for (const [column, invalid, restore] of [
      ['sponsor_review_status', 'rejected', 'approved'],
      ['sponsorship_refund_status', 'requested', 'not_requested'],
      ['status', 'refunded', 'paid']
    ]) {
      await pool.query(
        `UPDATE fund_contributions SET ${column}=$2 WHERE id=$1`,
        [contributionId, invalid]
      );
      assert.equal((await read()).items.length, 0, column);
      await pool.query(
        `UPDATE fund_contributions SET ${column}=$2 WHERE id=$1`,
        [contributionId, restore]
      );
    }
    // Queue reads and consent updates must not approve, publish or contact anyone.
    const state = (
      await pool.query(
        `SELECT
    (SELECT review_status FROM sponsor_media_assets WHERE id=$1) AS review_status,
    (SELECT count(*)::int FROM email_messages) AS emails,
    (SELECT count(*)::int FROM publication_deliveries) AS deliveries,
    (SELECT count(*)::int FROM moderation_decisions) AS decisions`,
        [asset.id]
      )
    ).rows[0];
    assert.deepEqual(state, {
      review_status: 'pending_review',
      emails: 0,
      deliveries: 0,
      decisions: 0
    });
    // Only an explicit administrator decision on the current synthetic version
    // resolves review. This fixture owns its disposable database.
    const reviewedAsset = await getSponsorMediaStorageRecord(pool, asset.id);
    const moderationDecision = await fixtureModerationDecision(pool, {
      type: 'media',
      id: asset.id
    });
    const approved = await reviewSponsorMediaAsset(pool, {
      assetId: asset.id,
      expectedVersion: reviewedAsset.version,
      confirmation: asset.id,
      reviewStatus: 'approved',
      altText: reviewedAsset.altText,
      publicStorageKey: null,
      publicUrl: `/api/public/sponsor-media/${asset.id}`,
      reviewedBy: actor,
      moderationDecision
    });
    assert.equal(approved.status, 'updated');
    assert.equal(approved.asset.reviewStatus, 'approved');
    assert.equal((await read()).items.length, 0);
  }
);
