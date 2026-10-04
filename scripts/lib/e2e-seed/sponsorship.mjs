import { sha256Hex, sqlLiteral } from './sql.mjs';

// Publication cleanup runs before contribution and media cascades. Its guards
// also protect authorized batches belonging to unrelated local records.
export function buildSponsorshipSeedFragments({
  fixtures,
  publicationFixtures
}) {
  const publicationCleanup = `
DO $$
DECLARE
  contribution_ids UUID[];
  batch_ids UUID[];
  delivery_ids UUID[];
BEGIN
  SELECT ARRAY(SELECT id FROM fund_contributions
    WHERE public_reference = ANY(ARRAY[${publicationFixtures.map((fixture) => sqlLiteral(fixture.publicReference)).join(', ')}]::text[])
       OR sponsor_contact_email = ANY(ARRAY[${publicationFixtures
         .filter((fixture) => fixture.contactEmail)
         .map((fixture) => sqlLiteral(fixture.contactEmail))
         .join(', ')}]::text[]))
    INTO contribution_ids;
  SELECT ARRAY(SELECT DISTINCT batch_id FROM sponsor_publication_drafts
    WHERE contribution_id = ANY(contribution_ids) AND batch_id IS NOT NULL)
    INTO batch_ids;
  IF EXISTS(SELECT 1 FROM sponsor_publication_drafts
    WHERE batch_id = ANY(batch_ids) AND NOT contribution_id = ANY(contribution_ids)) THEN
    RAISE EXCEPTION 'Cannot clean Playwright fixtures in a publication batch shared with non-fixture contributions';
  END IF;
  SELECT ARRAY(SELECT id FROM publication_deliveries
    WHERE batch_id = ANY(batch_ids) OR media_id IN (
      SELECT id FROM sponsor_media_assets WHERE contribution_id = ANY(contribution_ids)
    )) INTO delivery_ids;
  IF EXISTS(SELECT 1 FROM publication_deliveries
    WHERE id = ANY(delivery_ids) AND (mode = 'live'
      OR (batch_id IS NOT NULL AND NOT batch_id = ANY(batch_ids))))
    OR EXISTS(SELECT 1 FROM social_publication_jobs
      WHERE batch_id = ANY(batch_ids) AND mode = 'live') THEN
    RAISE EXCEPTION 'Cannot clean Playwright fixtures referenced by live or non-fixture publications';
  END IF;
  DELETE FROM publication_editorial_observations WHERE delivery_id = ANY(delivery_ids);
  DELETE FROM publication_deliveries WHERE id = ANY(delivery_ids);
  DELETE FROM publication_recurrences WHERE batch_id = ANY(batch_ids);
  DELETE FROM sponsor_publication_batches WHERE id = ANY(batch_ids);
END $$;`;

  const deleteStatements = fixtures
    .map(
      (fixture) => `
WITH removed AS (
  DELETE FROM sponsorship_access_tokens WHERE contribution_id IN (
    SELECT id FROM fund_contributions WHERE public_reference = ${sqlLiteral(fixture.publicReference)}
  ) RETURNING email_message_id
) DELETE FROM email_messages WHERE id IN (SELECT email_message_id FROM removed);
DELETE FROM sponsorship_followup_drafts WHERE contribution_id IN (
  SELECT id FROM fund_contributions WHERE public_reference = ${sqlLiteral(fixture.publicReference)}
);
DELETE FROM fund_contributions
WHERE sponsor_contact_email = ${sqlLiteral(fixture.contactEmail)}
   OR public_reference = ${sqlLiteral(fixture.publicReference)};`
    )
    .join('\n');

  const insertStatements = fixtures
    .map((fixture) => {
      const reviewStatus = fixture.reviewStatus ?? 'pending_review';
      const reviewedAt = reviewStatus === 'pending_review' ? 'NULL' : 'NOW()';
      const stripePaymentIntentId = fixture.stripePaymentIntentId
        ? sqlLiteral(fixture.stripePaymentIntentId)
        : 'NULL';
      const stripeSessionId = fixture.stripeSessionId
        ? sqlLiteral(fixture.stripeSessionId)
        : 'NULL';
      const feedTarget = fixture.feedTarget
        ? sqlLiteral(fixture.feedTarget)
        : 'NULL';
      const feedChannels = fixture.feedChannels
        ? `${sqlLiteral(JSON.stringify(fixture.feedChannels))}::jsonb`
        : "'[]'::jsonb";

      return `
INSERT INTO fund_contributions (
  contribution_type, amount_cents, currency, status, paid_at,
  public_display_consent, display_amount_consent, non_charity_acknowledged,
  sponsor_company_name, sponsor_contact_name, sponsor_contact_email,
  sponsor_website_url, sponsor_details_submitted_at, sponsor_review_status,
  sponsor_reviewed_at, sponsorship_followup_token_hash,
  sponsorship_followup_token_created_at, public_reference,
  stripe_payment_intent_id, stripe_session_id,
  sponsor_feed_target, sponsor_feed_channels, email_private
) VALUES (
  'sponsorship_interest', ${fixture.amountCents}, 'cad', 'paid', NOW(),
  TRUE, TRUE, TRUE,
  ${sqlLiteral(fixture.companyName)}, ${sqlLiteral(fixture.contactName)},
  ${sqlLiteral(fixture.contactEmail)}, ${sqlLiteral(fixture.websiteUrl)},
  NOW(), ${sqlLiteral(reviewStatus)},
  ${reviewedAt}, ${sqlLiteral(sha256Hex(fixture.followupToken))}, NOW(),
  ${sqlLiteral(fixture.publicReference)}, ${stripePaymentIntentId},
  ${stripeSessionId}, ${feedTarget}, ${feedChannels}, ${fixture.paymentEmail ? sqlLiteral(fixture.paymentEmail) : 'NULL'}
);`;
    })
    .join('\n');

  const sponsorMediaInsertStatements = fixtures
    .map((fixture) => {
      const fixtureKey = `e2e/${fixture.publicReference.toLowerCase()}`;
      return `
INSERT INTO sponsor_media_assets (
  contribution_id, kind, review_status, uploaded_by, original_filename,
  original_mime_type, original_size_bytes, original_storage_key,
  processed_size_bytes, processed_storage_key, public_storage_key, public_url,
  checksum_sha256, width, height, alt_text, reviewed_at, reviewed_by
)
SELECT
  id, 'supporting_image', 'approved', 'admin', 'presentation.png',
  'image/png', 68, ${sqlLiteral(`${fixtureKey}/original.png`)},
  44, ${sqlLiteral(`${fixtureKey}/processed.webp`)},
  ${sqlLiteral(`${fixtureKey}/public.webp`)},
  'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',
  ${sqlLiteral(sha256Hex(`${fixture.publicReference}:presentation`))},
  1, 1, ${sqlLiteral(`Photo de presentation ${fixture.companyName}`)}, NOW(),
  'e2e-seed'
FROM fund_contributions
WHERE public_reference = ${sqlLiteral(fixture.publicReference)};`;
    })
    .join('\n');

  return {
    publicationCleanup,
    deleteStatements,
    insertStatements,
    sponsorMediaInsertStatements
  };
}
