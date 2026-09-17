import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { listSponsorshipsForAttention } from '../fund-contributions.repository.js';
import { listAdminPublicationDrafts } from '../fund-admin.repository.js';
import { listSponsorMediaAssets } from '../sponsor-media.repository.js';

import type { AttentionDataset } from './attention.service.js';

/** Exact ID/public-reference lookup; no global queue or materialisation cap. */
export const loadSponsorshipAssistantDataset = async (
  pool: Pool | PoolClient,
  reference: string,
  now = new Date()
) => {
  const presence = await pool.query<{ available: boolean }>(`SELECT
    to_regclass('public.sponsor_media_assets') IS NOT NULL AND
    to_regclass('public.sponsor_publication_drafts') IS NOT NULL AS available`);
  if (!presence.rows[0]?.available)
    throw new Error('Assistant context sources unavailable.');
  const canonicalReference = /^[0-9a-f-]{36}$/i.test(reference)
    ? reference.toLowerCase()
    : reference;
  const result = await listSponsorshipsForAttention(
    pool,
    2,
    canonicalReference
  );
  if (result.items.length !== 1) return null;
  const record = result.items[0]!;
  // A PoolClient may belong to the confirmation transaction: sequence its queries.
  const details = await pool.query<{
    recipient: string | null;
    consent: boolean;
  }>(
    'SELECT sponsor_contact_email AS recipient, public_display_consent AS consent FROM fund_contributions WHERE id = $1::uuid',
    [record.contributionId]
  );
  const media = await listSponsorMediaAssets(pool, record.contributionId);
  const drafts = await listAdminPublicationDrafts(pool, {
    all: true,
    contributionId: record.contributionId
  });
  const recipient = details.rows[0]?.recipient?.trim() || null;
  const consent = details.rows[0]?.consent ?? false;
  const version = createHash('sha256')
    .update(
      JSON.stringify({
        record,
        recipient,
        consent,
        media: media
          .map((asset) => [
            asset.id,
            asset.kind,
            asset.reviewStatus,
            asset.version
          ])
          .sort(),
        drafts: drafts.drafts
          .map((draft) => [draft.id, draft.status, draft.updated_at])
          .sort()
      })
    )
    .digest('hex');
  const dataset: AttentionDataset = {
    now,
    sponsorships: [record],
    sponsorshipsTruncated: false,
    drafts: drafts.drafts,
    batches: [],
    slots: [],
    emailMessages: [],
    financialTotals: {
      grossPaid: 0,
      refunded: 0,
      disputed: 0,
      currency: record.currency
    }
  };
  return { record, dataset, media, recipient, consent, version };
};

export type SponsorshipAssistantDataset = NonNullable<
  Awaited<ReturnType<typeof loadSponsorshipAssistantDataset>>
>;
