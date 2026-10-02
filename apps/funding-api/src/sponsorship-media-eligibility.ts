/** Database prerequisite for review and visibility; this grants no authorization. */
export const SPONSOR_APPROVED_PRESENTATION_SQL = `EXISTS (
  SELECT 1 FROM sponsor_media_assets
  WHERE contribution_id = fund_contributions.id
    AND kind = 'supporting_image'
    AND review_status = 'approved'
    AND deleted_at IS NULL
)`;
