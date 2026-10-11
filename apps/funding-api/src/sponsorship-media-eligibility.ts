import {
  moderationApprovedSql,
  moderationVisibleSql
} from './moderation/policy.js';

/** Database prerequisite for review and visibility; this grants no authorization. */
export const SPONSOR_APPROVED_PRESENTATION_SQL = `EXISTS (
  SELECT 1 FROM sponsor_media_assets
  WHERE contribution_id = fund_contributions.id
    AND kind = 'supporting_image'
    AND review_status = 'approved'
    AND ${moderationApprovedSql('media', 'sponsor_media_assets.id')}
    AND deleted_at IS NULL
)`;

/** Existing unchanged public presentations do not authorize a new approval. */
export const SPONSOR_VISIBLE_PRESENTATION_SQL = `EXISTS (
  SELECT 1 FROM sponsor_media_assets
  WHERE contribution_id = fund_contributions.id
    AND kind = 'supporting_image'
    AND review_status = 'approved'
    AND ${moderationVisibleSql('media', 'sponsor_media_assets.id')}
    AND deleted_at IS NULL
)`;
