import type { Pool, PoolClient } from 'pg';

import { sponsorMediaPublicUrl } from '../sponsor-media/public-url.js';
import { loadSponsorshipCommitment } from '../sponsorship-commitments.repository.js';
import {
  SPONSOR_WEBSITE_ELIGIBLE_SQL,
  SPONSOR_WEBSITE_VISIBLE_SQL
} from '../sponsorship-website-eligibility.js';
import { assert } from '../publication-automation/policy.js';
import {
  readWebsiteMediaSources,
  assertWebsiteMediaAttested,
  type WebsiteMediaAttestation
} from '../sponsorship-website-media.js';

import { fulfil } from './evidence-write.js';

type Db = Pool | PoolClient;

/** Only the explicit visibility command for the real OpenG7 directory calls this port. */
export async function recordWebsiteFulfilment(
  db: Db,
  contributionId: string,
  actor: string,
  attestation: WebsiteMediaAttestation
): Promise<void> {
  const result = await db.query<{
    id: string;
    company: string;
    summary: string | null;
    version: string;
    logo_url: string | null;
    eligible: boolean;
  }>(
    `SELECT id,sponsor_company_name AS company,sponsor_public_summary AS summary,sponsor_logo_url AS logo_url,updated_at::text AS version,
      ((${SPONSOR_WEBSITE_ELIGIBLE_SQL}) AND (${SPONSOR_WEBSITE_VISIBLE_SQL}) AND status='paid'
        AND sponsorship_refund_status='not_requested') AS eligible FROM fund_contributions WHERE id=$1::uuid`,
    [contributionId]
  );
  const source = result.rows[0];
  assert(source?.eligible, 'SOURCE_NOT_ELIGIBLE');
  // These are the exact approved WebP artifacts served by the controlled public
  // media route. A social JPEG is a different artifact and is never claimed here.
  const displayed = await readWebsiteMediaSources(
    db,
    contributionId,
    source.logo_url
  );
  assertWebsiteMediaAttested(contributionId, displayed, attestation);
  const media = displayed.map((row) => {
    return {
      id: row.id,
      contributionId: row.contributionId,
      kind: row.kind,
      version: row.version,
      sourceHash: row.checksum,
      derivedHash: row.checksum,
      transform: 'identity-approved-webp-v1',
      mimeType: 'image/webp',
      width: row.width,
      height: row.height,
      alt: row.alt?.trim() || source.company + ' - image commanditaire',
      url: sponsorMediaPublicUrl(row.id),
      usage: row.usage,
      restrictionsReviewed: row.restrictionsReviewed
    };
  });
  const commitment = await loadSponsorshipCommitment(db, contributionId);
  if (commitment?.state !== 'active') return;
  const obligation = commitment.obligations.find(
    (o) =>
      o.channel === 'website' && o.target === 'openg7' && o.state === 'pending'
  );
  if (!obligation) return;
  // One visibility transition is one passage, even when a historical agreement promises several.
  await fulfil(db, {
    obligationId: obligation.id,
    contributionId,
    obligationVersion: obligation.version,
    channel: 'website',
    target: 'openg7',
    deliveryId: null,
    deliveryVersion: null,
    accountId: 'openg7:website',
    provenance: 'website_verified',
    externalPostId: null,
    externalPostUrl: null,
    message: [
      source.company,
      source.summary,
      ...media.map((image) => image.usage.credit)
    ]
      .filter(Boolean)
      .join('\n\n'),
    sources: [
      {
        ...source,
        logo_url: media.find((image) => image.kind === 'logo')?.url ?? null
      }
    ],
    media,
    actor
  });
}
