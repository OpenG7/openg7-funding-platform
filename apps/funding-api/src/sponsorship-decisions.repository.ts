import type {
  AdminSponsorshipPublicationRequest,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipReviewStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  centsToAmount,
  parseDbInt,
  normalizeSponsorFeedStatus
} from './contributions-persistence-helpers.js';
import { resolveSponsorshipSocialChannels } from './sponsorship-benefits.js';
import { SPONSOR_APPROVED_PRESENTATION_SQL } from './sponsorship-media-eligibility.js';
import {
  normalizeSponsorFeedTarget,
  parseSponsorFeedChannels
} from './sponsorship-persistence-helpers.js';
export interface SponsorshipReviewInput {
  readonly contributionId: string;
  readonly reviewStatus: SponsorshipReviewStatus;
  readonly reviewNote: string | null;
  readonly expectedVersion: string;
}

export type SponsorshipPublicationInput = AdminSponsorshipPublicationRequest;

export type SponsorshipMutationStatus =
  | 'updated'
  | 'not_found'
  | 'conflict'
  | 'payment_not_eligible'
  | 'media_required';

export interface SponsorshipReviewMutationResult {
  readonly status: SponsorshipMutationStatus;
  readonly updated: boolean;
  readonly currentVersion: string | null;
  readonly paymentStatus: string | null;
}

export interface SponsorshipPublicationMutationResult {
  readonly status: SponsorshipMutationStatus;
  readonly updated: boolean;
  readonly feedChannels: readonly SponsorFeedChannel[];
  readonly currentVersion: string | null;
  readonly paymentStatus: string | null;
}

export interface SponsorshipLogoInput {
  readonly contributionId: string;
  readonly logoUrl: string;
  readonly expectedVersion: string;
}

export interface SponsorshipLogoMutationResult {
  readonly status: Exclude<
    SponsorshipMutationStatus,
    'payment_not_eligible' | 'media_required'
  >;
  readonly updated: boolean;
  readonly previousLogoUrl: string | null;
  readonly currentVersion: string | null;
}

export interface SponsorshipLogoDeleteInput {
  readonly contributionId: string;
  readonly expectedVersion: string;
}

const mergePromisedSponsorFeedChannels = (
  channels: readonly SponsorFeedChannel[],
  amount: number
): readonly SponsorFeedChannel[] => {
  const promisedChannels = resolveSponsorshipSocialChannels(amount);

  return [...new Set([...channels, ...promisedChannels])];
};

const normalizedNullableText = (
  value: string | null | undefined
): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const sponsorFeedChannelsEqual = (
  first: readonly SponsorFeedChannel[],
  second: readonly SponsorFeedChannel[]
): boolean => {
  const firstSet = new Set(first);
  const secondSet = new Set(second);

  return (
    firstSet.size === secondSet.size &&
    [...firstSet].every((channel) => secondSet.has(channel))
  );
};

/** Lock the sponsorship dossier in the caller's transaction, before any write. */
export const lockSponsorshipContribution = async (
  client: PoolClient,
  contributionId: string
): Promise<boolean> => {
  const result = await client.query<{ readonly id: string }>(
    "SELECT id FROM fund_contributions WHERE id = $1::uuid AND contribution_type = 'sponsorship_interest' FOR UPDATE",
    [contributionId]
  );
  return result.rows.length > 0;
};

export const updateSponsorshipReview = async (
  pool: Pool | null,
  input: SponsorshipReviewInput
): Promise<SponsorshipReviewMutationResult> => {
  if (!pool) {
    return {
      status: 'not_found',
      updated: false,
      currentVersion: null,
      paymentStatus: null
    };
  }

  const target = await pool.query<{
    readonly status: string;
    readonly review_status: SponsorshipReviewStatus;
    readonly version: string;
    readonly has_approved_presentation_photo: boolean;
  }>(
    `
      SELECT
        status,
        COALESCE(sponsor_review_status, 'pending_review') AS review_status,
        updated_at::text AS version,
        ${SPONSOR_APPROVED_PRESENTATION_SQL} AS has_approved_presentation_photo
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
    `,
    [input.contributionId]
  );

  const targetRow = target.rows[0];
  if (!targetRow) {
    return {
      status: 'not_found',
      updated: false,
      currentVersion: null,
      paymentStatus: null
    };
  }

  if (targetRow.version !== input.expectedVersion) {
    return {
      status: 'conflict',
      updated: false,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  if (
    input.reviewStatus === 'approved' &&
    targetRow.status !== 'paid' &&
    targetRow.review_status !== 'approved'
  ) {
    return {
      status: 'payment_not_eligible',
      updated: false,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  if (
    input.reviewStatus === 'approved' &&
    !targetRow.has_approved_presentation_photo
  ) {
    return {
      status: 'media_required',
      updated: false,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  const result = await pool.query<{ readonly version: string }>(
    `
      UPDATE fund_contributions
      SET
        sponsor_review_status = $2,
        sponsor_site_visibility_held = CASE WHEN $2 = 'approved' AND sponsor_review_status IS DISTINCT FROM 'approved' THEN TRUE ELSE sponsor_site_visibility_held END,
        sponsor_review_note = $3,
        sponsor_reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
        AND updated_at::text = $4
        AND (
          $2 <> 'approved'
          OR ${SPONSOR_APPROVED_PRESENTATION_SQL}
        )
      RETURNING updated_at::text AS version
    `,
    [
      input.contributionId,
      input.reviewStatus,
      input.reviewNote,
      input.expectedVersion
    ]
  );

  const updatedVersion = result.rows[0]?.version;
  return updatedVersion
    ? {
        status: 'updated',
        updated: true,
        currentVersion: updatedVersion,
        paymentStatus: targetRow.status
      }
    : {
        status: 'conflict',
        updated: false,
        currentVersion: targetRow.version,
        paymentStatus: targetRow.status
      };
};

export const updateSponsorshipPublication = async (
  pool: Pool | null,
  input: SponsorshipPublicationInput
): Promise<SponsorshipPublicationMutationResult> => {
  if (!pool) {
    return {
      status: 'not_found',
      updated: false,
      feedChannels: input.feedChannels,
      currentVersion: null,
      paymentStatus: null
    };
  }

  const target = await pool.query<{
    readonly amount_cents: string;
    readonly status: string;
    readonly version: string;
    readonly sponsor_public_slug: string | null;
    readonly sponsor_public_summary: string | null;
    readonly sponsor_feed_target: SponsorFeedTarget | null;
    readonly sponsor_feed_channels: unknown;
    readonly sponsor_feed_status: SponsorFeedStatus | null;
    readonly sponsor_feed_public_url: string | null;
  }>(
    `
      SELECT
        amount_cents::text AS amount_cents,
        status,
        updated_at::text AS version,
        sponsor_public_slug,
        sponsor_public_summary,
        sponsor_feed_target,
        sponsor_feed_channels,
        sponsor_feed_status,
        sponsor_feed_public_url
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
    `,
    [input.contributionId]
  );

  const targetRow = target.rows[0];
  if (!targetRow) {
    return {
      status: 'not_found',
      updated: false,
      feedChannels: input.feedChannels,
      currentVersion: null,
      paymentStatus: null
    };
  }

  if (targetRow.version !== input.expectedVersion) {
    return {
      status: 'conflict',
      updated: false,
      feedChannels: input.feedChannels,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  const requestedFeedChannels = [...new Set(input.feedChannels)];
  const currentFeedChannels = parseSponsorFeedChannels(
    targetRow.sponsor_feed_channels
  );
  const feedChannels =
    targetRow.status === 'paid'
      ? mergePromisedSponsorFeedChannels(
          requestedFeedChannels,
          centsToAmount(parseDbInt(targetRow.amount_cents))
        )
      : requestedFeedChannels;
  const visibilityMetadataChanged =
    normalizedNullableText(input.publicSlug) !==
      normalizedNullableText(targetRow.sponsor_public_slug) ||
    normalizedNullableText(input.publicSummary) !==
      normalizedNullableText(targetRow.sponsor_public_summary) ||
    (input.feedTarget ?? null) !==
      normalizeSponsorFeedTarget(targetRow.sponsor_feed_target) ||
    !sponsorFeedChannelsEqual(feedChannels, currentFeedChannels) ||
    input.feedStatus !==
      normalizeSponsorFeedStatus(targetRow.sponsor_feed_status) ||
    normalizedNullableText(input.feedPublicUrl) !==
      normalizedNullableText(targetRow.sponsor_feed_public_url);

  if (targetRow.status !== 'paid' && visibilityMetadataChanged) {
    return {
      status: 'payment_not_eligible',
      updated: false,
      feedChannels,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  const result = await pool.query<{ readonly version: string }>(
    `
      UPDATE fund_contributions
      SET
        sponsor_public_slug = $2,
        sponsor_public_summary = $3,
        sponsor_feed_target = $4,
        sponsor_feed_channels = $5::jsonb,
        sponsor_feed_status = $6,
        sponsor_feed_public_url = $7,
        sponsor_feed_notes = $8,
        sponsor_visibility_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
        AND updated_at::text = $9
      RETURNING updated_at::text AS version
    `,
    [
      input.contributionId,
      input.publicSlug?.trim() || null,
      input.publicSummary?.trim() || null,
      input.feedTarget ?? null,
      JSON.stringify(feedChannels),
      input.feedStatus,
      input.feedPublicUrl?.trim() || null,
      input.feedNotes?.trim() || null,
      input.expectedVersion
    ]
  );

  const updatedVersion = result.rows[0]?.version;
  return {
    status: updatedVersion ? 'updated' : 'conflict',
    updated: Boolean(updatedVersion),
    feedChannels,
    currentVersion: updatedVersion ?? targetRow.version,
    paymentStatus: targetRow.status
  };
};

export const updateSponsorshipLogoUrl = async (
  pool: Pool | null,
  input: SponsorshipLogoInput
): Promise<SponsorshipLogoMutationResult> => {
  if (!pool) {
    return {
      status: 'not_found',
      updated: false,
      previousLogoUrl: null,
      currentVersion: null
    };
  }

  const result = await pool.query<{
    readonly updated: boolean;
    readonly previous_logo_url: string | null;
    readonly current_version: string | null;
  }>(
    `
      WITH target AS (
        SELECT
          sponsor_logo_url AS previous_logo_url,
          updated_at::text AS previous_version
        FROM fund_contributions
        WHERE id = $1::uuid
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
        FOR UPDATE
      ),
      updated AS (
        UPDATE fund_contributions
        SET
          sponsor_logo_url = $2,
          updated_at = NOW()
        WHERE id = $1::uuid
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
          AND updated_at::text = $3
        RETURNING id, updated_at::text AS current_version
      )
      SELECT
        EXISTS (SELECT 1 FROM updated) AS updated,
        (SELECT previous_logo_url FROM target) AS previous_logo_url,
        COALESCE(
          (SELECT current_version FROM updated),
          (SELECT previous_version FROM target)
        ) AS current_version
    `,
    [input.contributionId, input.logoUrl, input.expectedVersion]
  );

  const row = result.rows[0];
  const currentVersion = row?.current_version ?? null;
  const found = currentVersion !== null;
  return {
    status: row?.updated ? 'updated' : found ? 'conflict' : 'not_found',
    updated: row?.updated ?? false,
    previousLogoUrl: row?.previous_logo_url ?? null,
    currentVersion
  };
};

export const clearSponsorshipLogoUrl = async (
  pool: Pool | null,
  input: SponsorshipLogoDeleteInput
): Promise<SponsorshipLogoMutationResult> => {
  if (!pool) {
    return {
      status: 'not_found',
      updated: false,
      previousLogoUrl: null,
      currentVersion: null
    };
  }

  const result = await pool.query<{
    readonly updated: boolean;
    readonly previous_logo_url: string | null;
    readonly current_version: string | null;
  }>(
    `
      WITH target AS (
        SELECT
          sponsor_logo_url AS previous_logo_url,
          updated_at::text AS previous_version
        FROM fund_contributions
        WHERE id = $1::uuid
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
        FOR UPDATE
      ),
      updated AS (
        UPDATE fund_contributions
        SET
          sponsor_logo_url = NULL,
          updated_at = NOW()
        WHERE id = $1::uuid
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
          AND updated_at::text = $2
        RETURNING id, updated_at::text AS current_version
      )
      SELECT
        EXISTS (SELECT 1 FROM updated) AS updated,
        (SELECT previous_logo_url FROM target) AS previous_logo_url,
        COALESCE(
          (SELECT current_version FROM updated),
          (SELECT previous_version FROM target)
        ) AS current_version
    `,
    [input.contributionId, input.expectedVersion]
  );

  const row = result.rows[0];
  const currentVersion = row?.current_version ?? null;
  const found = currentVersion !== null;
  return {
    status: row?.updated ? 'updated' : found ? 'conflict' : 'not_found',
    updated: row?.updated ?? false,
    previousLogoUrl: row?.previous_logo_url ?? null,
    currentVersion
  };
};
