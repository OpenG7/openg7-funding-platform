import assert from 'node:assert/strict';

import { composePublicationRecognition } from '../../../dist/packages/funding-core/src/index.js';
import { createSponsorMediaStorage } from '../../../dist/apps/funding-api/src/sponsor-media-storage.js';
import { recordFixtureSponsorshipAgreement } from './sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './moderation-fixture.mjs';
import {
  sha256,
  VISUAL_LOAD_PHOTO_COUNT
} from './publication-visual-load-images.mjs';

export const visualLoadActor = 'admin:00000000-0000-4000-8000-000000000004';
export const visualLoadEnv = {
  SOCIAL_PUBLICATION_MODE: 'mock',
  SOCIAL_PUBLICATION_WORKER_ENABLED: 'false',
  SOCIAL_PUBLICATION_OPENG7_LINKEDIN_ACCOUNT_ID: '100'
};
export const visualLoadStorage = (root) =>
  createSponsorMediaStorage({
    driver: 'local',
    localStorageDir: root,
    s3: {}
  });
const uuid = (value) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0');

/** Reuse real agreement and N0 fixture helpers, without approving any delivery. */
export async function seedVisualLoadFixture(
  pool,
  storageRoot,
  photographs,
  format
) {
  assert.ok(['image_collection', 'collective_composite'].includes(format));
  assert.equal(photographs.length, VISUAL_LOAD_PHOTO_COUNT);
  const storage = visualLoadStorage(storageRoot);
  const scenario = format === 'image_collection' ? 1 : 2;
  const scheduledAt = '2099-01-01T10:00:00.000Z';
  const batchId = uuid(4000 + scenario);
  await pool.query(
    `INSERT INTO sponsor_publication_batches(id,channel,capacity,status,scheduled_at,publication_format)
    VALUES($1,'linkedin',10,'scheduled',$2,$3)`,
    [batchId, scheduledAt, format]
  );
  const people = [];
  for (const [index, photograph] of photographs.entries()) {
    const contributionId = uuid(scenario * 10000 + 1000 + index);
    const assetId = uuid(scenario * 10000 + 2000 + index);
    const draftId = uuid(scenario * 10000 + 3000 + index);
    const name = `Load sponsor ${String(index + 1).padStart(2, '0')}`;
    const credit = `Synthetic credit ${String(index + 1).padStart(2, '0')}`;
    const key = `visual-load/${scenario}/${index}/processed.webp`;
    const originalKey = `visual-load/${scenario}/${index}/original.jpg`;
    const original = await storage.readPrivateObject(photograph.originalKey);
    assert.ok(original && sha256(original) === photograph.originalHash);
    await storage.writePrivateObject({
      key: originalKey,
      data: original,
      contentType: 'image/jpeg'
    });
    const bytes = await storage.readPrivateObject(photograph.processedKey);
    assert.ok(bytes && sha256(bytes) === photograph.processedHash);
    await storage.writePrivateObject({
      key,
      data: bytes,
      contentType: 'image/webp'
    });
    await pool.query(
      `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,
      public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary)
      VALUES($1,'sponsorship_interest',50000,'cad','paid',clock_timestamp(),TRUE,'approved',$2,'Complete synthetic recognition.')`,
      [contributionId, name]
    );
    const usage = {
      state: 'confirmed',
      channels: ['linkedin'],
      targets: ['openg7'],
      transformations:
        format === 'image_collection'
          ? ['technical']
          : ['technical', 'composite'],
      credit,
      restrictions: null
    };
    await pool.query(
      `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,
      original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,checksum_sha256,width,height,alt_text,public_url,
      usage_rights,usage_restrictions_reviewed)
      VALUES($1,$2,'supporting_image','approved','synthetic-large.jpg','image/jpeg',$3,$4,$5,$6,$7,$8,$9,'Synthetic large photograph',$10,$11::jsonb,TRUE)`,
      [
        assetId,
        contributionId,
        photograph.originalBytes,
        originalKey,
        bytes.length,
        key,
        photograph.processedHash,
        photograph.processedWidth,
        photograph.processedHeight,
        `/api/public/sponsor-media/${assetId}`,
        JSON.stringify(usage)
      ]
    );
    const agreement = await recordFixtureSponsorshipAgreement(
      pool,
      contributionId,
      {
        benefits: [
          { channel: 'linkedin', target: 'openg7', quantity: 1, format }
        ]
      }
    );
    const obligation = agreement.obligations.find(
      (item) => item.channel === 'linkedin'
    );
    assert.ok(obligation);
    const title = `Thanks to ${name}`;
    await pool.query(
      `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,batch_id,status,scheduled_at,obligation_id)
      VALUES($1,$2,'openg7','linkedin',$3,'Complete synthetic recognition.','Paid sponsorship.',$4,'scheduled',$5,$6)`,
      [draftId, contributionId, title, batchId, scheduledAt, obligation.id]
    );
    await approveFixtureSubject(pool, {
      type: 'sponsorship',
      id: contributionId
    });
    await approveFixtureSubject(pool, { type: 'media', id: assetId });
    const assetVersion = (
      await pool.query(
        'SELECT updated_at::text AS version FROM sponsor_media_assets WHERE id=$1',
        [assetId]
      )
    ).rows[0].version;
    people.push({
      id: draftId,
      contributionId,
      name,
      title,
      body: 'Complete synthetic recognition.',
      disclosureText: 'Paid sponsorship.',
      credit,
      assetId,
      assetVersion
    });
  }
  const message = [
    composePublicationRecognition(people),
    ...people.map((person) => person.credit)
  ].join('\n\n');
  assert.ok(message.length <= 2900);
  return {
    action: 'compose',
    kind: 'sponsorship',
    feedId: 'openg7:linkedin',
    batchId,
    scheduledAt,
    message,
    publicationFormat: format,
    photoSelections: people.map(
      ({ contributionId, assetId, assetVersion }) => ({
        contributionId,
        assetId,
        assetVersion
      })
    )
  };
}
