import type {
  AdminPreparationReceipt,
  AdminPreparationReceiptData
} from '@openg7/funding-core';

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

/** Assistance consultations always open the same owner form and never create a job. */
export function preparationAssistanceDestination(
  contributionId: string,
  section: 'review' | 'source'
): string | null {
  return automaticAdminUrl(
    '/admin/fundraiser/sponsors?' +
      new URLSearchParams({
        sponsorshipId: contributionId,
        tab: 'publication'
      }) +
      '#dossier-assistance-' +
      section
  );
}

/** Navigation identifiers only; no agreement, review, receipt contents or arbitrary query. */
export interface PreparationReturnOrigin {
  readonly url: string;
  readonly contributionId: string;
  readonly issueId: string;
  readonly kind: 'dossier' | 'guide';
  readonly runId: string | null;
  readonly position: number | null;
}

const returnIdentifier = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function preparationReturnOrigin(
  currentUrl: string,
  receipt: AdminPreparationReceiptData &
    Partial<Pick<AdminPreparationReceipt, 'runId' | 'position'>>,
  issueId: string
): PreparationReturnOrigin | null {
  const safeUrl = automaticAdminUrl(currentUrl);
  if (
    !safeUrl ||
    !returnIdentifier.test(receipt.contributionId) ||
    !/^(?:check|blocker):[a-z][a-z0-9_]{0,99}$/.test(issueId)
  )
    return null;
  const url = new URL(safeUrl, 'https://admin.invalid');
  const guide = receipt.runId !== undefined;
  if (
    guide &&
    (!returnIdentifier.test(receipt.runId!) ||
      !Number.isSafeInteger(receipt.position) ||
      receipt.position! < 1)
  )
    return null;
  if (!guide && url.pathname !== '/admin/fundraiser/sponsors') return null;
  // The origin may contain search text or a fragment naming a private detail.
  // Keep only the dossier selector and its declared tab, never those contents.
  const params = new URLSearchParams();
  if (url.pathname === '/admin/fundraiser/sponsors') {
    const selected = guide
      ? url.searchParams.get('sponsorshipId')
      : receipt.contributionId;
    if (selected && returnIdentifier.test(selected))
      params.set('sponsorshipId', selected);
    const tab = guide ? url.searchParams.get('tab') : 'publication';
    if (
      tab &&
      /^(overview|identity|media|billing|publication|refund|audit)$/.test(tab)
    )
      params.set('tab', tab);
  }
  const query = params.toString();
  return {
    url: url.pathname + (query ? '?' + query : ''),
    contributionId: receipt.contributionId,
    issueId,
    kind: guide ? 'guide' : 'dossier',
    runId: guide ? receipt.runId! : null,
    position: guide ? receipt.position! : null
  };
}
