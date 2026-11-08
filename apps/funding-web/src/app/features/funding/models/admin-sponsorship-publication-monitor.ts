import type {
  AdminSponsorshipProgress,
  PreflightDeskService,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationWorkshopState,
  SponsorshipProgressPublication,
  WorkshopEditorialPreparation,
  WorkshopProposal
} from '@openg7/funding-core';

import {
  dossierServiceSummary,
  type DossierServiceSummary,
  type DossierServiceSummaryRow
} from './admin-sponsorship-services-summary.js';

export type PublicationMonitorStatus =
  | 'exception'
  | 'delivered'
  | 'scheduled'
  | 'publishing'
  | 'approved'
  | 'collective_review'
  | 'proposal'
  | 'adopted'
  | 'partial'
  | 'obsolete'
  | 'preparing'
  | 'disabled'
  | 'waiting'
  | 'unavailable'
  | 'simulated';
export type PublicationMonitorAction =
  'resolve' | 'proof' | 'schedule' | 'review' | 'queue' | 'refresh' | 'details';
export type PublicationMonitorVariant =
  WorkshopEditorialPreparation['variants'][number];

/** A presentation of one recorded passage, never a publication authorization. */
export interface PublicationMonitorRow extends Omit<
  DossierServiceSummaryRow,
  'status'
> {
  readonly status: PublicationMonitorStatus;
  readonly action: PublicationMonitorAction;
  readonly publication: SponsorshipProgressPublication | null;
  readonly delivery: PublicationDelivery | null;
  readonly proposal: WorkshopProposal | null;
  readonly variant: PublicationMonitorVariant | null;
  readonly queueService: PreflightDeskService | null;
  readonly warnings: readonly string[];
  readonly summary: string | null;
}

export interface PublicationMonitor {
  readonly rows: readonly PublicationMonitorRow[];
  readonly total: number;
  readonly delivered: number;
  readonly remaining: number;
  readonly adjusted: number;
  readonly complete: boolean;
  readonly state:
    | PublicationMonitorStatus
    | 'empty'
    | 'agreement_unknown'
    | 'agreement_unconfirmed';
  readonly agreementState: DossierServiceSummary['state'];
  readonly next: PublicationMonitorRow | null;
  readonly proposalCount: number;
  /** Last recorded server event, not the time of the latest successful read. */
  readonly checkedAt: string | null;
}

const runningStatuses = new Set([
  'pending',
  'planning',
  'ready',
  'processing',
  'received',
  'waiting_dependency',
  'queued',
  'accepted',
  'running',
  'preparing',
  'in_progress',
  'retrying'
]);
const actions: Record<PublicationMonitorStatus, PublicationMonitorAction> = {
  exception: 'resolve',
  delivered: 'proof',
  scheduled: 'schedule',
  publishing: 'schedule',
  approved: 'schedule',
  collective_review: 'queue',
  proposal: 'review',
  adopted: 'review',
  partial: 'resolve',
  obsolete: 'resolve',
  preparing: 'refresh',
  disabled: 'details',
  waiting: 'details',
  unavailable: 'refresh',
  simulated: 'details'
};
const priority: Record<PublicationMonitorStatus, number> = {
  exception: 0,
  obsolete: 1,
  partial: 2,
  collective_review: 3,
  proposal: 4,
  adopted: 5,
  approved: 6,
  scheduled: 7,
  publishing: 8,
  unavailable: 9,
  preparing: 10,
  waiting: 11,
  disabled: 12,
  simulated: 13,
  delivered: 14
};

/** All joins use dossier + exact obligation; a shared destination is insufficient. */
export function publicationMonitor(
  dossier: AdminSponsorshipProgress,
  workshop: PublicationWorkshopState | null,
  automation: PublicationAutomationState | null,
  deskServices: readonly PreflightDeskService[] = []
): PublicationMonitor {
  const services = dossierServiceSummary(dossier);
  const scoped =
    workshop?.contributionId === dossier.contributionId ? workshop : null;
  const activeProposal =
    scoped?.enabled &&
    scoped.proposal &&
    !scoped.proposal.obsolete &&
    scoped.proposal.sourceVersion === scoped.sourceVersion &&
    scoped.proposal.editorialPreparation.sourceVersion ===
      scoped.sourceVersion &&
    scoped.proposal.editorialPreparation.sourceSnapshotDigest ===
      scoped.sourceSnapshotDigest &&
    scoped.proposal.editorialPreparation.sourceCommitmentId ===
      dossier.commitment?.id &&
    scoped.proposal.editorialPreparation.commitmentVersion ===
      dossier.commitment?.version
      ? scoped.proposal
      : null;
  const rows = services.rows
    .filter(
      (row) =>
        row.obligation.state !== 'adjusted' &&
        row.obligation.contributionId === dossier.contributionId &&
        row.obligation.commitmentId === dossier.commitment?.id
    )
    .map<PublicationMonitorRow>((row) => {
      const obligation = row.obligation;
      const matching = dossier.publications.filter(
        (publication) =>
          publication.obligationId === obligation.id &&
          publication.channel === obligation.channel &&
          publication.target === obligation.target
      );
      const publication =
        matching.find(
          (item) =>
            !!row.workflow?.deliveryId &&
            item.deliveryId === row.workflow.deliveryId
        ) ??
        matching.find(
          (item) => !['cancelled', 'rejected'].includes(item.status)
        ) ??
        matching[0] ??
        null;
      const deliveryId = row.workflow?.deliveryId ?? publication?.deliveryId;
      const delivery =
        automation?.deliveries.find(
          (item) =>
            item.id === deliveryId &&
            item.feedId === `${obligation.target}:${obligation.channel}` &&
            item.sponsors.some(
              (sponsor) => sponsor.id === dossier.contributionId
            )
        ) ?? null;
      const queueService =
        deskServices.find(
          (service) =>
            service.id === obligation.id &&
            service.contributionId === dossier.contributionId &&
            service.channel === obligation.channel &&
            service.target === obligation.target &&
            service.ordinal === obligation.ordinal &&
            service.obligationState !== 'adjusted'
        ) ?? null;
      const matchesVariant = (variant: PublicationMonitorVariant) =>
        variant.obligationId === obligation.id &&
        variant.obligationVersion === obligation.version &&
        variant.destination === obligation.channel;
      const variant =
        activeProposal?.editorialPreparation.variants.find(matchesVariant) ??
        null;
      const proposal = variant ? activeProposal : null;
      const workshopRelevant =
        ['website', 'facebook'].includes(obligation.channel) &&
        !services.rows.some(
          (other) =>
            other.obligation.channel === obligation.channel &&
            other.obligation.target === obligation.target &&
            !['fulfilled', 'adjusted'].includes(other.obligation.state) &&
            (other.obligation.ordinal < obligation.ordinal ||
              (other.obligation.ordinal === obligation.ordinal &&
                other.obligation.id.localeCompare(obligation.id) < 0))
        );
      const obsolete =
        !proposal &&
        scoped?.history.some(
          (historical) =>
            (historical.obsolete ||
              historical.sourceVersion !== scoped.sourceVersion) &&
            historical.editorialPreparation.variants.some(
              (item) =>
                item.obligationId === obligation.id &&
                item.destination === obligation.channel
            )
        );
      const warnings: string[] = [];
      let status: PublicationMonitorStatus;
      const deliveryStatus = delivery?.status ?? publication?.deliveryStatus;
      const reason = row.workflow?.reason;
      const incident =
        row.workflow &&
        ['blocked', 'error', 'uncertain'].includes(row.workflow.state);
      const feed = delivery
        ? automation?.feeds.find((item) => item.id === delivery.feedId)
        : null;
      const deliveryWarnings =
        deliveryStatus === 'approved' && delivery
          ? [
              ...(automation?.workerEnabled === false
                ? ['publication_worker_disabled']
                : []),
              ...(feed?.paused ? ['publication_paused'] : []),
              ...(feed?.configured === false || feed?.mode === 'disabled'
                ? ['destination_unconfigured']
                : []),
              ...(feed && ['expired', 'error'].includes(feed.connection)
                ? ['destination_unavailable']
                : [])
            ]
          : [];
      if (
        incident ||
        obligation.state === 'blocked' ||
        ['blocked', 'uncertain', 'failed', 'rejected'].includes(
          deliveryStatus ?? ''
        ) ||
        queueService?.blocked ||
        deliveryWarnings.length ||
        (!row.evidence && (dossier.publicationBlockers?.length ?? 0) > 0) ||
        (!row.evidence && dossier.publicConsent === false)
      ) {
        status = 'exception';
        warnings.push(
          ...(dossier.publicationBlockers ?? []),
          ...(queueService?.blockers ?? []),
          ...(obligation.blockedReason ? [obligation.blockedReason] : []),
          ...(reason ? [reason] : []),
          ...(delivery?.errorCode ? [delivery.errorCode] : []),
          ...deliveryWarnings,
          ...(!row.evidence && dossier.publicConsent === false
            ? ['consent_missing']
            : [])
        );
      } else if (row.evidence) status = 'delivered';
      else if (row.status === 'unverified') {
        status = 'exception';
        warnings.push('fulfilment_unverified');
      } else if (deliveryStatus === 'publishing') status = 'publishing';
      else if (
        reason === 'publication_scheduled' ||
        reason === 'publication_retry_pending' ||
        (deliveryStatus === 'approved' && delivery?.mode === 'live')
      )
        status = 'scheduled';
      else if (
        deliveryStatus === 'published' ||
        publication?.status === 'published'
      ) {
        status =
          delivery?.mode === 'mock' || publication?.deliveryMode === 'mock'
            ? 'simulated'
            : 'exception';
        warnings.push(
          status === 'simulated'
            ? 'publication_simulation'
            : 'fulfilment_unverified'
        );
      } else if (
        queueService?.preparation.serviceDecision?.decision === 'approved' ||
        publication?.status === 'approved' ||
        deliveryStatus === 'approved'
      )
        status = 'approved';
      else if (queueService?.stage === 'to_review')
        status = 'collective_review';
      else if (proposal?.editorialPreparation.state === 'partial') {
        status = 'partial';
        warnings.push(
          ...proposal.editorialPreparation.common.missingInformation
        );
      } else if (proposal?.adoptedAt) status = 'adopted';
      else if (proposal) status = 'proposal';
      else if (
        ['draft', 'pending_review'].includes(publication?.status ?? '') ||
        deliveryStatus === 'draft'
      )
        status = 'waiting';
      else if (obsolete) {
        status = 'obsolete';
        warnings.push('proposal_obsolete');
      } else if (scoped?.enabled === false && workshopRelevant)
        status = 'disabled';
      else if (
        workshopRelevant &&
        (scoped?.mission?.delivery === 'uncertain' ||
          scoped?.mission?.delivery === 'failed' ||
          scoped?.mission?.status === 'failed' ||
          scoped?.mission?.status === 'waiting_input' ||
          scoped?.mission?.errorCode)
      ) {
        status = 'exception';
        warnings.push(
          scoped.mission.errorCode ??
            (scoped.mission.status === 'waiting_input'
              ? 'preparation_input_required'
              : 'preparation_unavailable')
        );
      } else if (
        scoped?.mission &&
        workshopRelevant &&
        (runningStatuses.has(scoped.mission.status) ||
          ['queued', 'sending'].includes(scoped.mission.delivery))
      )
        status = 'preparing';
      else if (!row.workflow) status = 'unavailable';
      else status = 'waiting';
      if (proposal?.provenance.simulated)
        warnings.push('preparation_simulated');
      return {
        ...row,
        status,
        action:
          status === 'waiting' &&
          (['draft', 'pending_review'].includes(publication?.status ?? '') ||
            deliveryStatus === 'draft')
            ? 'review'
            : actions[status],
        publication,
        delivery,
        proposal,
        variant,
        queueService,
        warnings: [...new Set(warnings)],
        summary: variant?.summary.trim().slice(0, 220) || null
      };
    });
  const next =
    [...rows].sort(
      (left, right) => priority[left.status] - priority[right.status]
    )[0] ?? null;
  const delivered = rows.filter((row) => Boolean(row.evidence)).length;
  const complete =
    rows.length > 0 && rows.every((row) => row.status === 'delivered');
  return {
    rows,
    total: rows.length,
    delivered,
    remaining: rows.length - delivered,
    adjusted: services.adjusted,
    complete,
    state:
      services.state === 'agreement_unknown' ||
      services.state === 'agreement_unconfirmed'
        ? services.state
        : (next?.status ?? 'empty'),
    agreementState: services.state,
    next: complete ? null : next,
    proposalCount: rows.filter((row) => row.proposal && !row.proposal.adoptedAt)
      .length,
    checkedAt: scoped?.mission?.updatedAt ?? null
  };
}
