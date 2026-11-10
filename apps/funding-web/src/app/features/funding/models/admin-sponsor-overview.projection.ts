import type {
  AdminSponsorshipProgress,
  SponsorMediaAsset,
  SponsorshipMilestone,
  SponsorshipPublicationWorkflowStep
} from '@openg7/funding-core';

import type { SponsorDetailsTab } from './admin-sponsors-ui.models.js';
import { dossierServiceSummary } from './admin-sponsorship-services-summary.js';
import { isDossierPublicationComplete } from './admin-sponsorship-workspace.js';

export interface OverviewDestination {
  readonly kind: 'tab';
  readonly tab: SponsorDetailsTab;
  readonly section?: 'review' | 'agreement' | 'stripe' | 'website-settings';
}

export interface OverviewRatio {
  readonly done: number;
  readonly total: number;
}

export interface SponsorOverviewPriority {
  readonly state: 'action' | 'complete' | 'waiting' | 'readonly' | 'unknown';
  readonly labelKey: string;
  readonly actionKey: string | null;
  readonly destination: OverviewDestination | null;
}

export interface SponsorOverviewDomain {
  readonly id: 'identity' | 'media' | 'publication' | 'review' | 'finance';
  readonly labelKey: string;
  readonly stateKey: string;
  readonly tone: 'success' | 'warning' | 'danger' | 'neutral';
  readonly destination: OverviewDestination;
}

export interface SponsorOverviewView {
  readonly stats: {
    readonly steps: OverviewRatio | null;
    readonly services: OverviewRatio | null;
    readonly blockers: number | null;
    readonly visibility: 'visible' | 'hidden' | 'held' | 'unknown';
    readonly media: OverviewRatio | null;
    /** No already-loaded source establishes current, examinable proposals. */
    readonly proposals: number | null;
  };
  readonly priority: SponsorOverviewPriority;
  readonly domains: readonly SponsorOverviewDomain[];
}

export interface SponsorOverviewInput {
  readonly dossier: AdminSponsorshipProgress | null;
  /** Selected dossier assets: null means unavailable; [] is a loaded empty collection. */
  readonly media: readonly SponsorMediaAsset[] | null;
  readonly canManage: boolean;
  readonly canUseOwnerActions: boolean;
}

const prefix = 'admin.dossier.overviewDashboard.';
const tab = (
  target: SponsorDetailsTab,
  section?: OverviewDestination['section']
): OverviewDestination => ({
  kind: 'tab',
  tab: target,
  ...(section ? { section } : {})
});

/** Equivalent prerequisite diagnoses are one problem, never one per panel. */
const canonicalReason = (reason: string): string => {
  const aliases: Readonly<Record<string, string>> = {
    identity_missing: 'identity',
    media_review: 'media',
    review_pending: 'review',
    review_rejected: 'review',
    payment_unconfirmed: 'payment',
    payment_disputed: 'payment',
    consent_missing: 'consent',
    refund_check: 'refund'
  };
  return aliases[reason] ?? reason;
};

const incidentState = (state: string): boolean =>
  ['blocked', 'error', 'uncertain', 'cancelled'].includes(state);

/** Older responses omit these projections, so their distinct total is unknown. */
const hasBlockerSources = (dossier: AdminSponsorshipProgress): boolean =>
  dossier.publicationBlockers !== undefined &&
  dossier.publicationWorkflow !== undefined &&
  dossier.website?.blockers !== undefined;

function distinctBlockers(dossier: AdminSponsorshipProgress): number {
  const problems = new Set<string>();
  const detailedReasons = new Set<string>();
  const add = (reason: string) => problems.add(canonicalReason(reason));
  const publicationComplete = isDossierPublicationComplete(dossier);
  // Eligibility restrictions explain why a future publication cannot occur.
  // They are not new work after all recorded passages have been settled.
  if (!publicationComplete)
    for (const reason of [
      ...(dossier.publicationBlockers ?? []),
      ...(dossier.website?.blockers ?? [])
    ])
      add(reason);

  for (const milestone of dossier.milestones) {
    if (milestone.id !== 'publication' && incidentState(milestone.state))
      add(milestone.reason);
  }

  const workflow = publicationComplete
    ? undefined
    : dossier.publicationWorkflow;
  for (const item of workflow?.obligations ?? []) {
    if (!incidentState(item.state) || item.reason === 'publication_blocked')
      continue;
    const reason = canonicalReason(item.reason);
    // Different failed deliveries remain different incidents. A paused feed or
    // disabled worker is shared by its destination, not repeated per promise.
    const identity = [
      'publication_paused',
      'publication_worker_disabled'
    ].includes(reason)
      ? `${item.channel}:${item.target}`
      : (item.deliveryId ?? item.obligationId);
    const sharedPrerequisite = [
      'identity',
      'media',
      'review',
      'payment',
      'consent',
      'refund',
      'commitment_needs_confirmation',
      'commitment_blocked'
    ].includes(reason);
    problems.add(sharedPrerequisite ? reason : `${reason}:${identity}`);
    detailedReasons.add(reason);
  }

  const publicationMilestone = publicationComplete
    ? undefined
    : dossier.milestones.find((item) => item.id === 'publication');
  for (const item of [workflow, publicationMilestone]) {
    if (
      !item ||
      !incidentState(item.state) ||
      detailedReasons.has(canonicalReason(item.reason))
    )
      continue;
    if (item.reason !== 'publication_blocked') add(item.reason);
  }
  const publicationBlocked = [workflow, publicationMilestone].some(
    (item) =>
      item?.reason === 'publication_blocked' && incidentState(item.state)
  );
  const hasPrerequisite = [
    'identity',
    'media',
    'review',
    'payment',
    'consent',
    'refund',
    'hidden',
    'commitment_needs_confirmation',
    'commitment_blocked'
  ].some((reason) => problems.has(reason));
  if (publicationBlocked && !hasPrerequisite && detailedReasons.size === 0)
    add('publication_blocked');

  for (const event of dossier.failedStripeEvents)
    problems.add(`stripe:${event.id}`);
  for (const email of dossier.failedEmails) problems.add(`email:${email.id}`);
  if (dossier.refund.creditMissing) add('credit_missing');
  if (
    dossier.refund.hasError ||
    (dossier.refund.workflow !== 'none' &&
      !['complete', 'not_required'].includes(dossier.refund.state))
  )
    add('refund');
  return problems.size;
}

function priority(input: SponsorOverviewInput): SponsorOverviewPriority {
  const { dossier, canManage, canUseOwnerActions } = input;
  const passive = (
    state: Exclude<SponsorOverviewPriority['state'], 'action'>
  ): SponsorOverviewPriority => ({
    state,
    labelKey: prefix + 'priority.' + state,
    actionKey: null,
    destination: null
  });
  if (!dossier) return passive('unknown');
  const next = dossier.next;
  if (next.reason === 'complete')
    return passive(
      distinctBlockers(dossier) > 0 ||
        !hasBlockerSources(dossier) ||
        !dossier.milestones.length ||
        dossier.milestones.some(
          (item) => !['complete', 'not_required'].includes(item.state)
        )
        ? 'unknown'
        : 'complete'
    );
  if (!canManage) return passive('readonly');
  if (next.reason === 'identity_submission_pending')
    return {
      ...passive('waiting'),
      labelKey: prefix + 'priority.sponsorWaiting'
    };
  if (
    next.tab === 'publication' &&
    dossier.publicationWorkflow?.responsibility === 'platform'
  )
    return passive('waiting');
  if (
    [
      'refund_check',
      'credit_missing',
      'invoice_missing',
      'stripe_failed',
      'email_failed',
      'email_uncertain'
    ].includes(next.reason) &&
    !canUseOwnerActions
  )
    return passive('readonly');

  let destination: OverviewDestination;
  let action = 'publication';
  if (['review_pending', 'review_rejected'].includes(next.reason)) {
    destination = tab('publication', 'review');
    action = 'review';
  } else if (next.reason === 'stripe_failed') {
    destination = tab('billing', 'stripe');
    action = 'finance';
  } else if (next.reason === 'consent_missing' || next.tab === 'identity') {
    destination = tab('identity');
    action = 'identity';
  } else if (next.reason.startsWith('commitment_')) {
    destination = tab('publication', 'agreement');
    action = 'agreement';
  } else if (
    next.tab === 'overview' ||
    next.tab === 'billing' ||
    next.tab === 'refund'
  ) {
    destination = tab('billing');
    action = 'finance';
  } else {
    destination = tab(next.tab);
    action = next.tab === 'media' ? 'media' : 'publication';
  }
  return {
    state: 'action',
    labelKey:
      next.reason === 'identity_missing'
        ? prefix + 'actions.identity_missing'
        : 'admin.dossier.reasons.' + next.reason,
    actionKey: prefix + 'open.' + action,
    destination
  };
}

function milestoneStatus(milestone: SponsorshipMilestone | undefined): string {
  return milestone?.state === 'not_required'
    ? 'notRequired'
    : (milestone?.state ?? 'unknown');
}

function workflowStatus(workflow: SponsorshipPublicationWorkflowStep): string {
  return workflow.state === 'action_required'
    ? 'pending'
    : workflow.state === 'uncertain'
      ? 'error'
      : workflow.state;
}

/** A read-only dashboard projection: the API remains the workflow authority. */
export function projectSponsorOverview(
  input: SponsorOverviewInput
): SponsorOverviewView {
  const { dossier } = input;
  const serviceSummary = dossier ? dossierServiceSummary(dossier) : null;
  const milestones = new Map(
    dossier?.milestones.map((item) => [item.id, item]) ?? []
  );
  const media = input.media
    ? [
        ...new Map(
          input.media
            .filter(
              (asset) =>
                !dossier || asset.contributionId === dossier.contributionId
            )
            .map((asset) => [asset.id, asset])
        ).values()
      ]
    : null;
  const identity = milestones.get('identity');
  const mediaMilestone = milestones.get('media');
  const reviewStatus = dossier?.reviewStatus;
  const financeProblem =
    dossier &&
    (dossier.failedEmails.length > 0 ||
      dossier.failedStripeEvents.length > 0 ||
      dossier.refund.hasError ||
      dossier.refund.creditMissing ||
      incidentState(milestones.get('billing')?.state ?? ''));
  const states: Record<SponsorOverviewDomain['id'], string> = {
    identity:
      identity?.state === 'blocked' ? 'incomplete' : milestoneStatus(identity),
    media:
      mediaMilestone?.state === 'pending'
        ? 'toReview'
        : mediaMilestone?.state === 'blocked'
          ? 'missing'
          : milestoneStatus(mediaMilestone),
    publication: dossier?.publicationWorkflow
      ? workflowStatus(dossier.publicationWorkflow)
      : milestoneStatus(milestones.get('publication')),
    review:
      reviewStatus === 'approved'
        ? 'approved'
        : ['rejected', 'refused'].includes(reviewStatus ?? '')
          ? 'rejected'
          : ['pending', 'pending_review'].includes(reviewStatus ?? '')
            ? 'pending'
            : 'unknown',
    finance: financeProblem
      ? 'error'
      : dossier &&
          dossier.refund.workflow !== 'none' &&
          !['complete', 'not_required'].includes(dossier.refund.state)
        ? 'pending'
        : ['paid', 'refunded', 'disputed'].includes(
              dossier?.paymentStatus ?? ''
            )
          ? dossier!.paymentStatus
          : dossier
            ? 'pending'
            : 'unknown'
  };
  const destinations: Record<SponsorOverviewDomain['id'], OverviewDestination> =
    {
      identity: tab('identity'),
      media: tab('media'),
      publication: tab('publication'),
      review: tab('publication', 'review'),
      finance: tab('billing')
    };
  const domains = (
    ['identity', 'media', 'publication', 'review', 'finance'] as const
  ).map((id): SponsorOverviewDomain => {
    const state = states[id];
    return {
      id,
      labelKey: prefix + 'domains.' + id,
      stateKey: prefix + 'states.' + state,
      tone: ['complete', 'approved', 'paid', 'notRequired'].includes(state)
        ? 'success'
        : [
              'incomplete',
              'missing',
              'blocked',
              'error',
              'rejected',
              'disputed'
            ].includes(state)
          ? 'danger'
          : ['pending', 'toReview', 'waiting'].includes(state)
            ? 'warning'
            : 'neutral',
      destination: destinations[id]
    };
  });
  return {
    stats: {
      steps:
        dossier && milestones.size
          ? {
              done: [...milestones.values()].filter((item) =>
                ['complete', 'not_required'].includes(item.state)
              ).length,
              total: milestones.size
            }
          : null,
      services:
        serviceSummary && ['ready', 'empty'].includes(serviceSummary.state)
          ? { done: serviceSummary.fulfilled, total: serviceSummary.total }
          : null,
      blockers:
        dossier && hasBlockerSources(dossier)
          ? distinctBlockers(dossier)
          : null,
      visibility: !dossier?.website
        ? 'unknown'
        : dossier.website.visible
          ? 'visible'
          : dossier.website.held
            ? 'held'
            : 'hidden',
      media: media
        ? {
            done: media.filter((asset) => asset.reviewStatus === 'approved')
              .length,
            total: media.length
          }
        : null,
      proposals: null
    },
    priority: priority(input),
    domains
  };
}
