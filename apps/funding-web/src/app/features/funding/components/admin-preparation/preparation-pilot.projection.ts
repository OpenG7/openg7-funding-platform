import type { AdminPreparationReceiptData } from '@openg7/funding-core';

import { automaticAdminUrl } from '../admin-automatic/admin-automatic-run.js';

import type {
  PreparationActionKind,
  PreparationPilotIssue,
  PreparationPilotProjection
} from './preparation-pilot.models.js';

interface CheckPresentation {
  readonly actionKind: PreparationActionKind;
  readonly blockerCodes: readonly string[];
}

/** Labels and destinations only: completion and eligibility come from the receipt. */
const checkPresentation: Readonly<Record<string, CheckPresentation>> = {
  dossier_examined: {
    actionKind: 'inspect',
    blockerCodes: ['dossier_not_examined']
  },
  payment_confirmed: {
    actionKind: 'inspect',
    blockerCodes: [
      'contribution_missing',
      'payment_unconfirmed',
      'payment_refunded',
      'payment_disputed'
    ]
  },
  accepted_offer: {
    actionKind: 'agreement',
    blockerCodes: ['commitment_needs_confirmation', 'offer_unverified']
  },
  public_consent: {
    actionKind: 'inspect',
    blockerCodes: ['public_consent_missing']
  },
  sponsor_review: {
    actionKind: 'moderation',
    blockerCodes: ['sponsor_review_required']
  },
  moderation_review: {
    actionKind: 'moderation',
    blockerCodes: ['moderation_review_required']
  },
  content_prepared: {
    actionKind: 'presentation',
    blockerCodes: [
      'company_missing',
      'presentation_missing',
      'required_media_missing',
      'website_draft_missing',
      'website_draft_outdated',
      'publication_draft_missing',
      'publication_draft_incomplete'
    ]
  }
};

function blockerTitle(code: string): string {
  if (code === 'required_media_missing') return 'pilot.issues.media';
  if (checkPresentation['content_prepared'].blockerCodes.includes(code))
    return 'pilot.issues.presentation';
  return 'pilot.issues.other';
}

export function projectPreparationPilot(
  receipt: AdminPreparationReceiptData
): PreparationPilotProjection {
  const applicable = [...receipt.checks, ...receipt.authorizations].filter(
    (check) => check.state !== 'not_required'
  );
  const claimed = new Set<string>();
  const dossierUrl = automaticAdminUrl(
    '/admin/fundraiser/sponsors?sponsorshipId=' +
      encodeURIComponent(receipt.contributionId)
  );
  const issues: PreparationPilotIssue[] = applicable.map((check) => {
    const presentation = Object.hasOwn(checkPresentation, check.code)
      ? checkPresentation[check.code]
      : undefined;
    const blockers = receipt.blockers.filter((blocker) =>
      presentation?.blockerCodes.includes(blocker.code)
    );
    blockers.forEach((blocker) => claimed.add(blocker.code));
    return {
      id: 'check:' + check.code,
      checkCode: check.code,
      titleKey: 'pilot.checks.' + (presentation ? check.code : 'other'),
      summaryCodes: blockers.map((blocker) => blocker.code),
      completed: check.state === 'complete',
      adminUrl: blockers.length
        ? (blockers
            .map((blocker) =>
              blocker.adminUrl ? automaticAdminUrl(blocker.adminUrl) : null
            )
            .find((url) => url !== null) ?? null)
        : dossierUrl,
      actionKind: presentation?.actionKind ?? 'inspect'
    };
  });
  for (const blocker of receipt.blockers) {
    if (claimed.has(blocker.code)) continue;
    claimed.add(blocker.code);
    issues.push({
      id: 'blocker:' + blocker.code,
      titleKey: blockerTitle(blocker.code),
      summaryCodes: [blocker.code],
      completed: false,
      adminUrl: blocker.adminUrl ? automaticAdminUrl(blocker.adminUrl) : null,
      actionKind: 'inspect'
    });
  }
  return {
    issues,
    completed: applicable.filter((check) => check.state === 'complete').length,
    total: applicable.length
  };
}

/** The Guide can retain a deliberately selected satisfied control across rereads. */
export function reconcilePreparationIssue(
  issues: readonly PreparationPilotIssue[],
  currentId: string | null,
  preserveResolved = false
): string | null {
  if (
    issues.some(
      (issue) =>
        issue.id === currentId && (preserveResolved || !issue.completed)
    )
  )
    return currentId;
  return issues.find((issue) => !issue.completed)?.id ?? null;
}
