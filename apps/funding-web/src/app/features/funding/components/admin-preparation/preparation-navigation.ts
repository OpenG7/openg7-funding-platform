import { automaticAdminUrl } from '../admin-automatic/admin-automatic-run.js';

import type { PreparationPilotIssue } from './preparation-pilot.models.js';

/** Open the owning form for the reported cause without inferring any permission. */
export function preparationIssueDestination(
  issue: PreparationPilotIssue
): string | null {
  const safeUrl = issue.adminUrl ? automaticAdminUrl(issue.adminUrl) : null;
  if (!safeUrl) return null;
  const url = new URL(safeUrl, 'https://admin.invalid');
  if (url.pathname !== '/admin/fundraiser/sponsors') return safeUrl;
  const has = (codes: readonly string[]) =>
    issue.summaryCodes.some((code) => codes.includes(code));
  let destination: readonly [string, string] | null = null;
  if (
    issue.actionKind === 'agreement' ||
    has(['commitment_needs_confirmation', 'offer_unverified'])
  )
    destination = ['publication', 'dossier-agreement'];
  else if (
    issue.actionKind === 'moderation' ||
    has(['sponsor_review_required', 'moderation_review_required'])
  )
    destination = ['overview', 'dossier-review'];
  else if (
    has([
      'website_draft_missing',
      'website_draft_outdated',
      'publication_draft_missing',
      'publication_draft_incomplete'
    ])
  )
    destination = ['publication', 'dossier-publication'];
  else if (has(['company_missing', 'presentation_missing']))
    destination = ['identity', 'dossier-identity'];
  else if (has(['required_media_missing']))
    destination = ['media', 'dossier-media'];
  if (!destination) return safeUrl;
  url.searchParams.set('tab', destination[0]);
  url.hash = destination[1];
  return automaticAdminUrl(url.pathname + url.search + url.hash);
}
