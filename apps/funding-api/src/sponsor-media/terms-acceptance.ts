import type { PoolClient } from 'pg';

import {
  getSponsorMediaUsageTerms,
  normalizeSponsorMediaTermsAcceptance,
  type SponsorMediaTermsAcceptance,
  type SponsorMediaUsageAcceptance,
  type SponsorMediaUsageRights
} from '../../../../packages/funding-core/src/index.js';

/** Called in the same transaction as the asset, usage history, receipt and audit. */
export async function recordSponsorMediaTermsAcceptance(
  db: PoolClient,
  input: {
    readonly assetId: string;
    readonly contributionId: string;
    readonly requestId: string;
    readonly termsAcceptance: SponsorMediaTermsAcceptance;
    readonly usage: SponsorMediaUsageRights;
    readonly originalChecksumSha256: string;
    readonly processedChecksumSha256: string;
  }
): Promise<SponsorMediaUsageAcceptance> {
  const accepted = normalizeSponsorMediaTermsAcceptance(input.termsAcceptance);
  const terms = getSponsorMediaUsageTerms(accepted.locale);
  const row = (
    await db.query<{ id: string; accepted_at: string }>(
      `INSERT INTO sponsor_media_terms_acceptances(asset_id,contribution_id,request_id,
      terms_version,terms_fingerprint,terms_locale,terms_text,usage_rights,
      original_checksum_sha256,processed_checksum_sha256,actor,identity_mode)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'sponsor-followup','private_followup_link')
    RETURNING id,to_char(accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS accepted_at`,
      [
        input.assetId,
        input.contributionId,
        input.requestId,
        terms.version,
        terms.fingerprint,
        terms.locale,
        terms.text,
        JSON.stringify(input.usage),
        input.originalChecksumSha256,
        input.processedChecksumSha256
      ]
    )
  ).rows[0]!;
  return {
    id: row.id,
    termsVersion: terms.version,
    termsFingerprint: terms.fingerprint,
    locale: terms.locale,
    acceptedAt: row.accepted_at,
    source: 'platform_acceptance'
  };
}
