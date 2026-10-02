import { SPONSOR_APPROVED_PRESENTATION_SQL } from './sponsorship-media-eligibility.js';

/** Shared with the public directory: visibility is independent of social delivery. */
export const SPONSOR_WEBSITE_ELIGIBLE_SQL = `
  fund_contributions.contribution_type = 'sponsorship_interest'
  AND fund_contributions.status IN ('paid', 'refunded', 'disputed')
  AND fund_contributions.public_display_consent IS TRUE
  AND COALESCE(fund_contributions.sponsor_review_status = 'approved', FALSE)
  AND NULLIF(btrim(fund_contributions.sponsor_company_name), '') IS NOT NULL
  AND ${SPONSOR_APPROVED_PRESENTATION_SQL}`;

export const SPONSOR_WEBSITE_VISIBLE_SQL = `(${SPONSOR_WEBSITE_ELIGIBLE_SQL})
  AND COALESCE((to_jsonb(fund_contributions)->>'sponsor_site_visibility_held')::boolean, FALSE) IS FALSE`;
