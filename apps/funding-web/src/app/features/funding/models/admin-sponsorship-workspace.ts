import type {
  AdminSponsorshipProgress,
  SponsorshipDossierTab,
  SponsorshipProgressState
} from '@openg7/funding-core';

import type { DossierSection } from './admin-sponsorship-navigation.js';

export function workspaceTab(
  tab: SponsorshipDossierTab
): SponsorshipDossierTab {
  return tab === 'media' ? 'identity' : tab === 'refund' ? 'billing' : tab;
}

/** Presentation of server facts only; these indicators grant no authority. */
export function dossierTabState(
  dossier: AdminSponsorshipProgress | null,
  tab: SponsorshipDossierTab
): SponsorshipProgressState | null {
  if (!dossier) return null;
  const target = workspaceTab(tab);
  const states = dossier.milestones
    .filter((step) => workspaceTab(step.tab) === target)
    .map((step) => step.state);
  if (target === 'overview' && dossier.failedStripeEvents.length)
    states.push('error');
  if (target === 'billing') {
    if (dossier.refund.workflow !== 'none') states.push(dossier.refund.state);
    if (dossier.refund.hasError || dossier.failedEmails.length)
      states.push('error');
    if (dossier.refund.creditMissing) states.push('blocked');
  }
  return (
    (['error', 'blocked', 'partial', 'pending'] as const).find((state) =>
      states.includes(state)
    ) ?? null
  );
}

export function publicationBlockerTab(reason: string): SponsorshipDossierTab {
  return reason === 'media'
    ? 'media'
    : reason === 'identity'
      ? 'identity'
      : [
            'hidden',
            'commitment_needs_confirmation',
            'commitment_blocked'
          ].includes(reason)
        ? 'publication'
        : reason === 'refund'
          ? 'refund'
          : 'overview';
}

export function publicationBlockerSection(reason: string): DossierSection {
  const tab = publicationBlockerTab(reason);
  return tab === 'overview'
    ? reason === 'review'
      ? 'review'
      : 'payment'
    : tab;
}

/** Evidence remains qualified by the server and bound to the exact obligation. */
export function qualifiedPublicationEvidence(
  dossier: AdminSponsorshipProgress,
  obligationId: string
) {
  const obligation = dossier.commitment?.obligations.find(
    (item) => item.id === obligationId
  );
  if (obligation?.state !== 'fulfilled') return undefined;
  return dossier.fulfilmentEvidence?.find(
    (evidence) =>
      evidence.obligationId === obligationId &&
      evidence.id === obligation.fulfilmentEvidenceId &&
      evidence.channel === obligation.channel &&
      evidence.target === obligation.target &&
      dossier.qualifiedFulfilmentEvidenceIds?.includes(evidence.id) === true
  );
}

/** The workflow is authoritative; older responses still require qualified proof. */
export function isDossierPublicationComplete(
  dossier: AdminSponsorshipProgress
): boolean {
  if (dossier.publicationWorkflow)
    return dossier.publicationWorkflow.state === 'complete';
  const commitment = dossier.commitment;
  const obligations = commitment?.obligations ?? [];
  return (
    commitment?.state === 'active' &&
    Boolean(commitment.offer) &&
    obligations.length > 0 &&
    obligations.every(
      (obligation) =>
        obligation.state === 'adjusted' ||
        Boolean(qualifiedPublicationEvidence(dossier, obligation.id))
    )
  );
}
